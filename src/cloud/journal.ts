// Durable outbox journal - every local write reaches the cloud through this
// one helper (spec 7.2/7.3): write the record first (already done by the
// caller), then journal one operation for the active account. Guest mode
// (accountId = null) journals nothing - the app is fully offline then.

import { EntityType, SyncOperationStatus, SyncOperationType, SyncStatus } from '../domain/enums';
import { SyncOperation } from '../domain/models';
import { newGuid } from '../domain/rules/mealSlotRules';
import { journalOperation } from '../data/repositories';

/** Queues an upsert for one entity on the active account. */
export async function journalEntity(
  accountId: string,
  entityType: EntityType,
  entityId: string,
  updatedAtIso: string,
): Promise<void> {
  const op: SyncOperation = {
    id: newGuid(),
    cloudAccountId: accountId,
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
  accountId: string,
  entityType: EntityType,
  entityId: string,
  nowIso: string,
): Promise<void> {
  const op: SyncOperation = {
    id: newGuid(),
    cloudAccountId: accountId,
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