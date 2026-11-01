// Durable outbox journal - every local write reaches the cloud through this
// one helper (spec 7.2/7.3): write the record first (already done by the
// caller), then journal one operation for the active account. Guest mode
// (no account row at all) journals nothing - the app is fully offline then.

import { EntityType, SyncOperationStatus, SyncOperationType, SyncStatus } from '../domain/enums';
import { SyncOperation } from '../domain/models';
import { newGuid } from '../domain/rules/mealSlotRules';
import { getActiveAccount, journalOperation } from '../data/repositories';

/**
 * The account a local write belongs to.
 *
 * The screens carry `app.accountId`, which is null in guest mode - but also for
 * a moment after a sign-in or a restart, while the database already holds the
 * account. Treating that window as "guest" silently dropped the change: it was
 * written locally, nothing was journaled, the cloud never received it, and the
 * sign-out had nothing to upload before it deleted the cache.
 *
 * The cache belongs to exactly one account, so the DB is the authority: an
 * explicit id wins, otherwise the ACTIVE account row decides. Only a database
 * without any account (true guest mode) journals nothing.
 */
export async function resolveAccountId(
  accountId: string | null | undefined,
): Promise<string | null> {
  if (accountId !== null && accountId !== undefined && accountId !== '') {
    return accountId;
  }
  const active = await getActiveAccount();
  return active?.id ?? null;
}

/** Queues an upsert for one entity on the active account. */
export async function journalEntity(
  accountId: string | null | undefined,
  entityType: EntityType,
  entityId: string,
  updatedAtIso: string,
): Promise<void> {
  const owner = await resolveAccountId(accountId);
  if (owner === null) {
    return;
  }
  const op: SyncOperation = {
    id: newGuid(),
    cloudAccountId: owner,
    entityType,
    entityId,
    operationType: SyncOperationType.Upsert,
    status: SyncOperationStatus.Pending,
    entityRevision: 0,
    retryCount: 0,
    lastError: null,
    nextAttemptAt: null,
    createdAt: updatedAtIso,
    completedAt: null,
  };
  await journalOperation(op);
}

/** Queues a delete (tombstone propagation) for one entity. */
export async function journalDelete(
  accountId: string | null | undefined,
  entityType: EntityType,
  entityId: string,
  nowIso: string,
): Promise<void> {
  const owner = await resolveAccountId(accountId);
  if (owner === null) {
    return;
  }
  const op: SyncOperation = {
    id: newGuid(),
    cloudAccountId: owner,
    entityType,
    entityId,
    operationType: SyncOperationType.Delete,
    status: SyncOperationStatus.Pending,
    entityRevision: 0,
    retryCount: 0,
    lastError: null,
    nextAttemptAt: null,
    createdAt: nowIso,
    completedAt: null,
  };
  await journalOperation(op);
}

/** Marks a record row as needing upload (per-record SyncStatus column). */
export function markPendingUpload(): SyncStatus {
  return SyncStatus.PendingUpload;
}