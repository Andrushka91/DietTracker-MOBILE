// Regression tests for the sign-out boundary: the local cache is the only copy
// of a change until it reaches the account, so signing out uploads the outbox
// first and NEVER offers a way to skip that upload.
//
// Covered:
//  - a guest session signs out instantly and never calls the provider,
//  - a change waiting out its backoff IS uploaded (the barrier ignores the
//    backoff window) and the sign-out finishes with a 0-100 % progress report,
//  - an upload that cannot finish REFUSES the sign-out and keeps every record -
//    no "sign out anyway" path exists any more,
//  - the internal discard flag still clears the cache without any network call.

jest.mock('expo-sqlite', () => {
  // Minimal expo-sqlite surface on top of node:sqlite (in-memory database).
  const { DatabaseSync } = require('node:sqlite') as {
    DatabaseSync: new (path: string) => {
      exec: (sql: string) => void;
      prepare: (sql: string) => {
        all: (...params: unknown[]) => unknown[];
      };
    };
  };

  const openDatabaseSync = () => {
    const db = new DatabaseSync(':memory:');
    return {
      closeSync: () => db.exec('PRAGMA optimize;'),
      execAsync: async (sql: string) => db.exec(sql),
      execSync: (sql: string) => db.exec(sql),
      getAllAsync: async (sql: string, params: unknown[] = []) => db.prepare(sql).all(...params),
      getAllSync: (sql: string, params: unknown[] = []) => db.prepare(sql).all(...params),
      withTransactionAsync: async (fn: () => Promise<void>) => {
        db.exec('BEGIN');
        try {
          await fn();
          db.exec('COMMIT');
        } catch (error) {
          db.exec('ROLLBACK');
          throw error;
        }
      },
    };
  };

  return { openDatabaseSync };
});

// Any provider call during these tests is a bug: the whole point is that
// sign-out does not need the cloud when there is nothing to send right now.
jest.mock('../src/cloud/driveProvider', () => ({
  listObjects: jest.fn(async () => {
    throw new Error('the drive must not be listed during sign-out');
  }),
  listChanges: jest.fn(async () => []),
  // The pull phase filters the listing of the push phase instead of listing again.
  selectChanges: jest.fn((objects: unknown[]) => [...objects]),
  uploadObject: jest.fn(async () => ({
    path: '',
    id: 'id',
    revision: '1',
    modifiedAt: '',
    sizeBytes: 0,
    hash: null,
  })),
  downloadObject: jest.fn(async () => null),
  downloadObjectBase64: jest.fn(async () => null),
  deleteObject: jest.fn(async () => undefined),
  resolveObjectId: jest.fn(async () => null),
  resetObjectIndex: jest.fn(),
  getQuota: jest.fn(async () => ({ totalBytes: null, remainingBytes: null, usageBytes: null })),
}));

import {
  EntityType,
  ProviderType,
  SyncOperationStatus,
  SyncOperationType,
  SyncStatus,
} from '../src/domain/enums';
import { closeDb, getDb } from '../src/data/database';
import {
  countPendingOperations,
  getActiveAccount,
  journalOperation,
  upsertAccount,
  upsertPreferences,
  upsertProfile,
} from '../src/data/repositories';
import { defaultPreferences } from '../src/services/bootstrap';
import { ensureCategories } from '../src/services/mealTracking';
import { signOutGoogle } from '../src/cloud/session';
import * as drive from '../src/cloud/driveProvider';

const LOCAL_PROFILE = '11111111-1111-4111-8111-111111111111';
const LOCAL_ACCOUNT = '33333333-3333-4333-8333-333333333333';

async function seedProfile(): Promise<void> {
  await getDb();
  await ensureCategories();
  const now = new Date().toISOString();
  await upsertProfile({
    id: LOCAL_PROFILE,
    providerType: ProviderType.None,
    providerUserId: '',
    displayName: '',
    email: '',
    timeZone: '',
    isActive: 1,
    createdAt: now,
    updatedAt: now,
    syncStatus: SyncStatus.PendingUpload,
    cloudRevision: null,
  });
  await upsertPreferences(defaultPreferences(LOCAL_PROFILE));
}

