// Settings (spec 8.8) - card grid, same order & contents as Windows:
//  1 Guest info (only signed out)   2 Account card
//  3 General (auto-save hint + toggles - every control writes immediately,
//    no Save button)                 4 Synchronization card
//  5 Privacy and backup card         6 About card
//  7 Floating status line (StatusCaption, rendered by the shell)
//
// Signing in and out runs behind the GLOBAL busy overlay (shell.tsx), not a
// button spinner: the account change touches the whole database, so no other
// control of the app may be pressed while it runs.

import React, { useCallback, useEffect, useState } from 'react';
import { Image, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SyncFrequency, SyncState, SyncTrigger } from '../../domain/enums';
import { databasePath } from '../../data/database';
import { checkIntegrity, type IntegrityReport } from '../../data/integrity';
import { backupsDir, createBackup, restoreBackup } from '../../data/backup';
import { totalPhotoBytes, getActiveAccount } from '../../data/repositories';
import RNFS from '../../platform/fs';
import { readTokens } from '../../cloud/auth';
import { previewRestoreFromCloud, restoreFromCloud, runCycle } from '../../cloud/syncEngine';
import { getQuota } from '../../cloud/driveProvider';
import { useApp } from '../appContext';
import { BarButton, Segmented } from '../components/buttons';
import { ConfirmDialog, type ConfirmRequest } from '../components/dialogs';
import { fonts, metrics, cardShadow, themeColors, typeScale } from '../theme';
import { formatMegabytes, t, tFmt } from '../strings';

/**
 * Height the floating tab bar needs at the bottom of a scrolling page: the bar
 * itself (66 pt) plus its 10 pt margin plus breathing room, so the last card of
 * a page is never hidden behind it.
 */
const FLOATING_TAB_BAR_CLEARANCE = 110;

