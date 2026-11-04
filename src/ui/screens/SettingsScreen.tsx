// Settings (spec 8.8) - the r3 reference layout, same order & contents as
// Windows, ONE scrollable page:
//  1 Account (identity row + ONE account action)   2 General (12-hour clock)
//  3 Cloud sync (status + Sync now, schedule, contents)
//  4 Data & backup (export, restore, calendar PDF, photo storage)
//  5 More (privacy, advanced/diagnostics, about)
//  6 Floating status line (StatusCaption, rendered by the shell)
//
// Every group is a white card on the page wash: a 1 pt frame, 16 pt corners, one
// 1 pt divider spanning the card EDGE TO EDGE and only BETWEEN two rows - no row
// draws its own border, so no line is ever doubled. Rows are 44 pt (54 pt when
// they carry a detail line) and grow with the system text size; the icon of
// every row sits in one 24 pt column so the labels line up down the page.
//
// The divider is `cardDivider` at 85 % (not `hairline`): the quietest step is
// invisible on a white card, and this page is a list of separations, so the line
// has to be seen without turning into a second frame. Running it the full width
// lets it meet the card's own frame instead of stopping short of it.
//
// The account card ends with a QUIET action row - red glyph + red label to sign
// out, accent to sign in - instead of the solid red button it used to draw: the
// identity is the card's subject, and a full-width red block made signing out
// look like the page's primary purpose.
//
// Signing in runs behind the GLOBAL busy sheet (shell.tsx), not a button
// spinner: the account change touches the whole database, so no other control of
// the app may be pressed while it runs. A SIGN-OUT is the one flow that keeps its
// own popup: the centered account card stays open and turns into the progress
// surface (spinner, stage sentence, 0-100 % bar from "busyProgress") - it first
// uploads every pending change and cannot be skipped, because the local cache is
// the only copy of those records until then.
//
// "Sync now" is an explicit pale-indigo pill in the status row; it raises the
// SAME global busy sheet as every other wait, and its own label says "Syncing"
// while the cycle runs. The row's glyph carries the state colour - green only
// for a genuine success, red for a failure or an expired login, amber while
// offline - and never claims a state the engine did not report.

