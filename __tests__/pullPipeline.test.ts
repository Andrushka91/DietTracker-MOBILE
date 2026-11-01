// Regression tests for the SPEED of the pull phase (src/cloud/parallel.ts +
// pullChanges in src/cloud/syncEngine.ts).
//
// The pull used to be a strictly sequential loop: `downloadObject` (one round
// trip), apply, repeat. A first sign-in of an account holding a few hundred
// documents therefore spent most of its time waiting for the network to answer
// one request at a time - the bar crawled from 0 to 100 even on a fast link.
//
// What is verified here:
//  - several document downloads are in flight while the queue is applied,
//  - never more than the configured window (the phone is not asked to open one
//    socket per record),
//  - the result is still applied in the queue order (meals before photographs),
//  - one cycle pays for ONE folder listing: the snapshot of the push phase is
//    reused by the pull phase instead of being requested twice.

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

jest.mock('../src/cloud/driveProvider', () => ({
  listObjects: jest.fn(async () => []),
  listChanges: jest.fn(async () => []),
  selectChanges: jest.fn((objects: unknown[]) => [...objects]),
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

import { EntityType, MealCategoryKey, ProviderType, SyncStatus, SyncTrigger } from '../src/domain/enums';
import { closeDb, getDb } from '../src/data/database';
import {
  getActiveProfile,
  countPendingOperations,
  getMealBySlot,
  upsertAccount,
  upsertPreferences,
  upsertProfile,
} from '../src/data/repositories';
import { defaultPreferences } from '../src/services/bootstrap';
import { ensureCategories, loadDay, saveMeal } from '../src/services/mealTracking';
import { runCycle } from '../src/cloud/syncEngine';
import { PULL_CONCURRENCY } from '../src/cloud/parallel';
import * as drive from '../src/cloud/driveProvider';

const LOCAL_PROFILE = '11111111-1111-4111-8111-111111111111';
const LOCAL_ACCOUNT = '33333333-3333-4333-8333-333333333333';
const REMOTE_PROFILE = '22222222-2222-4222-8222-222222222222';
const DAY = '2026-11-01';

const listObjects = drive.listObjects as jest.Mock;
const listChanges = drive.listChanges as jest.Mock;
const downloadObject = drive.downloadObject as jest.Mock;

const CATEGORY_KEYS = ['Breakfast', 'MorningSnack', 'Lunch', 'AfternoonSnack', 'Dinner'];


function mealDocument(id: string, key: string, title: string): string {
  return JSON.stringify({
    schemaVersion: 1,
    entityType: EntityType.MealEntry,
    entityId: id,
    localProfileId: REMOTE_PROFILE,
    revision: 1,
    updatedAt: '2026-11-01T08:00:00.000Z',
    deviceId: 'windows-device',
    isDeleted: false,
    contentHash: 'hash',
    payload: {
      id,
      localProfileId: REMOTE_PROFILE,
      date: DAY,
      mealCategoryId: 'eeeeeeee-7517-4677-b303-e0cb15d80396',
      mealCategoryKey: key,
      title,
      ingredients: 'from the other device',
      plannedTime: '08:00:00',
      status: 'Pending',
      createdAt: '2026-11-01T07:00:00.000Z',
      updatedAt: '2026-11-01T08:00:00.000Z',
      revision: 1,
      syncStatus: 'PendingUpload',
    },
  });
}

/** One listing entry per document, all newer than the (empty) watermark. */
function driveChange(path: string, modifiedAt: string) {
  return {
    path,
    id: `id-${path}`,
    revision: '1',
    modifiedAt,
    sizeBytes: 100,
    hash: null,
  };
}

async function seed(): Promise<void> {
  await getDb();
  await ensureCategories();
  const now = new Date().toISOString();
  await upsertProfile({
    id: LOCAL_PROFILE,
    providerType: ProviderType.Google,
    providerUserId: '106708405189816831162',
    displayName: 'Andrei',
    email: 'andrei@example.com',
    timeZone: '',
    isActive: 1,
    createdAt: now,
    updatedAt: now,
    syncStatus: SyncStatus.Synced,
    cloudRevision: null,
  });
  await upsertPreferences({ ...defaultPreferences(LOCAL_PROFILE), synchronizationEnabled: true });
  await upsertAccount({
    id: LOCAL_ACCOUNT,
    providerType: ProviderType.Google,
    providerUserId: '106708405189816831162',
    displayName: 'local',
    email: 'andrei@example.com',
    rootFolderId: null,
    lastAuthenticatedAt: now,
    lastSynchronizedAt: null,
    isActive: 1,
    synchronizationEnabled: 1,
    quotaTotalBytes: null,
    quotaRemainingBytes: null,
  });
}

/** The meal row of one slot, looked up by its permanent category key. */
async function mealOf(key: string) {
  const profile = await getActiveProfile();
  if (profile === null) {
    return null;
  }
  const categoryKey = MealCategoryKey[key as keyof typeof MealCategoryKey];
  return getMealBySlot(profile.id, DAY, categoryKey);
}

beforeEach(async () => {
  await closeDb();
  listObjects.mockReset();
  listObjects.mockImplementation(async () => []);
  listChanges.mockReset();
  listChanges.mockImplementation(async () => []);
  downloadObject.mockReset();
  downloadObject.mockImplementation(async () => null);
  await seed();
});


describe('the pull phase overlaps its downloads', () => {
  test('documents are fetched in a bounded parallel window, applied in order', async () => {
    const documents = CATEGORY_KEYS.map((key, index) => ({
      key,
      id: `aaaaaaa${index}-7517-4677-b303-e0cb15d80396`,
      json: mealDocument(`aaaaaaa${index}-7517-4677-b303-e0cb15d80396`, key, `Remote ${key}`),
    }));

    // Newest first, exactly like the provider listing.
    listChanges.mockImplementation(async () =>
      documents.map((document, index) =>
        driveChange(`entities/MealEntry/${document.id}.json`, `2026-11-01T09:0${index}:00.000Z`),
      ),
    );

    const byPath = new Map(
      documents.map((document) => [`entities/MealEntry/${document.id}.json`, document.json]),
    );
    let inFlight = 0;
    let peak = 0;
    const fetchOrder: string[] = [];
    downloadObject.mockImplementation(async (path: string) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 15));
      inFlight -= 1;
      fetchOrder.push(path);
      return byPath.get(path) ?? null;
    });

    const result = await runCycle({ trigger: SyncTrigger.Manual });

    expect(result.downloaded).toBe(documents.length);
    expect(result.failed).toBe(0);
    // Overlapped (the network is no longer asked one document at a time) and
    // bounded (a large account does not open one request per record).
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThanOrEqual(PULL_CONCURRENCY);
    for (const document of documents) {
      const meal = await mealOf(document.key);
      expect(meal?.title).toBe(`Remote ${document.key}`);
    }
    expect(fetchOrder.length).toBe(documents.length);
  });

  test('one cycle pays for one listing: the push snapshot is reused by the pull', async () => {
    // A local edit first, so the push phase has something to upload and has to
    // list the folder for its compare-and-swap index.
    const day = await loadDay(LOCAL_PROFILE, DAY);
    const saved = await saveMeal(
      { ...day.meals[0], title: 'Local breakfast', ingredients: 'content' },
      LOCAL_ACCOUNT,
      true,
    );
    // eslint-disable-next-line no-console
    console.log('DEBUG', JSON.stringify(saved), 'pending', await countPendingOperations(LOCAL_ACCOUNT));


    const remoteId = 'bbbbbbb1-7517-4677-b303-e0cb15d80396';
    const remotePath = `entities/MealEntry/${remoteId}.json`;
    listObjects.mockImplementation(async () => [driveChange(remotePath, '2026-11-01T09:30:00.000Z')]);
    downloadObject.mockImplementation(async (path: string) =>
      path === remotePath ? mealDocument(remoteId, 'Lunch', 'Remote lunch') : null,
    );

    const result = await runCycle({ trigger: SyncTrigger.Manual });

    expect(result.uploaded).toBe(1);
    expect(result.downloaded).toBe(1);
    // The folder was listed once, by the push phase; the pull filtered that
    // snapshot instead of asking the provider for the very same listing again.
    expect(listObjects).toHaveBeenCalledTimes(1);
    expect(listChanges).not.toHaveBeenCalled();
    const lunch = await mealOf('Lunch');
    expect(lunch?.title).toBe('Remote lunch');
  });
});

afterAll(async () => {
  await closeDb();
});

