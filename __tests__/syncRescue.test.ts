// Regression tests for "the sign-out deletes changes the cloud never received".
//
// Reported: signing out finished almost instantly and the meals/photographs
// edited before it were gone after signing in again - the cloud had never seen
// them.
//
// Two holes are pinned down here:
//  1. the screens cache the account id, and a write in the window where that
//     cache was empty (first frame after a sign-in / a restart) used to be
//     written locally and journaled NOWHERE,
//  2. the sign-out barrier only uploaded what the outbox happened to hold, so a
//     record with no journal entry was deleted without ever being uploaded.
//
// The barrier now queues every record the provider has not confirmed
// (`pushAllLocalRecords({ onlyPending: true })`) before it counts, uploads and
// finally purges.

jest.mock('expo-sqlite', () => {
  // Minimal expo-sqlite surface on top of node:sqlite (in-memory database).
  const { DatabaseSync } = require('node:sqlite');

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

jest.mock('../src/cloud/driveProvider', () => ({
  listObjects: jest.fn(async () => []),
  listChanges: jest.fn(async () => []),
  uploadObject: jest.fn(async (path: string) => ({
    path,
    id: `id-${path}`,
    revision: '1',
    modifiedAt: new Date().toISOString(),
    sizeBytes: 1,
    hash: null,
  })),
  downloadObject: jest.fn(async () => null),
  downloadObjectBase64: jest.fn(async () => null),
  deleteObject: jest.fn(async () => undefined),
  resolveObjectId: jest.fn(async () => null),
  resetObjectIndex: jest.fn(),
  getQuota: jest.fn(async () => ({ totalBytes: null, remainingBytes: null, usageBytes: null })),
}));

import { MealCategoryKey, ProviderType, SyncStatus } from '../src/domain/enums';
import { closeDb, execute, getDb } from '../src/data/database';
import {
  countPendingOperations,
  getPendingOperations,
  upsertAccount,
  upsertPreferences,
  upsertProfile,
} from '../src/data/repositories';
import { defaultPreferences } from '../src/services/bootstrap';
import { ensureCategories, loadDay, saveMeal } from '../src/services/mealTracking';
import { signOutGoogle } from '../src/cloud/session';
import * as drive from '../src/cloud/driveProvider';

const PROFILE = '11111111-1111-4111-8111-111111111111';
const ACCOUNT = '33333333-3333-4333-8333-333333333333';
const DAY = '2026-11-01';

const uploadObject = drive.uploadObject as jest.Mock;

/** Local profile + the five slots + the connected Google account. */
async function seed(): Promise<void> {
  await closeDb();
  await getDb();
  await ensureCategories();
  const now = new Date().toISOString();
  await upsertProfile({
    id: PROFILE,
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
  await upsertPreferences(defaultPreferences(PROFILE));
  await upsertAccount({
    id: ACCOUNT,
    providerType: ProviderType.Google,
    providerUserId: 'google-user',
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

/** Persists one titled meal; `accountId` mimics the value the screen holds. */
async function saveLunch(accountId: string | null, title: string): Promise<string> {
  const day = await loadDay(PROFILE, DAY);
  const lunch = day.meals.find((entry) => entry.mealCategoryKey === MealCategoryKey.Lunch);
  if (lunch === undefined) {
    throw new Error('the day model must always hold the five permanent slots');
  }
  const result = await saveMeal({ ...lunch, title, ingredients: 'legume' }, accountId, true);
  expect(result.ok).toBe(true);
  return lunch.id;
}

beforeEach(async () => {
  uploadObject.mockClear();
  await seed();
});

afterAll(async () => {
  await closeDb();
});


describe('a change is never only on the phone (spec 1.2)', () => {
  test('a write with no cached account id is still journaled for the account', async () => {
    // `app.accountId` is null for the first frames after a sign-in / a restart.
    const mealId = await saveLunch(null, 'Ciorbă');

    const pending = await getPendingOperations(ACCOUNT);
    expect(pending.map((op) => op.entityId)).toContain(mealId);
    await expect(countPendingOperations(ACCOUNT)).resolves.toBeGreaterThan(0);
  });

  test('true guest mode (no account row at all) journals nothing', async () => {
    await execute('DELETE FROM SyncOperation;');
    await execute('DELETE FROM CloudAccount;');
    await saveLunch(null, 'Ciorbă');
    await expect(countPendingOperations(ACCOUNT)).resolves.toBe(0);
  });

  test('the sign-out uploads a record whose journal entry was lost', async () => {
    const mealId = await saveLunch(ACCOUNT, 'Ciorbă');
    // The outbox is emptied behind the app's back: exactly the state the old
    // barrier trusted, and why it deleted records it had never uploaded.
    await execute('DELETE FROM SyncOperation;');
    await expect(countPendingOperations(ACCOUNT)).resolves.toBe(0);

    const frames: string[] = [];
    const result = await signOutGoogle({
      onProgress: (progress) => frames.push(progress.stage),
      retryDelayMs: 0,
    });

    expect(result.ok).toBe(true);
    const uploadedPaths = uploadObject.mock.calls.map((call) => call[0] as string);
    expect(uploadedPaths).toContain(`entities/MealEntry/${mealId}.json`);
    // The bar really moved instead of finishing at once.
    expect(frames).toContain('uploading');
  });
});

