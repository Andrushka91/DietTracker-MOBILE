// Cross-cutting shell component (spec 6): the busy overlay (6.4) for the few
// operations that genuinely block the screen (restore, downloading the account
// preview). Signing in and out is NOT one of them any more - the Settings card
// runs its own small spinner - and background synchronization is silent.

import React from 'react';
import { ActivityIndicator, Modal, StyleSheet, Text, View } from 'react-native';

import { fonts, cardShadow, themeColors } from '../theme';
import { useApp, type BusyStage } from '../appContext';
import { t } from '../strings';

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
});