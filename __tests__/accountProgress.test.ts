// The account-boundary wording is painted by two surfaces - the bottom busy
// sheet (sign-in, short steps) and the centered sign-out card - so the bar
// maths and the sentences live in one module and are pinned here. A drift
// between the two surfaces would tell the user two different stories about the
// same upload.

import {
  SIGNING_IN,
  SYNC_HINT,
  progressDetail,
  progressRatio,
  progressTitle,
  signInSheetCopy,
  signOutCardCopy,
} from '../src/ui/accountProgress';
import type { AccountSyncProgress } from '../src/cloud/session';
import { t } from '../src/ui/strings';

function frame(
  mode: AccountSyncProgress['mode'],
  stage: AccountSyncProgress['stage'],
  settled = 0,
  total = 0,
): AccountSyncProgress {
  return { mode, stage, settled, total };
}

describe('the account boundary bar', () => {
  test('fills from 0 % to 100 % and never leaves the track', () => {
    expect(progressRatio(frame('signOut', 'preparing', 0, 5))).toBe(0);
    expect(progressRatio(frame('signOut', 'uploading', 3, 5))).toBeCloseTo(0.6);
    // A settled count above the total (a re-sent document) cannot overflow.
    expect(progressRatio(frame('signOut', 'uploading', 7, 5))).toBe(1);
    expect(progressRatio(frame('signOut', 'finishing', 5, 5))).toBe(1);
  });

  test('names the stage, in both directions', () => {
    expect(progressTitle(frame('signOut', 'uploading'))).toBe(t('Busy_SyncingChanges'));
    expect(progressTitle(frame('signOut', 'finishing'))).toBe(t('Busy_SigningOut'));
    expect(progressTitle(frame('signIn', 'finishing'))).toBe(t('Busy_OpeningAccount'));
    expect(progressTitle(frame('signIn', 'preparing'))).toBe(SIGNING_IN);
    expect(progressTitle(frame('signIn', 'downloading'))).toBe(t('Busy_SyncingAccount'));
  });

  test('counts what it uploaded, or what it received', () => {
    expect(progressDetail(frame('signOut', 'uploading', 3, 5))).toBe(
      '3 of 5 change(s) synced with the cloud',
    );
    expect(progressDetail(frame('signIn', 'downloading', 2, 4))).toBe(
      '2 of 4 document(s) received from the cloud',
    );
    expect(progressDetail(frame('signOut', 'waiting', 1, 5))).toBe(
      'Waiting for the connection… retrying',
    );
    // Nothing to count while the account is prepared: the title carries it.
    expect(progressDetail(frame('signOut', 'preparing', 0, 0))).toBe('');
  });

  test('carries the one promise both surfaces repeat', () => {
    expect(SYNC_HINT).toBe('Please keep the app open until it has synced with the cloud.');
  });
});

describe('the sign-in sheet copy', () => {
  test('starts with the headline and no count to show yet', () => {
    expect(signInSheetCopy(null)).toEqual({
      title: 'Syncing your data',
      subtitle: 'Preparing your account',
      hint: 'Keep the app open until syncing finishes.',
    });
  });

  test('names the step and counts what arrived', () => {
    // The mockup's frame: 66 of 73 documents received.
    expect(signInSheetCopy(frame('signIn', 'downloading', 66, 73))).toEqual({
      title: 'Syncing your data',
      subtitle: 'Downloading your saved meals and photos',
      count: '66 of 73 items received',
      hint: 'Keep the app open until syncing finishes.',
    });
    // Adopting the guest records is a SEND, not a receive.
    expect(signInSheetCopy(frame('signIn', 'uploading', 5, 5)).count).toBe('5 of 5 items sent');
    // Nothing countable yet: the line is left out instead of reading "0 of 0".
    expect(signInSheetCopy(frame('signIn', 'downloading', 0, 0)).count).toBeUndefined();
    expect(signInSheetCopy(frame('signIn', 'preparing', 0, 0)).subtitle).toBe(
      'Preparing your account',
    );
  });

  test('says what the last steps are doing', () => {
    expect(signInSheetCopy(frame('signIn', 'waiting', 3, 9)).subtitle).toBe(
      'Waiting for the connection… retrying',
    );
    expect(signInSheetCopy(frame('signIn', 'finishing', 9, 9)).subtitle).toBe(
      'Opening your account',
    );
  });
});


describe('the sign-out card copy', () => {
  test('starts on an empty bar with the promise and no count', () => {
    expect(signOutCardCopy(null)).toEqual({
      progress: 0,
      hint: 'Please keep the app open.',
    });
  });

  test('counts the settled changes in the mockup words', () => {
    expect(signOutCardCopy(frame('signOut', 'uploading', 1, 3))).toEqual({
      progress: 1 / 3,
      detail: '1 of 3 changes synced',
      hint: 'Please keep the app open.',
    });
    // A single queued change reads in the singular.
    expect(signOutCardCopy(frame('signOut', 'uploading', 0, 1)).detail).toBe('0 of 1 change synced');
    // Nothing queued: no count line at all instead of "0 of 0".
    expect(signOutCardCopy(frame('signOut', 'preparing', 0, 0)).detail).toBeUndefined();
    // A down connection replaces the count with the waiting line.
    expect(signOutCardCopy(frame('signOut', 'waiting', 1, 3)).detail).toBe(
      'Waiting for the connection… retrying',
    );
  });
});

