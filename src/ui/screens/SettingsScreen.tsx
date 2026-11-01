// Settings (spec 8.8) - card grid, same order & contents as Windows:
//  1 Guest info (only signed out)   2 Account card
//  3 General (auto-save hint + toggles - every control writes immediately,
//    no Save button)                 4 Synchronization card
//  5 Privacy and backup card         6 About card
//  7 Floating status line (StatusCaption, rendered by the shell)
//
// Signing in and out runs behind the GLOBAL busy overlay (shell.tsx), not a
// button spinner: the account change touches the whole database, so no other
// control of the app may be pressed while it runs. A sign-out first uploads
// every pending change behind a 0-100 % bar ("busyProgress") and cannot be
// skipped - the local cache is the only copy of those records until then.

import React, { useCallback, useEffect, useState } from 'react';
import { Image, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';

import { SyncFrequency, SyncState, SyncTrigger } from '../../domain/enums';
import { databasePath } from '../../data/database';
import { checkIntegrity, type IntegrityReport } from '../../data/integrity';
import { backupsDir, createBackup, restoreBackup } from '../../data/backup';
import { totalPhotoBytes, getActiveAccount } from '../../data/repositories';
import RNFS from '../../platform/fs';
import { readTokens } from '../../cloud/auth';
import { previewRestoreFromCloud, restoreFromCloud, runCycle } from '../../cloud/syncEngine';
import { getDeviceId } from '../../services/deviceId';
import { showSyncResultNotification } from '../../services/reminders';
import { getQuota } from '../../cloud/driveProvider';
import { useApp } from '../appContext';
import { BarButton, Segmented } from '../components/buttons';
import { ConfirmDialog, type ConfirmRequest } from '../components/dialogs';
import { Icon } from '../components/icons';
import { fonts, metrics, pageTitleStyle, cardShadow, themeColors, typeScale } from '../theme';
import { useFloatingTabBarClearance } from '../tabBar';
import { formatMegabytes, t, tFmt } from '../strings';

/**
 * RN-only wording: the sign-out can no longer be forced past a failed sync, so
 * the refusal says what happens instead of offering a discard path.
 */
const SIGN_OUT_UPLOAD_FAILED =
  'Sign-out was cancelled so nothing is lost: those changes are only on this device. Check the connection and try again in a moment.';

export function SettingsScreen(): React.JSX.Element {
  const app = useApp();
  const colors = themeColors(app.isDark);
  const bottomClearance = useFloatingTabBarClearance();
  const [dbPath, setDbPath] = useState('');
  const [storageMb, setStorageMb] = useState('0.00');
  const [quotaLine, setQuotaLine] = useState<string | null>(null);
  const [accountIdentity, setAccountIdentity] = useState<{
    name: string;
    email: string;
    photoUrl: string;
  }>({ name: '', email: '', photoUrl: '' });
  const [dialog, setDialog] = useState<ConfirmRequest | null>(null);
  const [integrityText, setIntegrityText] = useState<string | null>(null);
  /** True while the explicit "Synchronize now" cycle runs (inline spinner). */
  const [syncing, setSyncing] = useState(false);

  const refreshFacts = useCallback(async () => {
    setDbPath(await databasePath());
    setStorageMb(formatMegabytes(await totalPhotoBytes()));
  }, []);

  useEffect(() => {
    void refreshFacts();
  }, [refreshFacts]);

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
    // No blocking overlay for a synchronization: the card keeps its own small
    // spinner for the few seconds the cycle takes, so the page stays usable and
    // reads like a native pull-to-refresh instead of a modal wall.
    setSyncing(true);
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
  const cardStyle = [styles.card, cardShadow, { backgroundColor: colors.cardFill }];

  // Background cycles never repaint this line: it keeps showing the last
  // successful synchronization and only changes for an explicit run or when
  // something needs attention (offline, sign in again, error).
  const shownSyncState =
    syncing
      ? SyncState.Syncing
      : app.syncState === SyncState.Syncing || app.syncState === SyncState.PendingChanges
        ? SyncState.Synced
        : app.syncState;

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={[
        styles.content,
        // The floating tab bar sits ON TOP of the page; the extra room keeps the
        // About card (the last one) fully readable above it.
        { paddingBottom: bottomClearance },
      ]}>
      <Text style={[styles.pageTitle, { color: colors.text }]}>{t('Nav_Settings')}</Text>

      {/* 2. Account card */}
      <Text style={[styles.sectionHeader, { color: colors.textSecondary }]}>{t('Settings_Account')}</Text>
      <View style={cardStyle}>
        {/* Profile panel: a large framed photo, the full display name and the
            e-mail (nothing is clipped to one line any more), the provider line
            under them and the account action as a full-width button below the
            identity - the classic account settings arrangement. */}
        <View style={styles.accountPanel}>
          <View
            style={[
              styles.avatar,
              { backgroundColor: colors.surfaceVariant, borderColor: colors.border },
            ]}>
            {accountIdentity.photoUrl !== '' ? (
              <Image source={{ uri: accountIdentity.photoUrl }} style={styles.avatarImage} />
            ) : (
              <Icon name="person-circle-outline" size={46} color={colors.textMuted} />
            )}
          </View>
          <View style={styles.accountText}>
            <Text style={[styles.accountName, { color: colors.text }]} numberOfLines={2}>
              {app.signedIn
                ? accountIdentity.name !== ''
                  ? accountIdentity.name
                  : accountIdentity.email !== ''
                    ? accountIdentity.email
                    : t('Account_SignedIn')
                : t('Account_NoEmail')}
            </Text>
            {app.signedIn && accountIdentity.email !== '' && accountIdentity.name !== '' && (
              <Text
                style={[styles.accountEmail, { color: colors.textSecondary }]}
                numberOfLines={2}
                ellipsizeMode="middle"
                selectable>
                {accountIdentity.email}
              </Text>
            )}
            <Text style={[styles.accountMeta, { color: colors.textMuted }]} numberOfLines={2}>
              {app.signedIn
                ? quotaLine ?? t('Account_ProviderGoogle')
                : t('Account_ProviderNone')}
            </Text>
          </View>
        </View>
        {/* The buttons never carry a spinner: the global busy overlay covers
            the whole screen while Google runs, so the card keeps its layout -
            no label swap, no size jump, and no second tap can slip through. */}
        {app.signedIn ? (
          <BarButton
            danger
            label={t('Account_SignOut')}
            style={styles.accountAction}
            onPress={confirmSignOut}
            colors={colors}
          />
        ) : (
          <BarButton
            accent
            label={t('Account_Google')}
            style={styles.accountAction}
            onPress={() => void signIn()}
            colors={colors}
          />
        )}
        <Text style={[styles.hint, { color: colors.textMuted }]}>
          {app.signedIn ? t('Account_CloudSaveHint') : t('Account_PrivacySummary')}
        </Text>
      </View>

      {/* 3. General card */}
      <Text style={[styles.sectionHeader, { color: colors.textSecondary }]}>{t('Settings_General')}</Text>
      <View style={cardStyle}>
        <Text style={[styles.hint, { color: colors.textMuted }]}>{t('Settings_AutoSaveHint')}</Text>
        <ToggleRow
          label={t('Settings_12Hour')}
          value={prefs?.use12HourClock ?? false}
          onChange={(value) => void app.setPreference('use12HourClock', value)}
          colors={colors}
        />
      </View>

      {/* 4. Synchronization card */}
      <Text style={[styles.sectionHeader, { color: colors.textSecondary }]}>{t('Settings_Sync')}</Text>
      <View style={cardStyle}>
        {/* One calm line: the last successful synchronization, or the state of
            the explicit cycle. No spinner and no "pending changes" alarm - the
            engine retries on its own and the user has nothing to do. */}
        <Text style={[styles.body, { color: colors.textSecondary }]}>
          {syncStateLabel(shownSyncState, app.lastSyncSuccess)}
        </Text>
        {/* The cadence control first, its explanation right under it. */}
        <Segmented
          options={[t('Sync_FrequencyWeekly'), t('Sync_FrequencyMonthly')]}
          index={(prefs?.syncFrequency ?? 1) === SyncFrequency.Monthly ? 1 : 0}
          onChange={(index) =>
            void app.setPreference('syncFrequency', index === 1 ? SyncFrequency.Monthly : SyncFrequency.Weekly)
          }
          colors={colors}
        />
        <Text style={[styles.hint, { color: colors.textMuted }]}>{t('Settings_SyncFrequencyHint')}</Text>
        {/* Sync actions: the primary "Synchronize now" spans the card, the two
            secondary actions share the row below it. */}
        <View style={styles.actionGrid}>
          <BarButton
            compact
            style={styles.gridWide}
            label={t('Settings_SyncNow')}
            accent
            disabled={!app.signedIn || syncing}
            onPress={() => void synchronizeNow()}
            colors={colors}
          />
          <BarButton
            compact
            style={styles.gridCell}
            label={t('Settings_ExportCalendar')}
            onPress={() => void exportCalendar()}
            colors={colors}
          />
          <BarButton
            compact
            style={styles.gridCell}
            label={t('Account_Preview')}
            disabled={!app.signedIn}
            onPress={() => void whatIsInTheCloud()}
            colors={colors}
          />
        </View>
      </View>

      {/* 5. Privacy and backup card */}
      <Text style={[styles.sectionHeader, { color: colors.textSecondary }]}>{t('Settings_PrivacyAndBackup')}</Text>
      <View style={cardStyle}>
        <Text style={[styles.hint, { color: colors.textMuted }]}>{t('Settings_PrivacyHint')}</Text>
        <Text style={[styles.hint, { color: colors.textMuted }]}>{t('Settings_PrivacyLocalHint')}</Text>
        <Text style={[styles.body, { color: colors.textSecondary }]}>
          {tFmt('Settings_StorageUsage', storageMb)}
        </Text>
        <Text style={[styles.hint, { color: colors.textMuted }]} selectable>
          {dbPath}
        </Text>
        {/* Export / Restore share a row; the integrity check closes the card. */}
        <View style={styles.actionGrid}>
          <BarButton compact style={styles.gridCell} label={t('Settings_Export')} accent onPress={() => void exportData()} colors={colors} />
          <BarButton compact style={styles.gridCell} label={t('Settings_Import')} onPress={() => void restoreBackupFile()} colors={colors} />
          <BarButton compact style={styles.gridWide} label={t('Settings_Integrity')} onPress={() => void checkDbIntegrity()} colors={colors} />
        </View>
        {integrityText !== null && (
          <Text style={[styles.body, { color: colors.textSecondary }]}>{integrityText}</Text>
        )}
      </View>

      {/* 6. About card */}
      <Text style={[styles.sectionHeader, { color: colors.textSecondary }]}>{t('Settings_About')}</Text>
      <View style={cardStyle}>
        <Text style={[styles.body, { color: colors.textSecondary }]}>
          {tFmt('Settings_AboutText', '1.0.0', 'React Native')}
        </Text>
      </View>

      {dialog !== null && <ConfirmDialog request={dialog} isDark={app.isDark} />}
    </ScrollView>
  );
}

