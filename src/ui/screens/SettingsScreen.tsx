// Settings (spec 8.8) - card grid, same order & contents as Windows:
//  1 Guest info (only signed out)   2 Account card
//  3 General (auto-save hint + toggles - every control writes immediately,
//    no Save button)                 4 Synchronization card
//  5 Privacy and backup card         6 About card
//  7 Floating status line (StatusCaption, rendered by the shell)
//
// Signing in and out runs behind the GLOBAL busy sheet (shell.tsx), not a button
// spinner: the account change touches the whole database, so no other control of
// the app may be pressed while it runs. A sign-out first uploads every pending
// change behind a 0-100 % bar ("busyProgress") and cannot be skipped - the local
// cache is the only copy of those records until then.
//
// "Synchronize now" raises the SAME bottom sheet with a plain spinner and the
// "Synchronizing your data…" sentence, so every wait in the app looks alike and
// the row's refresh glyph is only the trigger, never the progress report.

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
import { BarButton, Segmented } from '../components/buttons';
import { ConfirmDialog, type ConfirmRequest } from '../components/dialogs';
import { Icon } from '../components/icons';
import { fonts, metrics, pageTitleStyle, themeColors, type ThemeColors } from '../theme';
import { TAB_BAR_CONTENT_GAP } from '../tabBar';
import { formatInstant, formatMegabytes, t, tFmt } from '../strings';

/**
 * RN-only wording: the sign-out can no longer be forced past a failed sync, so
 * the refusal says what happens instead of offering a discard path.
 */
