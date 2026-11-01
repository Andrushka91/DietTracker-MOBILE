// Cloud data session - owns the boundaries of "local SQLite is a working
// cache of exactly ONE signed-in account" (spec 1.2 / docs/synchronization):
//
//  - Before a sign-in: everything pending is uploaded; records the cloud has
//    never seen are ADOPTED (queued + pushed) before anything is deleted, so
//    a cancelled or offline sign-in costs nothing.
//  - After a sign-in: the dataset of the account is downloaded at once
//    (RebuildFromCloud), so the screens show that account only.
//  - Sign-out: pending changes are uploaded first and the user WAITS for that
//    upload: a progress bar reports every document (0-100 %) and there is no
//    "sign out anyway" escape, because leaving the account would delete the
//    only copy of those records. When the upload cannot be finished (offline,
//    provider down, revoked credentials) the sign-out is REFUSED and the cache
//    stays exactly where it is; the user simply tries again later.

import { ProviderType, SyncOperationStatus, SyncStatus } from '../domain/enums';
import { SyncTrigger } from '../domain/enums';
import { newGuid } from '../domain/rules/mealSlotRules';
import { AuthError, readTokens, signIn as googleSignIn, signOutLocal } from './auth';
import {
  countPendingOperations,
  deleteAllAccounts,
  getActiveAccount,
  getActiveProfile,
  getPendingOperations,
  getPreferences,
  purgeLocalRecords,
  upsertAccount,
  upsertMetadata,
  upsertPreferences,
  upsertProfile,
} from '../data/repositories';
import { removeAllPhotoFiles } from '../data/photoStore';
import { closeDb } from '../data/database';
import { getDeviceId } from '../services/deviceId';
import { ensureCategories } from '../services/mealTracking';
import {
  cancelScheduledCycle,
  invalidateRunningCycle,
  pushAllLocalRecords,
  refreshStateAsync,
  runCycle,
  uploadOutbox,
  type OutboxUploadResult,
} from './syncEngine';

/**
 * Upper bound for ONE upload attempt of the sign-out barrier. The phone may be
 * on a dying connection, and Google's endpoints are only bounded because the
 * Drive client aborts its own requests - this deadline keeps the bar moving.
 * Whatever an attempt did not settle is retried (the bar keeps the progress it
 * already reported), and after the last attempt the sign-out is refused.
 */
const ACCOUNT_FLUSH_DEADLINE_MS = 8000;

/**
 * How many times the sign-out barrier retries the outbox, and how long it waits
 * between two attempts. A round that settles at least one document resets the
 * budget, so a long outbox is allowed to take the time it needs; only rounds
 * that achieve NOTHING (a dead connection) count against it.
 */
const SIGN_OUT_UPLOAD_ATTEMPTS = 3;
const SIGN_OUT_UPLOAD_RETRY_MS = 1000;

/**
 * Whole-operation budget of the sign-out upload. The bar is a modal wall, so it
 * must end in a predictable time: every round is deadline-bounded (no new
 * document starts after it), and when the budget is spent the sign-out is
 * refused with the local cache untouched instead of hiding the user forever.
 * A normal outbox - even a first sign-out with photographs - finishes in a few
 * seconds, because the pipeline sends three documents at a time.
 */
const SIGN_OUT_UPLOAD_BUDGET_MS = 30000;

/** Resolves to null when `ms` elapses first; never leaves a dangling rejection. */
async function withDeadline<T>(work: Promise<T>, ms: number): Promise<T | null> {
  // The losing promise keeps running in the background; swallow it so it can
  // never become an unhandled rejection (the engine handles its own errors).
  work.catch(() => undefined);
  let timer: ReturnType<typeof setTimeout> | null = null;
  const deadline = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
  });
  try {
    return await Promise.race([work, deadline]);
  } finally {
    if (timer !== null) {
      clearTimeout(timer);
    }
  }
}

/**
 * True when the outbox holds something that can be sent right now. An entry
 * waiting out its exponential backoff (or one that already exhausted its
 * retries) cannot be uploaded faster by trying again - and a cycle STARTS with
 * a full Drive listing, which is exactly the delay an account change must avoid.
 */
async function hasSendableOperation(accountId: string): Promise<boolean> {
  const pending = await getPendingOperations(accountId);
  const now = Date.now();
  return pending.some(
    (op) =>
      op.status !== SyncOperationStatus.Failed ||
      op.nextAttemptAt === null ||
      Date.parse(op.nextAttemptAt) <= now,
  );
}

/**
 * Uploads the outbox before the session changes, bounded in time. Skips the
 * network entirely when nothing is sendable, so an idle or backoff-only account
 * signs out instantly.
 */