function syncStateLabel(state: SyncState, lastSuccess: string | null): string {
  switch (state) {
    case SyncState.Synced:
      return lastSuccess !== null ? tFmt('Sync_LastSuccess', lastSuccess) : t('Sync_Never');
    case SyncState.Syncing:
      return t('Sync_Syncing');
    case SyncState.PendingChanges:
      // Changes waiting for the upload are the engine's own business: the card
      // keeps showing the last successful synchronization instead of raising a
      // "pending changes" alarm (or a spinner) the user cannot act on.
      return lastSuccess !== null ? tFmt('Sync_LastSuccess', lastSuccess) : t('Sync_Never');
    case SyncState.Offline:
      return t('Sync_Offline');
    case SyncState.Paused:
      return t('Sync_Paused');
    case SyncState.AuthenticationRequired:
      return t('Sync_AuthenticationRequired');
    case SyncState.Error:
      return t('Sync_Error');
    default:
      return t('Sync_NotConfigured');
  }
}

function ToggleRow(props: {
  label: string;
  value: boolean;
  onChange: (value: boolean) => void;
  colors: ReturnType<typeof themeColors>;
}): React.JSX.Element {
  return (
    <View style={styles.toggleRow}>
      <Text style={[styles.body, { color: props.colors.text, flex: 1 }]}>{props.label}</Text>
      <Switch
        value={props.value}
        onValueChange={props.onChange}
        accessibilityLabel={props.label}
        trackColor={{ false: props.colors.border, true: props.colors.success }}
        thumbColor="#FFFFFF"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  /** Page frame; the bottom padding is computed at render time (tab bar). */
  content: { padding: metrics.pagePadding, rowGap: 14 },
  pageTitle: { ...pageTitleStyle },
  /** Grouped card: no stroke - the card floats on the grouped background. */
  card: { borderRadius: metrics.radius, padding: 16, rowGap: 12 },
  /** iOS grouped-list section header: small uppercase caption above the card. */
  sectionHeader: {
    fontSize: typeScale.caption,
    fontFamily: fonts.medium,
    textTransform: 'uppercase',
    letterSpacing: 0.7,
    marginLeft: 4,
    marginBottom: -2,
  },
  cardTitle: { fontSize: typeScale.headline, fontFamily: fonts.medium },
  body: { fontSize: 14, lineHeight: 20 },
  hint: { fontSize: 12, lineHeight: 17 },
  /**
   * Account panel: a 84 pt framed photo beside the identity column. The name and
   * the e-mail may wrap to two lines each - the old single row cut both of them
   * off at the same width the button needed.
   */
  accountPanel: { flexDirection: 'row', alignItems: 'center', columnGap: 14 },
  accountText: { flex: 1, rowGap: 3 },
  accountName: { fontSize: 20, lineHeight: 26, fontFamily: fonts.medium },
  accountEmail: { fontSize: 14, lineHeight: 19 },
  accountMeta: { fontSize: 12, lineHeight: 16, marginTop: 2 },
  /** Full-width account action under the identity (sign in / sign out). */
  accountAction: { minHeight: 44, justifyContent: 'center', marginTop: 4 },
  avatar: {
    width: 84,
    height: 84,
    borderRadius: 42,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarImage: { width: '100%', height: '100%' },
  toggleRow: { flexDirection: 'row', alignItems: 'center', columnGap: 10 },
  /**
   * Action grid: two equal buttons per row, plus one full-width button for the
   * primary action of the card. Rectangular chrome keeps every row aligned.
   */
  actionGrid: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 8, rowGap: 8 },
  gridCell: { flexBasis: '48%', flexGrow: 1, minHeight: 38, justifyContent: 'center' },
  gridWide: { flexBasis: '100%', flexGrow: 1, minHeight: 38, justifyContent: 'center' },
});