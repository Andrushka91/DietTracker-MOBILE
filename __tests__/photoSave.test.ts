// Regression tests for the "photo first, then Save does nothing" defect.
//
// Reported: adding a photograph to a card and then editing + pressing Save did
// nothing at all - the editor stayed open, no error, no write.
//
// Cause: `upsertMeal` replaced the primary key of the existing slot row
// (`ON CONFLICT ... DO UPDATE SET Id = excluded.Id`). `MealPhoto.MealEntryId`
// references that id and the schema has no ON UPDATE action, so the moment a
// photograph existed the write was rolled back with
// `FOREIGN KEY constraint failed` - and the rejection was swallowed by the card.
//
// Covered here:
//  - an upsert that names a different id updates the stored row and keeps its
//    id (and therefore the photograph attached),
//  - `saveMeal` journals the id the DATABASE kept, so the outbox can actually
//    read the row it queued.

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
import { MealEntry, MealPhoto } from '../src/domain/models';
import { closeDb, getDb } from '../src/data/database';
import {
  getMealById,
  getMealsForDate,
  getPendingOperations,
  getPhotosForMeal,
  insertPhoto,
  upsertAccount,
  upsertMeal,
  upsertPreferences,
  upsertProfile,
} from '../src/data/repositories';
import { defaultPreferences } from '../src/services/bootstrap';
import { ensureCategories, ensureMealStored, loadDay, saveMeal } from '../src/services/mealTracking';

const PROFILE = '11111111-1111-4111-8111-111111111111';
const ACCOUNT = '33333333-3333-4333-8333-333333333333';
const DAY = '2026-11-01';

/** Fresh database; `withAccount` seeds the connected Google account row. */
async function seed(withAccount: boolean): Promise<void> {
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
  if (withAccount) {
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
}

/** The stored Lunch card of the test day. */
async function lunch(): Promise<MealEntry> {
  const day = await loadDay(PROFILE, DAY);
  const meal = day.meals.find((entry) => entry.mealCategoryKey === MealCategoryKey.Lunch);
  if (meal === undefined) {
    throw new Error('the day model must always hold the five permanent slots');
  }
  return meal;
}

/** One metadata row, exactly what addPhotoToMeal inserts after the bytes. */
function photoRow(mealEntryId: string, id: string): MealPhoto {
  const now = new Date().toISOString();
  return {
    id,
    mealEntryId,
    originalFileName: 'lunch.jpg',
    localFileId: `${id}.bin`,
    thumbnailId: `${id}.jpg`,
    mimeType: 'image/jpeg',
    fileSize: 1024,
    contentHash: 'hash',
    cloudObjectId: null,
    cloudRevision: null,
    createdAt: now,
    updatedAt: now,
    syncStatus: SyncStatus.PendingUpload,
  };
}

beforeEach(async () => {
  await seed(false);
});

afterAll(async () => {
  await closeDb();
});


describe('saving a meal that already holds a photograph (spec 8.4)', () => {
  test('a draft with another id updates the stored row instead of its key', async () => {
    const slot = await lunch();
    await upsertMeal({ ...slot, title: 'Ciorbă', ingredients: 'legume' });
    await insertPhoto(photoRow(slot.id, 'aaaaaaaa-7517-4677-b303-e0cb15d80396'));

    // A snapshot that carries a different id for the same slot - exactly what an
    // untouched slot (fresh GUID per read) or a cloud-adopted row produces.
    const draft: MealEntry = { ...slot, id: 'another-id', title: 'Ciorbă nouă' };
    await expect(upsertMeal(draft)).resolves.toBeUndefined();

    const stored = await lunch();
    expect(stored.id).toBe(slot.id);
    expect(stored.title).toBe('Ciorbă nouă');
    await expect(getPhotosForMeal(stored.id)).resolves.toHaveLength(1);
  });

  test('a photograph added first survives the save of the title', async () => {
    const slot = await lunch();
    await ensureMealStored(slot, null);
    await insertPhoto(photoRow(slot.id, 'bbbbbbbb-7517-4677-b303-e0cb15d80396'));

    const reloaded = await lunch();
    const result = await saveMeal(
      { ...reloaded, title: 'Ciorbă', ingredients: 'legume' },
      null,
      true,
    );

    expect(result.ok).toBe(true);
    const stored = await lunch();
    expect(stored.title).toBe('Ciorbă');
    expect(stored.id).toBe(slot.id);
    await expect(getPhotosForMeal(stored.id)).resolves.toHaveLength(1);
  });

  test('the save journals the id the database kept, not the draft id', async () => {
    await seed(true);
    const slot = await lunch();
    await ensureMealStored(slot, ACCOUNT);
    const stale: MealEntry = { ...slot, id: 'stale-id', title: 'Salată' };

    await saveMeal(stale, ACCOUNT, true);

    const rows = await getMealsForDate(PROFILE, DAY);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(slot.id);
    // The queued document must point at a row that exists, otherwise the push
    // would complete the operation without ever uploading anything.
    await expect(getMealById(slot.id)).resolves.not.toBeNull();
    const pending = await getPendingOperations(ACCOUNT);
    const ids = pending.map((op) => op.entityId);
    expect(ids).toContain(slot.id);
    expect(ids).not.toContain('stale-id');
  });
});