async function flushOutbox(accountId: string): Promise<void> {
  if (!(await hasSendableOperation(accountId))) {
    return;
  }
  await withDeadline(
    runCycle({ trigger: SyncTrigger.Manual, pushOnly: true }),
    ACCOUNT_FLUSH_DEADLINE_MS,
  );
}

/** Waits `ms` without blocking the JS thread (the progress bar keeps moving). */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * One frame of the sign-out barrier, consumed by the busy overlay (shell.tsx):
 *
 *   preparing   the outbox is being counted          (bar at 0 %)
 *   uploading   every settled document moves the bar (uploaded / total)
 *   waiting     an attempt failed, the next is queued (bar holds its position)
 *   finishing   everything is uploaded, the cache is cleared (bar at 100 %)
 */
export interface SignOutProgress {
  stage: 'preparing' | 'uploading' | 'waiting' | 'finishing';
  uploaded: number;
  total: number;
}

/**
 * Sign-in errors that waiting cannot repair: a rejected/removed grant or a
 * missing client configuration ends the sign-out barrier at once.
 */
const FATAL_AUTH_ERRORS = new Set([
  'Auth_google_unauthorized',
  'Auth_google_insufficient_permissions',
  'Auth_google_refresh_rejected',
  'Auth_google_refresh_token_missing',
  'Auth_google_not_configured',
  'Auth_auth_no_account',
]);

/**
 * Empties the outbox before a sign-out, and never gives up while a change is
 * still only on this device:
 *
 *  - the account boundary runs the SHARED upload pipeline (uploadOutbox) itself
 *    instead of asking for a full synchronization cycle: it drains the outbox
 *    directly, so no listing/download of an account that is about to be removed
 *    is paid for, and its progress frames can never be swallowed by a cycle that
 *    happens to be running at the same time (the old code joined that cycle and
 *    the bar stayed at 0 % until it timed out),
 *  - the backoff window of a failed document is ignored (the user is already
 *    waiting behind the bar, a minute-long wait is unacceptable),
 *  - the listing of a round is reused by the next one, so a retry costs one
 *    request per remaining document instead of a fresh folder scan,
 *  - an outbox that keeps shrinking is allowed to take as long as it needs (a
 *    first sign-out can hold hundreds of photographs): only `attempts` rounds in
 *    a row WITHOUT any progress end the barrier, and the whole operation is
 *    bounded by `uploadBudgetMs`,
 *  - a rejected grant ends it at once (retrying revoked credentials only burns
 *    time): the caller then REFUSES the sign-out instead of deleting the only
 *    copy of those records.
 */
async function uploadOutboxBeforeSignOut(
  accountId: string,
  initialPending: number,
  options: SignOutOptions,
  report: (progress: SignOutProgress) => void,
): Promise<{ pending: number; error?: string }> {
  const attempts = Math.max(1, options.maxUploadAttempts ?? SIGN_OUT_UPLOAD_ATTEMPTS);
  const retryDelay = Math.max(0, options.retryDelayMs ?? SIGN_OUT_UPLOAD_RETRY_MS);
  const budget = Math.max(0, options.uploadBudgetMs ?? SIGN_OUT_UPLOAD_BUDGET_MS);
  const total = initialPending;
  const deadlineAt = Date.now() + budget;
  let pending = initialPending;
  let stalledAttempts = 0;
  let fileIndex: OutboxUploadResult['fileIndex'] | undefined;

  while (pending > 0 && stalledAttempts < attempts && Date.now() < deadlineAt) {
    // Every round starts where the previous one stopped: the bar only moves
    // forward, even when a retry sends the same document again.
    const alreadySent = total - pending;
    report({ stage: 'uploading', uploaded: alreadySent, total });
    const round = await uploadOutbox({
      ignoreBackoff: true,
      deadlineAt,
      fileIndex,
      onProgress: (settled) => {
        const sent = Math.min(alreadySent + settled, total);
        report({ stage: 'uploading', uploaded: sent, total });
      },
    });
    fileIndex = round.fileIndex;
    if (round.error !== undefined && FATAL_AUTH_ERRORS.has(round.error)) {
      return { pending: round.pending, error: round.error };
    }
    // Progress resets the budget: the barrier only counts rounds that achieved
    // nothing, which is what a dead connection looks like.
    stalledAttempts = round.pending < pending ? 0 : stalledAttempts + 1;
    pending = round.pending;
    if (pending > 0 && stalledAttempts < attempts && Date.now() < deadlineAt) {
      report({ stage: 'waiting', uploaded: Math.max(0, total - pending), total });
      await delay(retryDelay);
    }
  }

  // A pass that was cut by the deadline may still have settled documents after
  // it returned: the count is the truth, never the number of rounds.
  if (pending > 0) {
    pending = await countPendingOperations(accountId);
  }
  return { pending, error: pending > 0 ? 'Account_SignOutPendingDetail' : undefined };
}