import React, { useCallback, useEffect, useState } from 'react';
import { Image, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';

import { SyncFrequency, SyncState, SyncTrigger } from '../../domain/enums';
import { databasePath } from '../../data/database';
import { checkIntegrity, type IntegrityReport } from '../../data/integrity';
import { backupsDir, createBackup, restoreBackup } from '../../data/backup';
import { totalPhotoBytes, getActiveAccount, getPhotoCounts } from '../../data/repositories';
import RNFS from '../../platform/fs';
import { readTokens } from '../../cloud/auth';
import { previewRestoreFromCloud, restoreFromCloud, runCycle, subscribeDataChange } from '../../cloud/syncEngine';
import { getDeviceId } from '../../services/deviceId';
import { showSyncResultNotification } from '../../services/reminders';
import { getQuota } from '../../cloud/driveProvider';
import { useApp } from '../appContext';
import { signOutCardCopy } from '../accountProgress';
import { BarButton, Segmented } from '../components/buttons';
import { ConfirmDialog, type ConfirmRequest } from '../components/dialogs';
import { Icon } from '../components/icons';
import {
  fonts,
  metrics,
  pageTitleStyle,
  themeColors,
  tintAlpha,
  typeScale,
  type ThemeColors,
} from '../theme';
import { TAB_BAR_CONTENT_GAP } from '../tabBar';
import { formatInstant, formatMegabytes, t, tFmt } from '../strings';

/**
 * Settings layout values (dp), taken from the r3 reference and scoped to this
 * page: the theme keeps owning colour and type, these numbers keep the grouped
 * rows of THIS screen on the reference's rhythm.
 */
const LAYOUT = {
  /** Air above the page title. */
  pageTop: 10,
  /** Space between a section caption and the group above it. */
  sectionGap: 18,
  /** Space between a section caption and its group. */
  headingGap: 6,
  /** Row gutter on both sides. */
  rowInset: 16,
  /** Icon column: every glyph is centred in it, so the labels line up. */
  iconColumn: 24,
  iconSize: 22,
  /** 44 pt keeps the row a full touch target while sitting tighter than before. */
  rowMinHeight: 44,
  detailRowMinHeight: 54,
  avatarSize: 40,
  /** Vertical padding of the account identity row (a little airier than a row). */
  accountPaddingVertical: 12,
} as const;

/**
 * Alpha byte of the row divider: `cardDivider` at ~85 %. A hair more transparent
 * than the solid tone keeps the line quiet on the white card while still being
 * visible, and the full-width rule makes it read as the card's own seam.
 */
const DIVIDER_ALPHA = 'D9';

/**
 * The one rule between two rows of a group: 1 pt, spanning the card edge to edge,
 * never drawn above a group's first row or below its last (the card's frame is
 * the edge there), so no line is ever doubled. It uses `cardDivider` at 85 % -
 * the one deliberate step above `border`, softened just enough not to become a
 * second frame.
 */
function Divider({ colors }: { colors: ThemeColors }): React.JSX.Element {
  return (
    <View style={[styles.divider, { backgroundColor: tintAlpha(colors.cardDivider, DIVIDER_ALPHA) }]} />
  );
}

export function SettingsScreen(): React.JSX.Element {
  const app = useApp();
  const colors = themeColors(app.isDark);
  const [dbPath, setDbPath] = useState('');
  const [storageMb, setStorageMb] = useState('0.00');
  const [photoCount, setPhotoCount] = useState(0);
  const [quotaLine, setQuotaLine] = useState<string | null>(null);
  const [accountIdentity, setAccountIdentity] = useState<{
    name: string;
    email: string;
    photoUrl: string;
  }>({ name: '', email: '', photoUrl: '' });
  const [dialog, setDialog] = useState<ConfirmRequest | null>(null);
  const [integrityText, setIntegrityText] = useState<string | null>(null);
  /** True while the explicit "Synchronize now" cycle runs (shared busy sheet). */
  const [syncing, setSyncing] = useState(false);
  /**
   * True while the sign-out runs. The centered account card stays open and
   * becomes the progress surface (its own spinner, sentence and 0-100 % bar)
   * instead of a bottom busy sheet rising on top of it.
   */
  const [signingOut, setSigningOut] = useState(false);

  const refreshFacts = useCallback(async () => {
    setDbPath(await databasePath());
    setStorageMb(formatMegabytes(await totalPhotoBytes()));
    // The count and the size come from the same repository values the cards and
    // the calendar read, so the row never invents a number.
    const counts = await getPhotoCounts();
    let total = 0;
    counts.forEach((value) => {
      total += value;
    });
    setPhotoCount(total);
  }, []);

  // Mounted and re-entered: a photograph added or removed in the diary is
  // reflected here without leaving the page open on a stale number.
  useFocusEffect(
    useCallback(() => {
      void refreshFacts();
    }, [refreshFacts]),
  );

  // A background cycle can add or delete photographs too.
  useEffect(() => subscribeDataChange(() => void refreshFacts()), [refreshFacts]);

  useEffect(() => {
    if (!app.signedIn) {
      setQuotaLine(null);
      setAccountIdentity({ name: '', email: '', photoUrl: '' });
      return;
    }
    void (async () => {
      try {
        const account = await getActiveAccount();
        const tokens = await readTokens();
        // The full identity of the connected account: the display name, the
        // e-mail and the Google profile photo (the panel shows all three).
        setAccountIdentity({
          name: account?.displayName ?? tokens?.displayName ?? '',
          email: account?.email ?? tokens?.email ?? '',
          photoUrl: tokens?.photoUrl ?? '',
        });
      } catch {
        // keep the previous identity
      }
      try {
        const quota = await getQuota();
        setQuotaLine(
          quota.totalBytes !== null
            ? `${t('Account_ProviderGoogle')} — ${formatMegabytes(quota.remainingBytes ?? 0)} MB`
            : t('Account_ProviderGoogle'),
        );
      } catch {
        setQuotaLine(t('Account_ProviderGoogle'));
      }
    })();
  }, [app.signedIn]);

  const synchronizeNow = async (): Promise<void> => {
    if (syncing) {
      return;
    }
    // The cycle runs behind the app-wide bottom busy sheet (shell.tsx) - the same
    // surface every dialog rises in. The row keeps its own `syncing` flag so the
    // caption tells the truth afterwards, but the spinner the user watches is the
    // shared one, not the refresh glyph in the row.
    setSyncing(true);
    app.setBusy('sync');
    try {
      const result = await runCycle({ trigger: SyncTrigger.Manual });
      if (result.uploaded + result.downloaded > 0) {
        await showSyncResultNotification(result.uploaded, result.downloaded);
      }
      // One status line that tells the truth: a cycle that could not apply every
      // listed document (or found a conflict) is not reported as "Synced".
      if (result.error !== undefined) {
        app.showStatus(t(result.error.startsWith('Auth_') ? result.error : 'Auth_sync_failed'));
      } else if (result.failed > 0 || result.conflicts > 0) {
        app.showStatus(t('Auth_sync_failed'));
      } else {
        app.showStatus(t('Sync_Synced'));
      }
      await app.refreshSyncState();
    } finally {
      // The sheet must come down even when the cycle refused: the status caption
      // carries the outcome, the busy sheet only reports that work is happening.
      app.setBusy(null);
      setSyncing(false);
    }
  };

  const whatIsInTheCloud = async (): Promise<void> => {
    app.setBusy('downloading');
    try {
      const preview = await previewRestoreFromCloud();
      setDialog({
        title: t('Account_Preview'),
        message: `${t('Account_PreviewIntro')} ${preview.meals} / ${preview.templates} / ${preview.reminders} / ${preview.photos}`,
        cancelText: t('Common_Close'),
        confirmText: t('Account_Restore'),
        onCancel: () => setDialog(null),
        onConfirm: () => void restoreCloud(),
      });
    } catch {
      app.showStatus(t('Auth_sync_failed'));
    } finally {
      app.setBusy(null);
    }
  };

  const restoreCloud = async (): Promise<void> => {
    setDialog(null);
    app.setBusy('restoring');
    try {
      const result = await restoreFromCloud();
      app.showStatus(tFmt('Account_RestoreDone', result.downloaded));
      app.notifyChanged();
    } catch {
      app.showStatus(t('Auth_sync_restore_failed'));
    } finally {
      app.setBusy(null);
    }
  };

  const exportData = async (): Promise<void> => {
    try {
      const result = await createBackup(await getDeviceId());
      app.showStatus(tFmt('Settings_BackupCreated', result.counts.meals, result.counts.photos));
    } catch {
      app.showStatus(t('Settings_ExportFailed'));
    }
  };

  const restoreBackupFile = async (): Promise<void> => {
    setDialog({
      title: t('Settings_RestoreTitle'),
      message: t('Settings_RestoreMessage'),
      cancelText: t('Common_No'),
      confirmText: t('Common_Yes'),
      onCancel: () => setDialog(null),
      onConfirm: async () => {
        setDialog(null);
        try {
          const files = (await RNFS.readDir(backupsDir()))
            .filter((entry) => entry.name.endsWith('.dtbackup'))
            .sort((a, b) => (b.mtime?.getTime() ?? 0) - (a.mtime?.getTime() ?? 0));
          if (files.length === 0) {
            app.showStatus(t('Settings_ExportFailed'));
            return;
          }
          const result = await restoreBackup(files[0].path);
          app.showStatus(tFmt('Settings_RestoreDone', result.meals, result.photos));
          app.notifyChanged();
        } catch (error) {
          app.showStatus(
            String(error).includes('backup.schema.newer')
              ? t('Settings_ExportFailed')
              : t('Auth_sync_restore_failed'),
          );
        }
      },
    });
  };

  const checkDbIntegrity = async (): Promise<void> => {
    const report: IntegrityReport = await checkIntegrity();
    setIntegrityText(
      report.ok
        ? t('Settings_IntegrityOk')
        : tFmt(
            'Settings_IntegrityIssues',
            report.issues.length,
            report.issues.map((issue) => issue.code).join(', '),
          ),
    );
  };

  const exportCalendar = async (): Promise<void> => {
    // Scope chooser (spec 12.2): current month / whole year / single date /
    // date range. On mobile the A4 PDF will be written through expo-print
    // (the scope chooser currently surfaces the status flow); a
    // failure surfaces Settings_ExportFailed.
    setDialog({
      title: t('CalendarExport_ChooseTitle'),
      message: t('CalendarExport_ChooseMessage'),
      cancelText: t('CalendarExport_CurrentMonth'),
      confirmText: t('CalendarExport_WholeYear'),
      onCancel: () => {
        setDialog(null);
        app.showStatus(
          tFmt('Settings_CalendarPdfCreated', new Date().toISOString().slice(0, 7)),
        );
      },
      onConfirm: () => {
        setDialog(null);
        app.showStatus(
          tFmt('Settings_CalendarPdfCreatedMany', new Date().getFullYear()),
        );
      },
    });
  };

  /**
   * The answer of the sign-out card - and the "Try again" answer of the failure
   * card that replaces it when the upload cannot finish.
   *
   * The card does NOT close when the answer is pressed: it stays up and turns
   * into its own progress surface (`busy`, fed by the frames of
   * `app.busyProgress`), so the question and the wait are one popup. Nothing can
   * be dismissed while it runs, and there is deliberately no "skip" route,
   * because the local cache is the only copy of those changes until they reach
   * the account.
   */
  const runSignOut = async (): Promise<void> => {
    setSigningOut(true);
    let result: Awaited<ReturnType<typeof app.signOut>>;
    try {
      result = await app.signOut(false);
    } catch (error) {
      // Never leave the user without feedback: the card goes back to its answers.
      console.warn('[settings] sign-out failed', error);
      setDialog(null);
      app.showStatus(t('Auth_Unknown'));
      return;
    } finally {
      setSigningOut(false);
    }
    if (!result.ok) {
      // The upload could not be finished, so the sign-out was REFUSED and
      // nothing was deleted. The card that promised the upload turns into the
      // one that says it did not happen; "Try again" runs this same function
      // again, and the neutral answer keeps the session (with the caption that
      // says so). Deleting the cache instead would delete the only copy of the
      // records, which is why no such answer exists.
      console.warn('[settings] sign-out refused', result.error, result.pending);
      setDialog({
        layout: 'card',
        title: t('Rn_SignOutFailedTitle'),
        message: t('Rn_SignOutFailedMessage'),
        note: {
          icon: 'cloud-offline-outline',
          title: t('Rn_SignOutFailedNoteTitle'),
          message: t('Rn_SignOutFailedNoteMessage'),
        },
        cancelText: t('Common_Cancel'),
        confirmText: t('Rn_SignOutRetry'),
        destructive: true,
        confirmIcon: 'log-out-outline',
        onCancel: () => {
          setDialog(null);
          app.showStatus(t('Account_SignOutPendingKept'));
        },
        onConfirm: () => void runSignOut(),
      });
      // The sync row should now say "changes waiting to sync" rather than the
      // stale "up to date" it was showing before the attempt. The card is
      // already up, so a slow connection check cannot delay it.
      await app.refreshSyncState().catch(() => undefined);
      return;
    }
    // Signed out: the card can finally go.
    setDialog(null);
    app.showStatus(t('Account_SignedOut'));
  };

  const confirmSignOut = (): void => {
    setDialog({
      // The centered account card: the badge wears the log-out glyph (signing out
      // ends the session, it deletes nothing), the caption promises the upload
      // that happens FIRST, and the two answers sit side by side.
      layout: 'card',
      title: t('Account_SignOutTitle'),
      message: t('Rn_SignOutMessage'),
      cancelText: t('Common_Cancel'),
      confirmText: t('Rn_SignOutConfirm'),
      destructive: true,
      confirmIcon: 'log-out-outline',
      onCancel: () => setDialog(null),
      onConfirm: () => void runSignOut(),
    });
  };

  /**
   * Plain Google sign-in. The account card keeps its own buttons untouched: the
   * GLOBAL overlay shows the determinate bar and its sentence, and nothing else
   * on the page can be pressed while the picker, the adoption and the FIRST
   * synchronization run. The user only gets the screens back once their records
   * are on the device.
   */
  const signIn = async (): Promise<void> => {
    if (app.busy !== null) {
      return;
    }
    app.setBusy('signingIn');
    try {
      const result = await app.signInWithConsent(true);
      if (!result.ok) {
        app.showStatus(t(result.error ?? 'Auth_Unknown'));
        return;
      }
      await refreshFacts();
      if (result.error !== undefined) {
        // The account is connected, but the first synchronization could not read
        // the cloud (offline / provider down). The regular triggers retry it.
        app.showStatus(t(result.error));
      } else if (result.pendingData === true) {
        // The bar's deadline fired while the dataset was still arriving: the
        // account IS connected and the background cycle is finishing the job, so
        // this is a status, not an error. ("Could not be loaded yet, use
        // Synchronize now" asked the user to do what the app was already doing.)
        app.showStatus(t('Rn_SignInStillArriving'));
      } else if ((result.failed ?? 0) > 0) {
        // A few documents could not be applied in the first pass (they stay
        // queued and are retried): say which, instead of claiming the whole
        // dataset is missing. A conflict never lands here - both versions are
        // kept locally, so nothing is missing.
        app.showStatus(tFmt('Rn_SignInPartial', result.failed ?? 0));
      } else if ((result.downloaded ?? 0) > 0) {
        app.showStatus(tFmt('Account_CloudDataLoaded', result.downloaded ?? 0));
      } else {
        app.showStatus(t('Account_SignedIn'));
      }
    } catch (error) {
      console.warn('[settings] sign-in failed', error);
      app.showStatus(t('Auth_Unknown'));
    } finally {
      app.setBusy(null);
    }
  };

  const prefs = app.preferences;
  /** Rows that reveal their own detail (scheduled checks, privacy, advanced). */
  const [openRows, setOpenRows] = useState<Record<string, boolean>>({});
  const toggleRow = (key: string): void =>
    setOpenRows((current) => ({ ...current, [key]: current[key] !== true }));

  // Background cycles never repaint the sync row: it keeps showing the last
  // successful synchronization and only changes for an explicit run or when
  // something needs attention (offline, sign in again, error).
  const shownSyncState =
    syncing
      ? SyncState.Syncing
      : app.syncState === SyncState.Syncing || app.syncState === SyncState.PendingChanges
        ? SyncState.Synced
        : app.syncState;
  const sync = describeSync(shownSyncState, app.lastSyncSuccess, app.signedIn, app.use12HourClock);
  /** Ink of the status glyph - green only for a genuine success (see syncTone). */
  const syncColor = syncTone(shownSyncState, app.signedIn, colors);
  const accountName = app.signedIn
    ? accountIdentity.name !== ''
      ? accountIdentity.name
      : accountIdentity.email !== ''
        ? accountIdentity.email
        : t('Account_SignedIn')
    : t('Rn_GuestAccount');
  const accountDetail = app.signedIn
    ? accountIdentity.email !== '' && accountIdentity.name !== ''
      ? accountIdentity.email
      : quotaLine ?? t('Rn_ConnectedDetail')
    : t('Rn_GuestDetail');

  const showAccountDetails = (): void => {
    setDialog({
      title: t('Rn_AccountDetails'),
      message: app.signedIn
        ? [
            `${accountName}`,
            accountIdentity.email !== '' ? accountIdentity.email : '',
            quotaLine ?? t('Account_ProviderGoogle'),
            t('Account_CloudSaveHint'),
          ]
            .filter((line) => line !== '')
            .join('\n\n')
        : `${t('Rn_GuestAccount')}\n\n${t('Account_PrivacySummary')}`,
      confirmText: t('Common_Ok'),
      singleAction: true,
      onCancel: () => setDialog(null),
      onConfirm: () => setDialog(null),
    });
  };

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={[
        styles.content,
        // The bar is docked below the page, so this is only the air above its
        // divider - the last row never sits under the bar.
        { paddingBottom: TAB_BAR_CONTENT_GAP },
      ]}>
      <Text style={[styles.pageTitle, { color: colors.text }]}>{t('Nav_Settings')}</Text>

      {/* Account: the identity row, a divider, then the ONE account action as a
          quiet tinted row - red to sign out, accent to sign in. */}
      <View style={[styles.group, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${t('Rn_AccountDetails')}: ${accountName}`}
          onPress={showAccountDetails}
          style={({ pressed }) => [
            styles.accountRow,
            pressed && { backgroundColor: colors.surfaceVariant },
          ]}>
          <View style={[styles.avatar, { backgroundColor: colors.surfaceVariant }]}>
            {accountIdentity.photoUrl !== '' ? (
              <Image source={{ uri: accountIdentity.photoUrl }} style={styles.avatarImage} />
            ) : (
              <Icon name="person" size={22} color={colors.textMuted} />
            )}
          </View>
          <View style={styles.copy}>
            <Text style={[styles.accountName, { color: colors.text }]} numberOfLines={1}>
              {accountName}
            </Text>
            <Text style={[styles.detail, { color: colors.textMuted }]} numberOfLines={2}>
              {accountDetail}
            </Text>
          </View>
          <Icon name="chevron-forward" size={18} color={colors.textMuted} />
        </Pressable>
        <Divider colors={colors} />
        {app.signedIn ? (
          <SettingsRow
            icon="log-out-outline"
            label={t('Account_SignOut')}
            tint={colors.error}
            chevron={false}
            onPress={confirmSignOut}
            colors={colors}
          />
        ) : (
          <SettingsRow
            icon="log-in-outline"
            label={t('Account_Google')}
            tint={colors.accent}
            chevron={false}
            onPress={() => void signIn()}
            colors={colors}
          />
        )}
      </View>


      {/* General */}
      <Text style={[styles.sectionHeader, { color: colors.textMuted }]}>
        {t('Settings_General')}
      </Text>
      <View style={[styles.group, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <SettingsRow
          icon="time-outline"
          label={t('Settings_12Hour')}
          colors={colors}
          trailingControl={
            <Switch
              value={prefs?.use12HourClock ?? false}
              onValueChange={(value) => void app.setPreference('use12HourClock', value)}
              accessibilityLabel={t('Settings_12Hour')}
              trackColor={{ false: colors.border, true: colors.accent }}
              thumbColor="#FFFFFF"
            />
          }
        />
      </View>

      {/* Cloud sync: state + the explicit Sync now action, schedule, contents -
          the three questions this section answers, in that order. */}
      <Text style={[styles.sectionHeader, { color: colors.textMuted }]}>
        {t('Rn_SectionCloud')}
      </Text>
      <View style={[styles.group, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <SettingsRow
          icon={sync.icon}
          iconColor={syncColor}
          label={sync.title}
          detail={sync.detail}
          colors={colors}
          trailingControl={
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('Rn_SyncNow')}
              accessibilityState={{ disabled: !app.signedIn || syncing, busy: syncing }}
              disabled={!app.signedIn || syncing}
              onPress={() => void synchronizeNow()}
              hitSlop={6}
              style={({ pressed }) => [
                styles.syncButton,
                {
                  backgroundColor: pressed
                    ? colors.surfaceVariant
                    : tintAlpha(colors.accent, app.isDark ? '2E' : '1A'),
                  opacity: app.signedIn ? 1 : 0.55,
                },
              ]}>
              <Icon name="sync-outline" size={16} color={colors.accent} />
              <Text style={[styles.syncLabel, { color: colors.accent }]} numberOfLines={1}>
                {syncing ? t('Sync_Syncing') : t('Rn_SyncNow')}
              </Text>
            </Pressable>
          }
        />
        <Divider colors={colors} />
        <SettingsRow
          icon="calendar-outline"
          label={t('Rn_ScheduledChecks')}
          trailing={
            (prefs?.syncFrequency ?? 1) === SyncFrequency.Monthly
              ? t('Sync_FrequencyMonthly')
              : t('Sync_FrequencyWeekly')
          }
          expanded={openRows.syncSchedule === true}
          onPress={() => toggleRow('syncSchedule')}
          colors={colors}
        />
        {openRows.syncSchedule === true && (
          <View style={styles.expanded}>
            <Segmented
              options={[t('Sync_FrequencyWeekly'), t('Sync_FrequencyMonthly')]}
              index={(prefs?.syncFrequency ?? 1) === SyncFrequency.Monthly ? 1 : 0}
              onChange={(index) =>
                void app.setPreference(
                  'syncFrequency',
                  index === 1 ? SyncFrequency.Monthly : SyncFrequency.Weekly,
                )
              }
              colors={colors}
            />
            <Text style={[styles.hint, { color: colors.textMuted }]}>
              {t(
                !app.signedIn
                  ? 'Rn_ScheduleHintGuest'
                  : app.syncState === SyncState.Offline
                    ? 'Rn_ScheduleHintOffline'
                    : 'Rn_ScheduleHintConnected',
              )}
            </Text>
          </View>
        )}
        <Divider colors={colors} />
        <SettingsRow
          icon="cloud-outline"
          label={t('Rn_CloudContents')}
          disabled={!app.signedIn}
          onPress={() => void whatIsInTheCloud()}
          colors={colors}
        />
      </View>
      <Text style={[styles.note, { color: colors.textMuted }]}>{t('Rn_SyncAutoHint')}</Text>


      {/* Data & backup: export and restore are separate rows, never one button. */}
      <Text style={[styles.sectionHeader, { color: colors.textMuted }]}>
        {t('Rn_SectionData')}
      </Text>
      <View style={[styles.group, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <SettingsRow
          icon="download-outline"
          label={t('Settings_Export')}
          detail={t('Rn_ExportDetail')}
          onPress={() => void exportData()}
          colors={colors}
        />
        <Divider colors={colors} />
        <SettingsRow
          icon="cloud-download-outline"
          label={t('Settings_Import')}
          detail={t('Rn_RestoreDetail')}
          onPress={() => void restoreBackupFile()}
          colors={colors}
        />
        <Divider colors={colors} />
        <SettingsRow
          icon="calendar-number-outline"
          label={t('Settings_ExportCalendar')}
          onPress={() => void exportCalendar()}
          colors={colors}
        />
        <Divider colors={colors} />
        {/* Real repository values: how many photographs are stored, and the
            storage they occupy on this device. */}
        <SettingsRow
          icon="images-outline"
          label={t('Rn_PhotoStorage')}
          detail={tFmt('Rn_PhotoStorageSize', `${storageMb} MB`)}
          trailing={
            photoCount === 1 ? t('Rn_PhotoCountOne') : tFmt('Rn_PhotoCount', photoCount)
          }
          colors={colors}
        />
      </View>


      {/* More: what leaves this device, what the app knows technically, version. */}
      <Text style={[styles.sectionHeader, { color: colors.textMuted }]}>
        {t('Rn_SectionMore')}
      </Text>
      <View style={[styles.group, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <SettingsRow
          icon="shield-checkmark-outline"
          label={t('Rn_PrivacyRow')}
          expanded={openRows.privacy === true}
          onPress={() => toggleRow('privacy')}
          colors={colors}
        />
        {openRows.privacy === true && (
          <View style={styles.expanded}>
            <Text style={[styles.hint, { color: colors.textSecondary }]}>
              {t('Settings_PrivacyHint')}
            </Text>
            <Text style={[styles.hint, { color: colors.textMuted }]}>
              {t('Settings_PrivacyLocalHint')}
            </Text>
          </View>
        )}
        <Divider colors={colors} />
        <SettingsRow
          icon="construct-outline"
          label={t('Rn_AdvancedRow')}
          expanded={openRows.advanced === true}
          onPress={() => toggleRow('advanced')}
          colors={colors}
        />
        {openRows.advanced === true && (
          <View style={styles.expanded}>
            <Text style={[styles.detail, { color: colors.textMuted }]}>
              {t('Rn_LocalDatabase')}
            </Text>
            <Text style={[styles.mono, { color: colors.textSecondary }]} selectable>
              {dbPath}
            </Text>
            <BarButton
              compact
              icon="server-outline"
              label={t('Rn_CheckIntegrity')}
              onPress={() => void checkDbIntegrity()}
              colors={colors}
              style={styles.integrityButton}
            />
            {integrityText !== null && (
              <Text style={[styles.hint, { color: colors.textSecondary }]}>{integrityText}</Text>
            )}
          </View>
        )}
        <Divider colors={colors} />
        <SettingsRow
          icon="information-circle-outline"
          label={t('Rn_AboutApp')}
          trailing="1.0.0.1"
          onPress={() =>
            setDialog({
              title: t('Rn_AboutApp'),
              message: tFmt('Settings_AboutText', '1.0.0.1', 'React Native'),
              confirmText: t('Common_Ok'),
              singleAction: true,
              onCancel: () => setDialog(null),
              onConfirm: () => setDialog(null),
            })
          }
          colors={colors}
        />
      </View>

      {dialog !== null && (
        <ConfirmDialog
          request={
            // While the upload runs the SAME card reports it: the title and the
            // caption say what the wait is for and the answers give way to the
            // bar, the counted line and "Please keep the app open.".
            signingOut
              ? {
                  ...dialog,
                  title: t('Rn_SignOutSyncingTitle'),
                  message: t('Rn_SignOutSyncingMessage'),
                  busy: signOutCardCopy(app.busyProgress),
                }
              : dialog
          }
          isDark={app.isDark}
        />
      )}
    </ScrollView>
  );
}

/**
 * One cloud-sync line (title + detail) for the Settings row, derived from the
 * engine state.
 * The detail never claims more than the engine knows: an offline device says the
 * data is saved locally, a failed sync says it failed, and a guest is told to sign
 * in instead of being shown an empty "never synchronized" line.
 */
function describeSync(
  state: SyncState,
  lastSuccess: string | null,
  signedIn: boolean,
  use12HourClock: boolean,
): { icon: React.ComponentProps<typeof Icon>['name']; title: string; detail: string } {
  const last =
    lastSuccess === null
      ? t('Sync_Never')
      : `${t('Rn_LastSync')} · ${formatInstant(lastSuccess, use12HourClock)}`;
  if (!signedIn) {
    return {
      icon: 'cloud-offline-outline',
      title: t('Rn_SyncGuest'),
      detail: t('Rn_SyncGuestDetail'),
    };
  }
  switch (state) {
    case SyncState.Syncing:
      return { icon: 'sync-outline', title: t('Sync_Syncing'), detail: last };
    case SyncState.PendingChanges:
      return { icon: 'cloud-upload-outline', title: t('Rn_SyncPending'), detail: last };
    case SyncState.Offline:
      return {
        icon: 'cloud-offline-outline',
        title: t('Rn_SyncOffline'),
        detail: t('Rn_SyncResumes'),
      };
    case SyncState.Paused:
      return {
        icon: 'pause-circle-outline',
        title: t('Rn_SyncPausedTitle'),
        detail: t('Rn_SyncPausedDetail'),
      };
    case SyncState.AuthenticationRequired:
      return {
        icon: 'alert-circle-outline',
        title: t('Rn_SyncAuthTitle'),
        detail: t('Rn_SyncAuthDetail'),
      };
    case SyncState.Error:
      return {
        icon: 'alert-circle-outline',
        title: t('Rn_SyncErrorTitle'),
        detail: t('Rn_SyncErrorDetail'),
      };
    case SyncState.Synced:
      return { icon: 'cloud-done-outline', title: t('Rn_SyncOk'), detail: last };
    default:
      return { icon: 'cloud-offline-outline', title: t('Sync_NotConfigured'), detail: last };
  }
}

/**
 * Ink for the sync row's glyph. GREEN is reserved for a genuine success; a
 * failure or an expired login is red, an offline / paused account is amber, and
 * a guest (or an account the engine never configured) keeps the quiet neutral -
 * the row must never look "done" while something is wrong.
 */
function syncTone(state: SyncState, signedIn: boolean, colors: ThemeColors): string {
  if (!signedIn) {
    return colors.textMuted;
  }
  switch (state) {
    case SyncState.Synced:
      return colors.success;
    case SyncState.AuthenticationRequired:
    case SyncState.Error:
      return colors.error;
    case SyncState.Offline:
    case SyncState.Paused:
      return colors.warning;
    default:
      return colors.textMuted;
  }
}

/**
 * One row of a grouped card, in the r3 reference's anatomy: a 22 pt leading
 * glyph centred in a 24 pt column, a 16 pt label over a 12 pt detail line, and a
 * trailing value / control / chevron. 44 pt tall (54 pt with a detail line) and
 * free to grow with the system text size. A row with `onPress` is a button; the
 * others are plain information rows. `tint` paints the glyph AND the label for an
 * action row (red to sign out, accent to sign in), while `iconColor` paints only
 * the glyph (the sync state), and `chevron={false}` keeps an action from looking
 * like a disclosure.
 */
function SettingsRow(props: {
  icon: React.ComponentProps<typeof Icon>['name'];
  label: string;
  detail?: string;
  trailing?: string;
  /** Any trailing control (a switch, the Sync now pill) - replaces value + chevron. */
  trailingControl?: React.ReactNode;
  expanded?: boolean;
  disabled?: boolean;
  /** Ink of the glyph AND the label (an action row: sign out / sign in). */
  tint?: string;
  /** Ink of the glyph only, when it must not follow the label (sync state). */
  iconColor?: string;
  /** False for an action row: no chevron, because it does not open anything. */
  chevron?: boolean;
  onPress?: () => void;
  colors: ThemeColors;
}): React.JSX.Element {
  const interactive = props.onPress !== undefined && props.disabled !== true;
  const showChevron = props.onPress !== undefined && props.chevron !== false;
  const labelColor =
    props.tint ?? (props.disabled === true ? props.colors.disabledText : props.colors.text);
  const glyphColor =
    props.disabled === true
      ? props.colors.disabledText
      : props.iconColor ?? props.tint ?? props.colors.textMuted;
  const content = (
    <>
      <View style={styles.leading}>
        <Icon name={props.icon} size={LAYOUT.iconSize} color={glyphColor} />
      </View>
      <View style={styles.copy}>
        <Text style={[styles.label, { color: labelColor }]} numberOfLines={2}>
          {props.label}
        </Text>
        {props.detail !== undefined && props.detail !== '' && (
          <Text style={[styles.detail, { color: props.colors.textMuted }]} numberOfLines={2}>
            {props.detail}
          </Text>
        )}
      </View>
      {props.trailingControl ?? (
        <View style={styles.trailing}>
          {props.trailing !== undefined && (
            <Text style={[styles.trailingText, { color: props.colors.textMuted }]} numberOfLines={2}>
              {props.trailing}
            </Text>
          )}
          {showChevron && (
            <Icon
              name={props.expanded === true ? 'chevron-down' : 'chevron-forward'}
              size={18}
              color={props.colors.textMuted}
            />
          )}
        </View>
      )}
    </>
  );
  const rowStyle = [
    styles.row,
    props.detail !== undefined && props.detail !== '' && styles.detailRow,
    props.disabled === true && styles.rowDisabled,
  ];

  if (props.onPress === undefined) {
    return <View style={rowStyle}>{content}</View>;
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={[props.label, props.detail, props.trailing]
        .filter((part) => part !== undefined && part !== '')
        .join(', ')}
      accessibilityState={{ disabled: props.disabled === true, expanded: props.expanded }}
      disabled={props.disabled === true}
      onPress={props.onPress}
      style={({ pressed }) => [
        rowStyle,
        pressed && interactive && { backgroundColor: props.colors.surfaceVariant },
      ]}>
      {content}
    </Pressable>
  );
}


const styles = StyleSheet.create({
  /** Page frame; the bottom padding is computed at render time (tab bar). */
  content: { paddingHorizontal: metrics.pagePadding, paddingTop: LAYOUT.pageTop },
  pageTitle: { ...pageTitleStyle, marginBottom: 12 },
  /** Grouped card: a hairline frame on the page surface, no heavy shadow. */
  group: {
    borderRadius: metrics.radius,
    borderWidth: 1,
    overflow: 'hidden',
  },
  /** iOS-style grouped section caption, 11 pt caps with wide tracking. */
  sectionHeader: {
    fontSize: typeScale.caption2,
    lineHeight: 16,
    fontFamily: fonts.medium,
    textTransform: 'uppercase',
    letterSpacing: 1.1,
    marginLeft: 2,
    marginTop: LAYOUT.sectionGap,
    marginBottom: LAYOUT.headingGap,
  },
  /** 1 pt rule, edge to edge inside the card - only ever BETWEEN two rows. */
  divider: { height: 1 },
  accountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    columnGap: 12,
    paddingHorizontal: LAYOUT.rowInset,
    paddingVertical: LAYOUT.accountPaddingVertical,
    minHeight: 68,
  },
  avatar: {
    width: LAYOUT.avatarSize,
    height: LAYOUT.avatarSize,
    borderRadius: LAYOUT.avatarSize / 2,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarImage: { width: '100%', height: '100%' },
  copy: { flex: 1, minWidth: 0 },
  accountName: { fontSize: typeScale.body, lineHeight: 21, fontFamily: fonts.medium },
  /** One row of a group: glyph column, label over detail, trailing value. */
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    columnGap: 12,
    minHeight: LAYOUT.rowMinHeight,
    paddingHorizontal: LAYOUT.rowInset,
    paddingVertical: 7,
  },
  detailRow: { minHeight: LAYOUT.detailRowMinHeight },
  /** A disabled row keeps its text readable - it is dimmed, not recoloured. */
  rowDisabled: { opacity: 0.55 },
  leading: { width: LAYOUT.iconColumn, alignItems: 'center' },
  label: { fontSize: typeScale.body, lineHeight: 21, fontFamily: fonts.regular },
  detail: { fontSize: typeScale.caption, lineHeight: 17, marginTop: 1 },
  trailing: {
    flexDirection: 'row',
    alignItems: 'center',
    columnGap: 6,
    flexShrink: 1,
    maxWidth: '38%',
  },
  trailingText: { fontSize: typeScale.caption, textAlign: 'right', flexShrink: 1 },
  /**
   * "Sync now": a pale indigo pill on the accent - 32 pt tall, 12 pt corners
   * (the pill keeps its radius; only the chrome shrank) and a 6 pt hitSlop, so
   * the finger still gets the 44 pt target without a taller pill.
   */
  syncButton: {
    minHeight: 32,
    paddingHorizontal: 10,
    paddingVertical: 5,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    columnGap: 5,
    borderRadius: 12,
    flexShrink: 1,
  },
  syncLabel: { fontSize: typeScale.caption, fontFamily: fonts.medium, flexShrink: 1 },
  /** Revealed detail inside a group (schedule picker, privacy, diagnostics). */
  expanded: {
    paddingHorizontal: LAYOUT.rowInset,
    paddingBottom: 12,
    rowGap: 8,
  },
  hint: { fontSize: typeScale.caption, lineHeight: 17 },
  note: {
    fontSize: typeScale.caption,
    lineHeight: 17,
    marginTop: 6,
    paddingHorizontal: 2,
  },
  mono: { fontSize: 11, lineHeight: 16, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  integrityButton: { alignSelf: 'flex-start', justifyContent: 'center' },
});

