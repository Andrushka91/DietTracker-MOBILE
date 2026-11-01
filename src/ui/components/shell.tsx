// Cross-cutting shell component (spec 6): the busy overlay (6.4), the ONE wall
// the app raises while an operation the user started is still running.
//
// Three presentations:
//   account (sign in)             a transparent, centred spinner + sentence
//                                 straight on the dimmed page - the screen stays
//                                 recognisable and nothing else can be pressed
//                                 until the account change is finished
//   sign-out upload               the same wall with a DETERMINATE bar from 0 %
//                                 to 100 %: every change the app saves to the
//                                 account moves it, and there is deliberately no
//                                 "skip" control - the records must reach the
//                                 cloud before this device gives them up
//   heavy work (restore, preview) the same scrim with a card that adds the
//                                 "this can take a few seconds" hint
//
// Background synchronization never raises it (spec change: silent sync).

import React from 'react';
import { ActivityIndicator, Modal, StyleSheet, Text, View } from 'react-native';

import { fonts, cardShadow, themeColors } from '../theme';
import { useApp, type BusyStage } from '../appContext';
import type { AccountSyncProgress } from '../../cloud/session';
import { t } from '../strings';

/**
 * RN-only wording: the Windows resource table has no "signing in" sentence
 * (desktop hands the flow to the browser), so it lives here like the other
 * mobile-only strings.
 */
const SIGNING_IN = 'Signing in…';

/**
 * RN-only wording of the account boundary bar (no Windows resource exists).
 *
 * The bar is not an "upload" screen: it is the moment the phone proves that it
 * and the account hold the same records - in BOTH directions. Signing out
 * pushes what is only here, signing in pulls the account's whole dataset, and
 * the user waits behind the same wall until it is done.
 */
const SYNC_HINT = 'Please keep the app open until it has synced with the cloud.';
const SYNC_WAITING = 'Waiting for the connection… retrying';
const SYNC_COUNT = '{0} of {1} change(s) synced with the cloud';
const LOAD_COUNT = '{0} of {1} document(s) received from the cloud';

/** 0-1 of the bar; `finishing` is the full bar, `preparing` is an empty one. */
function progressRatio(progress: AccountSyncProgress): number {
  if (progress.stage === 'finishing') {
    return 1;
  }
  if (progress.total <= 0) {
    return 0;
  }
  return Math.min(1, Math.max(0, progress.settled / progress.total));
}

/** Dark translucent scrim + spinner + stage sentence + hint (spec 6.4). */
export function BusyOverlay(): React.JSX.Element | null {
  const { busy, busyProgress, isDark } = useApp();
  if (busy === null) {
    return null;
  }
  const colors = themeColors(isDark);
  if (busyProgress !== null) {
    return <ProgressOverlay busy={busy} progress={busyProgress} />;
  }
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
/**
 * The account boundary bar: a blocking card with a bar that fills from 0 % to
 * 100 %. Signing out: every pending change reaches the account. Signing in:
 * every document of the account's dataset lands on the device - the user may
 * only continue once the app really holds their records.
 *
 * No cancel/skip button exists on purpose: the data must travel before the local
 * cache is deleted (sign-out) or shown (sign-in), so the only way out is to let
 * it finish (or to wait for the refusal, which keeps all data and returns to the
 * page).
 */
function ProgressOverlay({
  busy,
  progress,
}: {
  busy: BusyStage;
  progress: AccountSyncProgress;
}): React.JSX.Element {
  const { isDark } = useApp();
  const colors = themeColors(isDark);
  const ratio = progressRatio(progress);
  const percent = Math.round(ratio * 100);
  const title = progressTitle(progress);
  const detail = progressDetail(progress);
  return (
    <Modal transparent animationType="fade" visible onRequestClose={() => {}}>
      <View style={[styles.scrim, { backgroundColor: colors.overlay }]}>
        <View style={[styles.progressCard, { backgroundColor: colors.surface }]}>
          <Text style={[styles.progressTitle, { color: colors.text }]}>{title}</Text>
          <View style={[styles.track, { backgroundColor: colors.surfaceVariant }]}>
            <View style={[styles.fill, { width: `${percent}%`, backgroundColor: colors.accent }]} />
          </View>
          <View style={styles.progressMeta}>
            <Text style={[styles.percent, { color: colors.text }]}>{`${percent}%`}</Text>
            <Text style={[styles.progressDetail, { color: colors.textMuted }]} numberOfLines={1}>
              {detail}
            </Text>
          </View>
          <Text style={[styles.hint, { color: colors.textMuted }]}>{SYNC_HINT}</Text>
          <Text style={[styles.stageCaption, { color: colors.textMuted }]}>{stageText(busy)}</Text>
        </View>
      </View>
    </Modal>
  );
}

/**
 * The sentence above the bar. Sign-out ends with "Signing out…", sign-in with
 * "Opening your account…", and both spend their middle on the same promise:
 * the phone and the account are about to hold the same records.
 */
function progressTitle(progress: AccountSyncProgress): string {
  switch (progress.stage) {
    case 'finishing':
      return progress.mode === 'signOut' ? t('Busy_SigningOut') : t('Busy_OpeningAccount');
    case 'preparing':
      return progress.mode === 'signOut' ? t('Busy_SyncingChanges') : SIGNING_IN;
    case 'uploading':
      return t('Busy_SyncingChanges');
    case 'downloading':
    case 'waiting':
    default:
      return t('Busy_SyncingAccount');
  }
}

/** "12 of 40 document(s) received from the cloud" under the bar. */
function progressDetail(progress: AccountSyncProgress): string {
  if (progress.stage === 'waiting') {
    return SYNC_WAITING;
  }
  if (progress.total <= 0) {
    // Nothing to count yet (the account is being prepared): the title already
    // says what is happening, so the line stays empty instead of repeating it.
    return progress.stage === 'preparing'
      ? ''
      : t(progress.mode === 'signIn' ? 'Busy_SyncingAccount' : 'Busy_SyncingChanges');
  }
  const template = progress.mode === 'signOut' ? SYNC_COUNT : LOAD_COUNT;
  return template
    .replace('{0}', String(progress.settled))
    .replace('{1}', String(progress.total));
}


function stageText(stage: BusyStage): string {
  switch (stage) {
    case 'sync':
      return t('Busy_Synchronizing');
    case 'uploading':
      return t('Busy_SyncingChanges');
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
  /**
   * Sign-out upload bar: iOS alert proportions, a 8 pt rounded track and the
   * accent fill - wide enough to read the percentage from arm's length.
   */
  progressCard: {
    borderRadius: 20,
    padding: 22,
    alignItems: 'stretch',
    width: '100%',
    maxWidth: 330,
    ...cardShadow,
    elevation: 8,
  },
  progressTitle: { fontSize: 17, fontFamily: fonts.medium, textAlign: 'center' },
  track: { height: 8, borderRadius: 4, marginTop: 18, overflow: 'hidden' },
  fill: { height: 8, borderRadius: 4 },
  progressMeta: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    columnGap: 10,
    marginTop: 8,
  },
  percent: { fontSize: 20, fontFamily: fonts.medium },
  progressDetail: { flexShrink: 1, fontSize: 12, textAlign: 'right' },
  /** The stage sentence repeats the operation under the bar (e.g. "Signing out…"). */
  stageCaption: { marginTop: 10, fontSize: 12, textAlign: 'center' },
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