async function seedAccount(): Promise<void> {
  const now = new Date().toISOString();
  await upsertAccount({
    id: LOCAL_ACCOUNT,
    providerType: ProviderType.Google,
    providerUserId: '106708405189816831162',
    displayName: 'local',
    email: 'local@example.com',
    rootFolderId: null,
    lastAuthenticatedAt: now,
    lastSynchronizedAt: null,
    isActive: 1,
    synchronizationEnabled: 1,
    quotaTotalBytes: null,
    quotaRemainingBytes: null,
  });
}

/** One journalled change in the given state (inside a backoff window if asked). */
async function journalChange(options: {
  status: SyncOperationStatus;
  nextAttemptAt: string | null;
}): Promise<void> {
  const now = new Date().toISOString();
  await journalOperation({
    id: '44444444-4444-4444-8444-444444444444',
    cloudAccountId: LOCAL_ACCOUNT,
    entityType: EntityType.MealEntry,
    entityId: '9aa0da4a-7517-4677-b303-e0cb15d80396',
    operationType: SyncOperationType.Upsert,
    status: options.status,
    entityRevision: 1,
    retryCount: 3,
    lastError: 'drive.network.timeout',
    nextAttemptAt: options.nextAttemptAt,
    createdAt: now,
    completedAt: null,
  });
}

const listObjects = drive.listObjects as jest.Mock;

beforeEach(async () => {
  await closeDb();
  listObjects.mockClear();
  listObjects.mockImplementation(async () => {
    throw new Error('the drive must not be listed during sign-out');
  });
  await seedProfile();
});

afterAll(async () => {
  await closeDb();
});

describe('sign-out uploads everything before it removes the account', () => {
  test('a guest session signs out with no provider call at all', async () => {
    const started = Date.now();
    const result = await signOutGoogle({ discardChanges: false });
    expect(result.ok).toBe(true);
    expect(Date.now() - started).toBeLessThan(1000);
    expect(listObjects).not.toHaveBeenCalled();
  });

  test('a change waiting out its backoff is uploaded before signing out', async () => {
    await seedAccount();
    await journalChange({
      status: SyncOperationStatus.Failed,
      nextAttemptAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    });
    // The push pass lists the cloud folder once; an empty index is enough for a
    // record the cloud has never seen.
    listObjects.mockImplementation(async () => []);

    const stages: string[] = [];
    const result = await signOutGoogle({
      onProgress: (progress) => stages.push(progress.stage),
    });

    expect(result.ok).toBe(true);
    // The bar starts empty, reports the upload and ends on a full bar.
    expect(stages[0]).toBe('preparing');
    expect(stages).toContain('uploading');
    expect(stages[stages.length - 1]).toBe('finishing');
    // The backoff window did not keep the change in the outbox.
    await expect(countPendingOperations(LOCAL_ACCOUNT)).resolves.toBe(0);
    await expect(getActiveAccount()).resolves.toBeNull();
  });

  test('an upload that cannot finish refuses the sign-out and keeps the cache', async () => {
    await seedAccount();
    await journalChange({ status: SyncOperationStatus.Pending, nextAttemptAt: null });

    const started = Date.now();
    const result = await signOutGoogle({ maxUploadAttempts: 1, retryDelayMs: 0 });
    const elapsed = Date.now() - started;

    // Refused: there is no "sign out anyway" answer, nothing was purged.
    expect(result.ok).toBe(false);
    expect(result.pending).toBe(1);
    expect(result.error).toBe('Account_SignOutPendingDetail');
    expect(elapsed).toBeLessThan(3000);
    await expect(getActiveAccount()).resolves.not.toBeNull();
    await expect(countPendingOperations(LOCAL_ACCOUNT)).resolves.toBe(1);
  });

  test('the internal discard flag signs out at once without the network', async () => {
    await seedAccount();
    await journalChange({ status: SyncOperationStatus.Pending, nextAttemptAt: null });

    const started = Date.now();
    const result = await signOutGoogle({ discardChanges: true });
    expect(result.ok).toBe(true);
    expect(Date.now() - started).toBeLessThan(2000);
    expect(listObjects).not.toHaveBeenCalled();
    await expect(getActiveAccount()).resolves.toBeNull();
    await expect(countPendingOperations(LOCAL_ACCOUNT)).resolves.toBe(0);
  });
});