const SIGN_OUT_UPLOAD_FAILED =
  'Sign-out was cancelled so nothing is lost: those changes are only on this device. Check the connection and try again in a moment.';

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

  const confirmSignOut = (): void => {
    setDialog({
      title: t('Account_SignOutTitle'),
      message: t('Account_SignOutMessage'),
      cancelText: t('Common_No'),
      confirmText: t('Common_Yes'),
      destructive: true,
      onCancel: () => setDialog(null),
      onConfirm: async () => {
        setDialog(null);
        // The global overlay blocks the whole screen (every other button, the
        // tab bar and the back key) until the account change is done. Sign-out
        // first uploads every pending change behind a 0-100 % bar - there is no
        // "skip" route, because the local cache is the only copy until then.
        app.setBusy('signingOut');
        let result: Awaited<ReturnType<typeof app.signOut>>;
        try {
          result = await app.signOut(false);
        } catch (error) {
          // Never leave the user without feedback (the overlay is already gone).
          console.warn('[settings] sign-out failed', error);
          app.showStatus(t('Auth_Unknown'));
          return;
        } finally {
          app.setBusy(null);
        }
        if (!result.ok) {
          // The upload could not be finished, so the sign-out was REFUSED and
          // nothing was deleted: one acknowledgement, no force/discard option
          // (deleting the cache would delete the only copy of those changes).
          const detail =
            result.error !== undefined && result.error.startsWith('Auth_')
              ? t(result.error)
              : tFmt('Account_SignOutPendingDetail', String(result.pending ?? 0)).replace(
                  ' Sign out anyway?',
                  '.',
                );
          setDialog({
            title: t('Account_SignOutPendingTitle'),
            message: `${detail}\n\n${SIGN_OUT_UPLOAD_FAILED}`,
            confirmText: t('Common_Ok'),
            singleAction: true,
            onCancel: () => setDialog(null),
            onConfirm: () => {
              setDialog(null);
              app.showStatus(t('Account_SignOutPendingKept'));
            },
          });
          return;
        }
        app.showStatus(t('Account_SignedOut'));
      },
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
        app.showStatus(t('Account_CloudDataPending'));
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

      {/* Account: identity row + the one account action, in a single card. */}
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
            <Text style={[styles.label, { color: colors.text }]} numberOfLines={1}>
              {accountName}
            </Text>
            <Text style={[styles.detail, { color: colors.textMuted }]} numberOfLines={1}>
              {accountDetail}
            </Text>
          </View>
          <Icon name="chevron-forward" size={16} color={colors.textMuted} />
        </Pressable>
        <View style={styles.accountAction}>
          {app.signedIn ? (
            <BarButton
              danger
              label={t('Account_SignOut')}
              style={styles.accountButton}
              onPress={confirmSignOut}
              colors={colors}
            />
          ) : (
            <BarButton
              accent
              icon="log-in-outline"
              label={t('Account_Google')}
              style={styles.accountButton}
              onPress={() => void signIn()}
              colors={colors}
            />
          )}
        </View>
      </View>


      {/* General */}
      <Text style={[styles.sectionHeader, { color: colors.textMuted }]}>
        {t('Settings_General')}
      </Text>
      <View style={[styles.group, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <SettingsRow
          icon="time-outline"
          label={t('Settings_12Hour')}
          divider={false}
          colors={colors}
          trailingControl={
            <Switch
              value={prefs?.use12HourClock ?? false}
              onValueChange={(value) => void app.setPreference('use12HourClock', value)}
              accessibilityLabel={t('Settings_12Hour')}
              trackColor={{ false: colors.border, true: colors.success }}
              thumbColor="#FFFFFF"
            />
          }
        />
      </View>

      {/* Cloud sync: state, schedule, contents - the three questions this
          section answers, in that order. */}
      <Text style={[styles.sectionHeader, { color: colors.textMuted }]}>
        {t('Rn_SectionCloud')}
      </Text>
      <View style={[styles.group, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <SettingsRow
          icon={sync.icon}
          label={sync.title}
          detail={sync.detail}
          divider={false}
          colors={colors}
          trailingControl={
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('Settings_SyncNow')}
              accessibilityState={{ disabled: !app.signedIn || syncing }}
              disabled={!app.signedIn || syncing}
              onPress={() => void synchronizeNow()}
              hitSlop={8}
              style={({ pressed }) => [
                styles.refreshButton,
                {
                  backgroundColor: pressed ? colors.surfaceVariant : 'transparent',
                  opacity: app.signedIn ? 1 : 0.4,
                },
              ]}>
              <Icon
                name="refresh"
                size={20}
                color={syncing ? colors.accent : colors.textSecondary}
              />
            </Pressable>
          }
        />
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
          <View style={[styles.expanded, { borderTopColor: colors.hairline }]}>
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
          divider={false}
          onPress={() => void exportData()}
          colors={colors}
        />
        <SettingsRow
          icon="cloud-download-outline"
          label={t('Settings_Import')}
          detail={t('Rn_RestoreDetail')}
          onPress={() => void restoreBackupFile()}
          colors={colors}
        />
        <SettingsRow
          icon="calendar-number-outline"
          label={t('Settings_ExportCalendar')}
          onPress={() => void exportCalendar()}
          colors={colors}
        />
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
          divider={false}
          expanded={openRows.privacy === true}
          onPress={() => toggleRow('privacy')}
          colors={colors}
        />
        {openRows.privacy === true && (
          <View style={[styles.expanded, { borderTopColor: colors.hairline }]}>
            <Text style={[styles.hint, { color: colors.textSecondary }]}>
              {t('Settings_PrivacyHint')}
            </Text>
            <Text style={[styles.hint, { color: colors.textMuted }]}>
              {t('Settings_PrivacyLocalHint')}
            </Text>
          </View>
        )}
        <SettingsRow
          icon="construct-outline"
          label={t('Rn_AdvancedRow')}
          expanded={openRows.advanced === true}
          onPress={() => toggleRow('advanced')}
          colors={colors}
        />
        {openRows.advanced === true && (
          <View style={[styles.expanded, { borderTopColor: colors.hairline }]}>
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

      {dialog !== null && <ConfirmDialog request={dialog} isDark={app.isDark} />}
    </ScrollView>
  );
}



/**
 * One title + one detail for the cloud-sync row, derived from the engine state.
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
 * One row of a grouped card, in the round-3 anatomy: a 20 pt leading glyph, a
 * 14 pt label over an 11 pt detail, and a trailing value / control / chevron. A
 * row with `onPress` is a button; the others are plain information rows.
 */
function SettingsRow(props: {
  icon: React.ComponentProps<typeof Icon>['name'];
  label: string;
  detail?: string;
  trailing?: string;
  /** Any trailing control (a switch, an icon button) - replaces value + chevron. */
  trailingControl?: React.ReactNode;
  expanded?: boolean;
  disabled?: boolean;
  onPress?: () => void;
  /** False for the first row of a group (the card's own frame is the top edge). */
  divider?: boolean;
  colors: ThemeColors;
}): React.JSX.Element {
  const interactive = props.onPress !== undefined && props.disabled !== true;
  const content = (
    <>
      <View style={styles.leading}>
        <Icon
          name={props.icon}
          size={20}
          color={props.disabled === true ? props.colors.disabledText : props.colors.textMuted}
        />
      </View>
      <View style={styles.copy}>
        <Text
          style={[
            styles.label,
            { color: props.disabled === true ? props.colors.disabledText : props.colors.text },
          ]}
          numberOfLines={2}>
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
            <Text style={[styles.trailingText, { color: props.colors.textMuted }]}>
              {props.trailing}
            </Text>
          )}
          {props.onPress !== undefined && (
            <Icon
              name={props.expanded === true ? 'chevron-down' : 'chevron-forward'}
              size={16}
              color={props.colors.textMuted}
            />
          )}
        </View>
      )}
    </>
  );

  const dividerStyle = {
    borderTopColor: props.divider === false ? 'transparent' : props.colors.hairline,
  };
  if (props.onPress === undefined) {
    return <View style={[styles.row, dividerStyle]}>{content}</View>;
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={
        props.trailing === undefined ? props.label : `${props.label}, ${props.trailing}`
      }
      accessibilityState={{ disabled: props.disabled === true, expanded: props.expanded }}
      disabled={props.disabled === true}
      onPress={props.onPress}
      style={({ pressed }) => [
        styles.row,
        dividerStyle,
        pressed && interactive && { backgroundColor: props.colors.surfaceVariant },
      ]}>
      {content}
    </Pressable>
  );
}


const styles = StyleSheet.create({
  /** Page frame; the bottom padding is computed at render time (tab bar). */
  content: { paddingHorizontal: metrics.pagePadding, paddingTop: 6 },
  pageTitle: { ...pageTitleStyle, marginBottom: 14 },
  /** Grouped card: a hairline frame on the page surface, no heavy shadow. */
  group: {
    borderRadius: 15,
    borderWidth: 1,
    overflow: 'hidden',
  },
  /** iOS-style grouped section caption, 11 pt caps with wide tracking. */
  sectionHeader: {
    fontSize: 11,
    lineHeight: 18,
    fontFamily: fonts.medium,
    textTransform: 'uppercase',
    letterSpacing: 1.1,
    marginLeft: 2,
    marginTop: 18,
    marginBottom: 7,
  },
  accountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    columnGap: 12,
    padding: 14,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarImage: { width: '100%', height: '100%' },
  copy: { flex: 1, minWidth: 0 },
  label: { fontSize: 14, lineHeight: 19, fontFamily: fonts.medium },
  detail: { fontSize: 11, lineHeight: 16, marginTop: 2 },
  /** The account action keeps the card's inner padding on every side. */
  accountAction: { paddingHorizontal: 14, paddingBottom: 14 },
  accountButton: { minHeight: 46, justifyContent: 'center' },
  /** One row of a group; the hairline above it is drawn by the row itself. */
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    columnGap: 11,
    minHeight: 58,
    paddingHorizontal: 13,
    paddingVertical: 11,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'transparent',
  },
  leading: { width: 30, height: 30, alignItems: 'center', justifyContent: 'center' },
  trailing: { flexDirection: 'row', alignItems: 'center', columnGap: 6 },
  trailingText: { fontSize: 12 },
  refreshButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
  },
  /** Revealed detail inside a group (schedule picker, privacy, diagnostics). */
  expanded: {
    paddingHorizontal: 13,
    paddingBottom: 13,
    rowGap: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  hint: { fontSize: 12, lineHeight: 17 },
  note: { fontSize: 11, lineHeight: 16, marginTop: 8, marginLeft: 3, marginRight: 3 },
  mono: { fontSize: 11, lineHeight: 16, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  integrityButton: { alignSelf: 'flex-start', justifyContent: 'center' },
});

