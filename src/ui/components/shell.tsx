// Cross-cutting shell component (spec 6): the busy overlay (6.4), the ONE wall
// the app raises while an operation the user started is still running.
//
// Two presentations:
//   account (sign in / sign out)  a transparent, centred spinner + sentence
//                                 straight on the dimmed page - the screen stays
//                                 recognisable and nothing else can be pressed
//                                 until the account change is finished
//   heavy work (restore, preview) the same scrim with a card that adds the
//                                 "this can take a few seconds" hint
//
// Background synchronization never raises it (spec change: silent sync).

import React from 'react';
import { ActivityIndicator, Modal, StyleSheet, Text, View } from 'react-native';

import { fonts, cardShadow, themeColors } from '../theme';
import { useApp, type BusyStage } from '../appContext';
import { t } from '../strings';

/**
 * RN-only wording: the Windows resource table has no "signing in" sentence
 * (desktop hands the flow to the browser), so it lives here like the other
 * mobile-only strings.
 */
const SIGNING_IN = 'Signing in…';

/** Dark translucent scrim + spinner + stage sentence + hint (spec 6.4). */
export function BusyOverlay(): React.JSX.Element | null {
  const { busy, isDark } = useApp();
  if (busy === null) {
    return null;
  }
  const colors = themeColors(isDark);
  // The account flow is short and purely informational: spinner + sentence sit
  // directly on the dimmed page (no card), with white ink because the scrim is
  // the same dark wash in both themes.
  const transparent = busy === 'signingIn' || busy === 'signingOut';
  return (
    // A Modal is its own native window: it swallows every touch and the Android
    // back key (an empty handler keeps it open), so no other control of the app
    // can be pressed while the operation runs.
    <Modal transparent animationType="fade" visible onRequestClose={() => {}}>
      <View style={[styles.scrim, { backgroundColor: colors.overlay }]}>
        {transparent ? (
          <View style={styles.transparentHost}>
            <ActivityIndicator size="large" color={colors.accentFillText} />
            <Text style={[styles.transparentStage, { color: colors.accentFillText }]}>
              {stageText(busy)}
            </Text>
          </View>
        ) : (
          <View style={[styles.scrimCard, { backgroundColor: colors.surface }]}>
            <ActivityIndicator size="large" color={colors.accent} />
            <Text style={[styles.stage, { color: colors.text }]}>{stageText(busy)}</Text>
            <Text style={[styles.hint, { color: colors.textMuted }]}>{t('Busy_Hint')}</Text>
          </View>
        )}
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
      // The Google picker runs inside this app on mobile - there is no browser
      // round trip to wait for, so the sentence says what is happening.
      return SIGNING_IN;
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
  /** Transparent presentation: only the spinner and its sentence. */
  transparentHost: { alignItems: 'center', justifyContent: 'center', rowGap: 14 },
  transparentStage: {
    fontSize: 17,
    fontFamily: fonts.medium,
    textAlign: 'center',
    // Readable on any wallpaper the dimmed page may show behind it.
    textShadowColor: 'rgba(0, 0, 0, 0.45)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
});