export function SettingsScreen(): React.JSX.Element {
  const app = useApp();
  const colors = themeColors(app.isDark);
  const insets = useSafeAreaInsets();
  const [dbPath, setDbPath] = useState('');
  const [storageMb, setStorageMb] = useState('0.00');
  const [quotaLine, setQuotaLine] = useState<string | null>(null);
  const [accountIdentity, setAccountIdentity] = useState<{ email: string; photoUrl: string }>({
    email: '',
    photoUrl: '',
  });
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
      setAccountIdentity({ email: '', photoUrl: '' });
      return;
    }
    void (async () => {
      try {
        const account = await getActiveAccount();
        const tokens = await readTokens();
        setAccountIdentity({
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
        const { showSyncResultNotification } = await import('../../services/reminders');
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
      const { getDeviceId } = await import('../../services/deviceId');
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
        // tab bar and the back key) until the account change is done.
        app.setBusy('signingOut');
        let result: Awaited<ReturnType<typeof app.signOut>>;
        try {
          result = await app.signOut(false);
        } finally {
          app.setBusy(null);
        }
        if (!result.ok) {
          // Pending-changes refusal: offer the explicit discard path.
          setDialog({
            title: t('Account_SignOutPendingTitle'),
            message: `${t('Account_SignOutPendingDetail').replace('{0}', String(result.pending ?? 0))}\n\n${t('Account_SignOutPendingMessage')}`,
            cancelText: t('Common_No'),
            confirmText: t('Account_SignOut'),
            destructive: true,
            onCancel: () => {
              setDialog(null);
              app.showStatus(t('Account_SignOutPendingKept'));
            },
            onConfirm: async () => {
              setDialog(null);
              app.setBusy('signingOut');
              try {
                await app.signOut(true);
                app.showStatus(t('Account_SignOutDiscarded'));
              } finally {
                app.setBusy(null);
              }
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
   * GLOBAL overlay shows the spinner and its sentence, and nothing else on the
   * page can be pressed while the picker, the adoption and the first download
   * are running. No confirmation wall.
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
      app.showStatus(t('Account_SignedIn'));
      await refreshFacts();
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
        { paddingBottom: FLOATING_TAB_BAR_CLEARANCE + Math.max(insets.bottom, 10) },
      ]}>
      <Text style={[styles.pageTitle, { color: colors.text }]}>{t('Nav_Settings')}</Text>
      {!app.signedIn && (
        <View style={cardStyle}>
          <Text style={[styles.cardTitle, { color: colors.text }]}>{t('Account_GuestInfo')}</Text>
          <Text style={[styles.body, { color: colors.textSecondary }]}>{t('Account_PrivacySummary')}</Text>
        </View>
      )}

      {/* 2. Account card */}
      <Text style={[styles.sectionHeader, { color: colors.textMuted }]}>{t('Settings_Account')}</Text>
      <View style={cardStyle}>
        {/* One user tile: avatar, identity and the account action at the end of
            the same row - no second row of buttons under the identity. */}
        <View style={styles.accountRow}>
          <View
            style={[
              styles.avatar,
              { backgroundColor: colors.surfaceVariant, borderColor: colors.border },
            ]}>
            {accountIdentity.photoUrl !== '' ? (
              <Image source={{ uri: accountIdentity.photoUrl }} style={styles.avatarImage} />
            ) : (
              <Text style={[styles.avatarGlyph, { color: colors.textMuted }]}>👤</Text>
            )}
          </View>
          <View style={styles.accountText}>
            <Text style={[styles.accountName, { color: colors.text }]} numberOfLines={1} selectable>
              {app.signedIn
                ? accountIdentity.email !== ''
                  ? accountIdentity.email
                  : t('Account_SignedIn')
                : t('Account_NoEmail')}
            </Text>
            <Text style={[styles.accountMeta, { color: colors.textSecondary }]} numberOfLines={1}>
              {app.signedIn
                ? quotaLine ?? t('Account_ProviderGoogle')
                : t('Account_ProviderNone')}
            </Text>
          </View>
          {/* The buttons never carry a spinner: the global busy overlay covers
              the whole screen while Google runs, so the card keeps its layout -
              no label swap, no size jump, and no second tap can slip through. */}
          {app.signedIn ? (
            <BarButton
              compact
              danger
              label={t('Account_SignOut')}
              style={styles.accountAction}
              onPress={confirmSignOut}
              colors={colors}
            />
          ) : (
            <BarButton
              compact
              accent
              label={t('Account_Google')}
              style={styles.accountAction}
              onPress={() => void signIn()}
              colors={colors}
            />
          )}
        </View>
        <Text style={[styles.hint, { color: colors.textMuted }]}>{t('Account_CloudSaveHint')}</Text>
      </View>

      {/* 3. General card */}
      <Text style={[styles.sectionHeader, { color: colors.textMuted }]}>{t('Settings_General')}</Text>
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
      <Text style={[styles.sectionHeader, { color: colors.textMuted }]}>{t('Settings_Sync')}</Text>
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
      <Text style={[styles.sectionHeader, { color: colors.textMuted }]}>{t('Settings_PrivacyAndBackup')}</Text>
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
      <Text style={[styles.sectionHeader, { color: colors.textMuted }]}>{t('Settings_About')}</Text>
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
  content: { padding: 12, rowGap: 12 },
  pageTitle: { fontSize: typeScale.title, fontFamily: fonts.medium },
  /** Grouped card: no stroke - the card floats on the grouped background. */
  card: { borderRadius: metrics.radius, padding: 16, rowGap: 10 },
  /** iOS grouped-list section header: small uppercase caption above the card. */
  sectionHeader: {
    fontSize: typeScale.footnote,
    fontFamily: fonts.medium,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginLeft: 4,
    marginBottom: -4,
  },
  cardTitle: { fontSize: typeScale.headline, fontFamily: fonts.medium },
  body: { fontSize: 13, lineHeight: 18 },
  hint: { fontSize: 11, lineHeight: 15 },
  /** User tile: avatar + identity + the account action, all on one row. */
  accountRow: { flexDirection: 'row', alignItems: 'center', columnGap: 12 },
  accountText: { flex: 1, rowGap: 2 },
  accountName: { fontSize: 14, fontFamily: fonts.medium },
  accountMeta: { fontSize: 12 },
  /** Wide enough for "Sign in with Google" - the action never ellipsizes. */
  accountAction: { minWidth: 112, minHeight: 36, justifyContent: 'center' },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarGlyph: { fontSize: 22 },
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