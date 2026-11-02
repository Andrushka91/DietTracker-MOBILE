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
// Background synchronization never raises it (spec change: silent sync).

import React from 'react';

import { useApp, type BusyStage } from '../appContext';
import type { AccountSyncProgress } from '../../cloud/session';
import { LoadingDialog } from './dialogs';
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
  // without the "this can take a few seconds" warning.
  const shortFlow =
    busy === 'signingIn' || busy === 'signingOut' || busy === 'savingPhoto';
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