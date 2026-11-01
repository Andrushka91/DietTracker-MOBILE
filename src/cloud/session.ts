// Cloud data session - owns the boundaries of "local SQLite is a working
// cache of exactly ONE signed-in account" (spec 1.2 / docs/synchronization):
//
//  - Before a sign-in: everything pending is uploaded; records the cloud has
//    never seen are ADOPTED (queued + pushed) before anything is deleted, so
//    a cancelled or offline sign-in costs nothing.
//  - After a sign-in: the dataset of the account is downloaded at once
//    (RebuildFromCloud), so the screens show that account only.
//  - Sign-out: pending changes are uploaded first; if they cannot be uploaded
//    the operation is REFUSED (deleting the cache would delete the only copy)
//    unless the user explicitly discards them. Then credentials are removed
//    and the whole local cache is deleted.

import { ProviderType, SyncStatus } from '../domain/enums';
import { SyncTrigger } from '../domain/enums';
import { newGuid } from '../domain/rules/mealSlotRules';
import { AuthError, readTokens, signIn as googleSignIn, signOutLocal } from './auth';
import {
  countPendingOperations,
  deleteAllAccounts,
  getActiveAccount,
  getActiveProfile,
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
import { pushAllLocalRecords, refreshStateAsync, runCycle } from './syncEngine';

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
      // Push only: the gate is "is the outbox empty?", not "pull the cloud".
      await runCycle({ trigger: SyncTrigger.Manual, pushOnly: true });
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

/**
 * Sign-out: upload pending -> credentials removed -> local cache deleted.
 * When changes cannot be uploaded the operation is refused unless the user
 * explicitly discards them (spec 1.2 / Account_SignOutPending*).
 */
export async function signOutGoogle(options: {
  discardChanges: boolean;
}): Promise<SignOutResult> {
  const account = await getActiveAccount();
  if (account === null) {
    // Guest/local session: nothing to upload, just clear local auth state.
    await signOutLocal();
    return { ok: true, pending: 0 };
  }

  if (!options.discardChanges) {
    // Upload only what is actually still waiting: an idle sign-out must not sit
    // through a full cycle (a listing plus a pull of the other device's changes)
    // just to discover there is nothing to send. The upload itself is a
    // push-only pass for the same reason - the cache is about to be deleted, so
    // downloading the other device's documents first is pure waiting.
    if ((await countPendingOperations(account.id)) > 0) {
      await runCycle({ trigger: SyncTrigger.Manual, pushOnly: true });
    }
    const pending = await countPendingOperations(account.id);
    if (pending > 0) {
      return { ok: false, pending, error: 'Account_SignOutPendingDetail' };
    }
  }

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