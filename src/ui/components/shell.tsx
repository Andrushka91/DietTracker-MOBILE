// Cross-cutting shell components (spec 6): the busy overlay (6.4) and the
// synchronization status strip (6.3). Both consume the app context + theme.

import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Modal, StyleSheet, Text, View } from 'react-native';

import { SyncState } from '../../domain/enums';
import { fonts, argb, cardShadow, themeColors, type ThemeColors } from '../theme';
import { useApp, type BusyStage } from '../appContext';
import { t, tFmt } from '../strings';

/** Dark translucent scrim + spinner + stage sentence + hint (spec 6.4). */
export function BusyOverlay(): React.JSX.Element | null {
  const { busy, isDark } = useApp();
  if (busy === null) {
    return null;
  }
  const colors = themeColors(isDark);
  return (
    <Modal transparent animationType="fade" visible>
      <View style={[styles.scrim, { backgroundColor: colors.overlay }]}>
        <View style={[styles.scrimCard, { backgroundColor: colors.surface }]}>
          <ActivityIndicator size="large" color={colors.accent} />
          <Text style={[styles.stage, { color: colors.text }]}>{stageText(busy)}</Text>
          <Text style={[styles.hint, { color: colors.textMuted }]}>{t('Busy_Hint')}</Text>
        </View>
      </View>
    </Modal>
  );
}

function stageText(stage: BusyStage): string {
  switch (stage) {
    case 'sync':
      return t('Busy_Synchronizing');
    case 'uploading':
      return t('Busy_UploadingChanges');
    case 'downloading':
    case 'loadingAccount':
      return t('Busy_Downloading');
    case 'signingIn':
      return t('Busy_WaitingForBrowser');
    case 'signingOut':
      return t('Busy_SigningOut');
    case 'restoring':
      return t('Busy_Restoring');
    case 'waitingForBrowser':
      return t('Busy_WaitingForBrowser');
    default:
      return t('Busy_Hint');
  }
}

/**
 * Status strip below the app bar (spec 6.3): success auto-hides after 6 s;
 * warnings and errors stay until resolved; NotConfigured keeps the strip
 * closed; background cycles never flash it (only the state source matters).
 */
export function SyncStatusStrip(): React.JSX.Element | null {
  const { syncState, lastSyncSuccess, isDark } = useApp();
  const [visible, setVisible] = useState(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const success = syncState === SyncState.Synced && lastSyncSuccess !== null;
    if (hideTimer.current !== null) {
      clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
    if (success) {
      setVisible(true);
      hideTimer.current = setTimeout(() => setVisible(false), 6000);
      return undefined;
    }
    setVisible(syncState !== SyncState.NotConfigured && syncState !== SyncState.Synced);
    return undefined;
  }, [syncState, lastSyncSuccess]);

  if (!visible) {
    return null;
  }
  const colors = themeColors(isDark);
  const style = stripStyle(syncState, colors);
  return (
    <View style={[styles.strip, { backgroundColor: style.background }]}>
      <Text style={[styles.stripText, { color: style.foreground }]} numberOfLines={2}>
        {stripText(syncState, lastSyncSuccess)}
      </Text>
    </View>
  );
}

function stripText(state: SyncState, lastSyncSuccess: string | null): string {
  switch (state) {
    case SyncState.Syncing:
      return t('Sync_Syncing');
    case SyncState.PendingChanges:
      return t('Sync_PendingChanges');
    case SyncState.Paused:
      return t('Sync_Paused');
    case SyncState.Offline:
      return t('Sync_Offline');
    case SyncState.AuthenticationRequired:
      return t('Sync_AuthenticationRequired');
    case SyncState.Error:
      return t('Sync_Error');
    case SyncState.Synced:
      return lastSyncSuccess !== null ? tFmt('Sync_LastSuccess', lastSyncSuccess) : t('Sync_Never');
    default:
      return '';
  }
}

function stripStyle(
  state: SyncState,
  colors: ThemeColors,
): { background: string; foreground: string } {
  switch (state) {
    case SyncState.Synced:
      return { background: colors.success, foreground: argb('#FFFFFFFF') };
    case SyncState.Error:
      return { background: colors.error, foreground: argb('#FFFFFFFF') };
    case SyncState.Offline:
    case SyncState.AuthenticationRequired:
      return { background: colors.warning, foreground: argb('#FF1A1A1A') };
    default:
      return { background: colors.surfaceVariant, foreground: colors.text };
  }
}

const styles = StyleSheet.create({
  scrim: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  scrimCard: {
    borderRadius: 20,
    padding: 24,
    alignItems: 'center',
    minWidth: 240,
    ...cardShadow,
    elevation: 8,
  },
  stage: { marginTop: 16, fontSize: 16, fontFamily: fonts.medium, textAlign: 'center' },
  hint: { marginTop: 6, fontSize: 13, textAlign: 'center' },
  strip: { paddingVertical: 8, paddingHorizontal: 14 },
  stripText: { fontSize: 13, fontFamily: fonts.medium },
});