export interface SignInResult {
  ok: boolean;
  /** Localized failure code (Auth_* / Account_*) when ok = false. */
  error?: string;
  /** True while the account's dataset is still being pulled in the background. */
  pendingData?: boolean;
  downloaded?: number;
  adopted?: number;
  /** Documents that still have to be retried after the first cycle. */
  failed?: number;
  /** Records whose two versions were both preserved. */
  conflicts?: number;
}

/**
 * Interactive sign-in with consent (spec 8.1/8.8). 'consentGranted' must be
 * true - signing in without consent is refused with Account_ConsentRequired.
 *
 * Ordering matters and is deliberate:
 *  1. pending changes of the CURRENT account are uploaded (a refusal protects
 *     the only copy),
 *  2. Google sign-in runs - and only when it SUCCEEDED is anything replaced, so
 *     a cancelled or failed sign-in leaves the existing session and all local
 *     data untouched,
 *  3. re-authenticating the SAME Google account keeps the account row, the
 *     journal and the cursor (no purge, nothing is downloaded twice),
 *  4. a DIFFERENT account gets a .dtbackup of the cache first, then the cache is
 *     emptied and the new account's dataset is downloaded.
 */
export async function signInWithGoogle(options: {
  consentGranted: boolean;
}): Promise<SignInResult> {
  if (!options.consentGranted) {
    return { ok: false, error: 'Account_ConsentRequired' };
  }

  // If a DIFFERENT account is active, its pending changes must upload first
  // (refusal protects the only copy). Guest mode has no such gate.
  const existing = await getActiveAccount();
  if (existing !== null) {
    const pending = await countPendingOperations(existing.id);
    if (pending > 0) {
      // Push only and time-boxed: the gate is "is the outbox empty?", not "pull
      // the cloud", and a dying connection must not hold the account switch.
      await flushOutbox(existing.id);
      if ((await countPendingOperations(existing.id)) > 0) {
        return { ok: false, error: 'Account_SignInPendingChanges' };
      }
    }
  }

  // Authenticate FIRST. Until this returns, the local cache is not touched, so
  // cancelling the account picker cannot empty a connected session.
  let tokens;
  try {
    tokens = await googleSignIn();
  } catch (error) {
    if (error instanceof AuthError) {
      return { ok: false, error: error.code };
    }
    return { ok: false, error: 'Auth_Unknown' };
  }

  const sameAccount =
    existing !== null &&
    existing.providerType === ProviderType.Google &&
    existing.providerUserId === tokens.userId;

  if (existing !== null && !sameAccount) {
    // The cache belongs to the previous account: keep a backup, then replace it.
    await backupBeforeAccountSwitch();
    // Any cycle of the old session still in flight must not write into the
    // cache the new account is about to fill.
    invalidateRunningCycle();
    await purgeLocalRecords();
    await removeAllPhotoFiles();
    await deleteAllAccounts();
    // The five permanent categories are configuration, not account data.
    await ensureCategories();
  }

  const profile = await getActiveProfile();
  const now = new Date().toISOString();
  const accountId = sameAccount && existing !== null ? existing.id : newGuid();

  if (sameAccount && existing !== null) {
    // Only refresh the identity data; the journal, the cursor and the local
    // records stay exactly as they are.
    await upsertAccount({
      ...existing,
      displayName: tokens.displayName === '' ? existing.displayName : tokens.displayName,
      email: tokens.email,
      isActive: 1,
      lastAuthenticatedAt: now,
    });
  } else {
    await upsertAccount({
      id: accountId,
      providerType: ProviderType.Google,
      providerUserId: tokens.userId,
      displayName: tokens.displayName,
      email: tokens.email,
      rootFolderId: null,
      lastAuthenticatedAt: now,
      lastSynchronizedAt: null,
      isActive: 1,
      synchronizationEnabled: 1,
      quotaTotalBytes: null,
      quotaRemainingBytes: null,
    });
    await upsertMetadata({
      cloudAccountId: accountId,
      providerType: ProviderType.Google,
      lastSyncCursor: null,
      lastSyncTimestamp: null,
      schemaVersion: 1,
      deviceId: await getDeviceId(),
      manifestRevision: null,
      lastFullUploadAt: null,
    });
  }

  if (profile !== null) {
    await upsertProfile({
      ...profile,
      providerType: ProviderType.Google,
      providerUserId: tokens.userId,
      email: tokens.email,
      displayName: tokens.displayName === '' ? profile.displayName : tokens.displayName,
      isActive: 1,
      syncStatus: SyncStatus.PendingUpload,
    });
    const prefs = await getPreferences(profile.id);
    if (prefs !== null) {
      await upsertPreferences({
        ...prefs,
        synchronizationEnabled: true,
        cloudUploadConsentGranted: true,
        preferredProvider: ProviderType.Google,
        syncStatus: SyncStatus.PendingUpload,
      });
    }
  }

  // Adopt everything the cloud has never seen (spec 1.2 - first sign-in).
  const adopted = await pushAllLocalRecords();

  // Pull this account's dataset at once - but not on the user's clock. On a
  // populated account the first download touches every meal document and every
  // photograph, which kept the "Sign in" spinner on screen for a minute. The
  // account is connected immediately and the pull runs in the background; the
  // screens refill themselves as the records land (subscribeDataChange), and a
  // failure is retried by the regular triggers.
  void runCycle({ trigger: SyncTrigger.PostSignIn }).catch((error) => {
    console.warn('[session] the first download after sign-in failed', error);
  });

  return { ok: true, pendingData: true, adopted, downloaded: 0 };
}

