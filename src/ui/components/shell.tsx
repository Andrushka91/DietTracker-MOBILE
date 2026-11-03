// Cross-cutting shell component (spec 6): the busy sheet (6.4), the ONE surface
// the app raises while an operation the user started is still running.
//
// ONE presentation, the app's own bottom dialog: the same grabber, rounded top
// edge and surface fill as every question the app asks, carrying a spinner and
// the stage sentence. The sheet is a Modal of its own, so it swallows every
// touch and the Android back key - nothing else can be pressed until the
// operation is finished.
//
// A stage that can count its documents (the sign-out upload and the sign-in
// download) also fills a DETERMINATE bar from 0 % to 100 % instead of the plain
// spinner row, and there is deliberately no "skip" control: the records must
// reach the cloud before this device gives them up.
//
// The ONE exception is the sign-out: its question is already the centered
// account card, so the SAME card stays open and turns into the progress surface
// (see SettingsScreen) instead of a bottom sheet rising on top of it. The
// wording and the bar maths are shared through `../accountProgress`, so both
// surfaces say exactly the same thing.
//
// Background synchronization never raises it (spec change: silent sync).

import React from 'react';

import { useApp, type BusyStage } from '../appContext';
import {
  SIGNING_IN,
  SYNC_HINT,
  progressDetail,
  progressRatio,
  progressTitle,
  signInSheetCopy,
} from '../accountProgress';
import { LoadingDialog } from './dialogs';
import { t } from '../strings';

/**
 * The app-wide "please wait" surface (spec 6.4): the SAME bottom sheet every
 * question rises in, carrying a spinner and the stage sentence. A stage that can
 * count its documents fills a determinate bar from 0 % to 100 % instead of the
 * plain spinner row. The sheet lives in its own Modal window, so it swallows
 * every touch and the Android back key - nothing else can be pressed until the
 * operation has finished.
 *
 * No cancel/skip control exists on purpose: the data must travel before the local
 * cache is deleted (sign-out) or shown (sign-in), so the only way out is to let
 * it finish (or to wait for the refusal, which keeps all data and returns to the
 * page).
 */
export function BusyOverlay(): React.JSX.Element | null {
  const { busy, busyProgress, isDark } = useApp();
  if (busy === null) {
    return null;
  }
  // Signing in is the one transfer the user waits through with nothing else to
  // do, so it gets the big "Syncing your data" sheet - the mockup's headline,
  // subtitle, thick bar and counted line - from the first frame to the last. The
  // sheet is up before the first frame exists (the picker and the adoption), so
  // it starts on an empty track instead of swapping layouts mid-flow.
  if (busy === 'signingIn' || (busyProgress !== null && busyProgress.mode === 'signIn')) {
    const copy = signInSheetCopy(busyProgress);
    return (
      <LoadingDialog
        name="busy-dialog"
        message={copy.title}
        subtitle={copy.subtitle}
        detail={copy.count}
        hint={copy.hint}
        progress={busyProgress === null ? 0 : progressRatio(busyProgress)}
        isDark={isDark}
      />
    );
  }
  if (busyProgress !== null) {
    return (
      <LoadingDialog
        name="busy-dialog"
        message={progressTitle(busyProgress)}
        detail={progressDetail(busyProgress)}
        hint={SYNC_HINT}
        progress={progressRatio(busyProgress)}
        isDark={isDark}
      />
    );
  }
  // The short steps are purely informational, so the sheet carries the sentence
  // without the "this can take a few seconds" warning. (Signing in has already
  // been answered by the sync sheet above.)
  const shortFlow = busy === 'signingOut' || busy === 'savingPhoto';
  return (
    <LoadingDialog
      name="busy-dialog"
      message={stageText(busy)}
      hint={shortFlow ? undefined : t('Busy_Hint')}
      isDark={isDark}
    />
  );
}

/**
 * The sentence of a stage that has no document to count (the plain spinner
 * row). The counted stages get theirs from `progressTitle`.
 */
function stageText(stage: BusyStage): string {
  switch (stage) {
    case 'sync':
      return t('Busy_Synchronizing');
    case 'savingPhoto':
      // Saving a photograph is local work: the sentence names the file being
      // saved instead of the cloud, which is what the user is waiting for.
      return t('Photo_Uploading');
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

// The busy sheet's own styles live with the shared surface in components/dialogs.tsx
// (LoadingSheet), so this file only names the stages and the sentences.