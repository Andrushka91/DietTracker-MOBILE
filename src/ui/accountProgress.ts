// The wording of the account boundary (sign-in / sign-out).
//
// The same sentences are painted by TWO surfaces: the app-wide busy sheet
// (`BusyOverlay` in components/shell.tsx) for sign-in and the short steps, and
// the centered account card (`AccountCard` in components/dialogs.tsx) that stays
// open while signing out. Keeping the wording and the 0-100 % maths here means
// the card and the sheet can never tell the user two different stories about the
// same upload.

import type { AccountSyncProgress } from '../cloud/session';
import { t, tFmt } from './strings';

/**
 * RN-only wording: the Windows resource table has no "signing in" sentence
 * (desktop hands the flow to the browser), so it lives here like the other
 * mobile-only strings.
 */
export const SIGNING_IN = 'Signing in…';

/**
 * RN-only wording of the account boundary bar (no Windows resource exists).
 *
 * The bar is not an "upload" screen: it is the moment the phone proves that it
 * and the account hold the same records - in BOTH directions. Signing out
 * pushes what is only here, signing in pulls the account's whole dataset, and
 * the user waits behind the same wall until it is done.
 */
export const SYNC_HINT = 'Please keep the app open until it has synced with the cloud.';
const SYNC_WAITING = 'Waiting for the connection… retrying';
const SYNC_COUNT = '{0} of {1} change(s) synced with the cloud';
const LOAD_COUNT = '{0} of {1} document(s) received from the cloud';

/** 0-1 of the bar; `finishing` is the full bar, `preparing` is an empty one. */
export function progressRatio(progress: AccountSyncProgress): number {
  if (progress.stage === 'finishing') {
    return 1;
  }
  if (progress.total <= 0) {
    return 0;
  }
  return Math.min(1, Math.max(0, progress.settled / progress.total));
}

/**
 * The sentence above the bar. Sign-out ends with "Signing out…", sign-in with
 * "Opening your account…", and both spend their middle on the same promise:
 * the phone and the account are about to hold the same records.
 */
export function progressTitle(progress: AccountSyncProgress): string {
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
export function progressDetail(progress: AccountSyncProgress): string {
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

/**
 * The copy of the sign-in sheet (the mockup's "Syncing your data" surface).
 *
 * Signing in is not a message with a spinner: the user is waiting for their
 * account to appear, so the sheet states WHAT is being downloaded, HOW MUCH has
 * arrived and that the app must stay open. The title never changes; the subtitle
 * follows the stage (adopting the guest records, downloading, opening the
 * account) and the count only exists once there is something to count.
 */
export interface SyncSheetCopy {
  /** Constant headline: "Syncing your data". */
  title: string;
  /** Current step, one sentence: "Downloading your saved meals and photos". */
  subtitle: string;
  /** "66 of 73 items received"; omitted until the transfer has a total. */
  count?: string;
  /** The one reassurance under the bar. */
  hint: string;
}

/**
 * The copy of the sign-out card while it works (the round-3 mockup). The card's
 * title and caption are swapped by the screen ("Syncing before sign-out" /
 * "You'll be signed out when syncing finishes."); this is the block underneath:
 * the bar, the counted line in the primary ink and the one reassurance.
 */
export interface SignOutCardCopy {
  /** 0-1 of the bar; 0 before the first frame, so the track is never empty. */
  progress: number;
  /** "1 of 3 changes synced" - or the waiting line while the connection is down. */
  detail?: string;
  /** "Please keep the app open." */
  hint: string;
}

/** "1 of 3 changes synced", singular when the outbox holds a single change. */
function signOutCount(progress: AccountSyncProgress): string | undefined {
  if (progress.total <= 0) {
    return undefined;
  }
  return tFmt(
    progress.total === 1 ? 'Rn_SignOutSyncingCountOne' : 'Rn_SignOutSyncingCount',
    progress.settled,
    progress.total,
  );
}

export function signOutCardCopy(progress: AccountSyncProgress | null): SignOutCardCopy {
  const hint = t('Rn_SignOutSyncingHint');
  if (progress === null) {
    return { progress: 0, hint };
  }
  return {
    progress: progressRatio(progress),
    detail: progress.stage === 'waiting' ? t('Rn_SyncSheetWaiting') : signOutCount(progress),
    hint,
  };
}

/** The subtitle of one account-boundary stage. */
function stageSubtitle(progress: AccountSyncProgress): string {
  switch (progress.stage) {
    case 'preparing':
      return t('Rn_SyncSheetPreparing');
    case 'uploading':
      return t('Rn_SyncSheetUploading');
    case 'waiting':
      return t('Rn_SyncSheetWaiting');
    case 'finishing':
      return t('Rn_SyncSheetOpening');
    case 'downloading':
    default:
      return t('Rn_SyncSheetDownloading');
  }
}

/** "66 of 73 items received" / "... sent", or nothing when total is unknown. */
function stageCount(progress: AccountSyncProgress): string | undefined {
  if (progress.total <= 0) {
    return undefined;
  }
  return tFmt(
    progress.stage === 'uploading' ? 'Rn_SyncSheetSent' : 'Rn_SyncSheetReceived',
    progress.settled,
    progress.total,
  );
}

/**
 * `null` is the first moment of the sign-in (the account is being prepared and
 * no frame has arrived yet): the same sheet, an empty bar and no count.
 */
export function signInSheetCopy(progress: AccountSyncProgress | null): SyncSheetCopy {
  const title = t('Rn_SyncSheetTitle');
  const hint = t('Rn_SyncSheetHint');
  if (progress === null) {
    return { title, subtitle: t('Rn_SyncSheetPreparing'), hint };
  }
  return {
    title,
    subtitle: stageSubtitle(progress),
    count: stageCount(progress),
    hint,
  };
}