/**
 * Writes a .dtbackup of the current cache before an account switch empties it.
 * A failed backup must never block the switch (the records were already
 * uploaded), but it is logged so the situation is visible.
 */
async function backupBeforeAccountSwitch(): Promise<void> {
  try {
    const { createBackup } = await import('../data/backup');
    const result = await createBackup(await getDeviceId());
    console.info('[session] account switch backup written', result.path, result.counts);
  } catch (error) {
    console.warn('[session] account switch backup failed', error);
  }
}

export interface SignOutResult {
  ok: boolean;
  /** Number of changes still waiting for the cloud (refusal path). */
  pending?: number;
  error?: string;
}

export interface SignOutOptions {
  /**
   * Internal escape hatch used only by the unit tests (there is NO user-facing
   * "sign out without uploading"): true skips the upload barrier entirely.
   */
  discardChanges?: boolean;
  /** Progress frames for the 0-100 % bar of the busy overlay. */
  onProgress?: (progress: SignOutProgress) => void;
  /** Test tuning: how many upload rounds / how long between them. */
  maxUploadAttempts?: number;
  retryDelayMs?: number;
  /** Test tuning: whole-operation budget of the upload barrier. */
  uploadBudgetMs?: number;
}

/**
 * Sign-out: upload pending (0-100 % bar, no way to skip) -> credentials removed
 * -> local cache deleted.
 *
 * The upload is NOT optional: nothing on this phone may be deleted while it is
 * still the only copy of a record. When the outbox cannot be emptied the whole
 * operation is refused and the cache stays untouched - the user retries later.
 */
export async function signOutGoogle(options: SignOutOptions = {}): Promise<SignOutResult> {
  const report = options.onProgress ?? (() => undefined);
  const account = await getActiveAccount();
  if (account === null) {
    // Guest/local session: nothing to upload, just clear local auth state.
    invalidateRunningCycle();
    await signOutLocal();
    return { ok: true, pending: 0 };
  }

  const pending = await countPendingOperations(account.id);
  if (options.discardChanges !== true) {
    // Nothing that is only queued may start once the bar is up: a cycle that
    // began concurrently would list and download an account that is about to be
    // removed, and it would compete with the barrier for the same documents.
    cancelScheduledCycle();
    report({ stage: 'preparing', uploaded: 0, total: pending });
    if (pending > 0) {
      const upload = await uploadOutboxBeforeSignOut(account.id, pending, options, report);
      if (upload.pending > 0) {
        // Nothing was purged yet: the local copy is intact and the user can try
        // again as soon as the connection (or the account) is back.
        return { ok: false, pending: upload.pending, error: upload.error };
      }
    }
  }
  // The bar reads 100 % while the credentials and the cache are removed - the
  // last step of the operation the user started.
  report({ stage: 'finishing', uploaded: pending, total: pending });

  // The cache of this account ends here. Whatever cycle is still in flight (a
  // flush that hit the deadline, the periodic pull) must stop before the purge
  // creates the guest database it would otherwise write into.
  invalidateRunningCycle();
  await signOutLocal();
  await purgeLocalRecords();
  await removeAllPhotoFiles();
  await deleteAllAccounts();
  await closeDb();
  await refreshStateAsync();
  return { ok: true, pending: 0 };
}

/** True when a session exists in the keychain (UI decides signed-in state). */
export async function hasStoredSession(): Promise<boolean> {
  return (await readTokens()) !== null;
}
