// Regression tests for the "photo first" meal card defect, executed against a
// REAL SQLite database (node:sqlite stands in for expo-sqlite) so the foreign
// keys and the unique slot index actually apply.
//
// The defect: an untouched day slot is materialized by loadDay with a FRESH
// GUID on every read. Attaching a photograph to such a slot therefore wrote a
// MealPhoto row pointing at an id that the next reload no longer produced - the
// picture silently disappeared and the upload looked broken whenever the title
// and the description had not been saved first.
//
// Covered:
//  - an untouched slot really does get a new id per read (the root cause),
//  - ensureMealStored pins that id, so the photograph stays attached and the
//    title / description can be filled in afterwards,
//  - an already stored slot is not rewritten (its timestamp survives).

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

import { MealCategoryKey, ProviderType, SyncStatus } from '../src/domain/enums';
import { MealEntry, MealPhoto } from '../src/domain/models';
import { closeDb, getDb } from '../src/data/database';
import { getPhotosForMeal, insertPhoto, upsertPreferences, upsertProfile } from '../src/data/repositories';
import { defaultPreferences } from '../src/services/bootstrap';
import { ensureCategories, ensureMealStored, loadDay } from '../src/services/mealTracking';

const LOCAL_PROFILE = '11111111-1111-4111-8111-111111111111';
const DATE = '2026-11-01';

/** Fresh database with a local profile and the five permanent categories. */
async function seed(): Promise<void> {
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

async function dinnerOf(date: string): Promise<MealEntry> {
  const day = await loadDay(LOCAL_PROFILE, date);
  const meal = day.meals.find((entry) => entry.mealCategoryKey === MealCategoryKey.Dinner);
  if (meal === undefined) {
    throw new Error('the day model must always hold the five permanent slots');
  }
  return meal;
}

beforeEach(async () => {
  await closeDb();
  await seed();
});

afterAll(async () => {
  await closeDb();
});

describe('photo-first meal editing (spec 8.4)', () => {
  test('an untouched slot is materialized with a new id on every read', async () => {
    const first = await dinnerOf(DATE);
    const second = await dinnerOf(DATE);
    // This is what made the photograph vanish: nothing was stored, so the id
    // the picture pointed at was never produced again.
    expect(first.id).not.toBe(second.id);
  });

  test('a photograph attached before any text survives the reload', async () => {
    const slot = await dinnerOf(DATE);

    // What the dashboard now does before the first picture lands.
    await ensureMealStored(slot, null);
    await insertPhoto(photoRow(slot.id, 'aaaaaaaa-7517-4677-b303-e0cb15d80396'));

    const reloaded = await dinnerOf(DATE);
    expect(reloaded.id).toBe(slot.id);
    expect(reloaded.title).toBe('');
    expect(reloaded.ingredients).toBe('');
    await expect(getPhotosForMeal(reloaded.id)).resolves.toHaveLength(1);

    // Filling the text in afterwards writes the same row (still one card).
    const saved: MealEntry = { ...reloaded, title: 'Ciorbă', ingredients: 'legume' };
    await ensureMealStored(saved, null);
    const afterText = await dinnerOf(DATE);
    expect(afterText.id).toBe(slot.id);
    await expect(getPhotosForMeal(afterText.id)).resolves.toHaveLength(1);
  });

  test('an already stored slot is left untouched (timestamp survives)', async () => {
    const slot = await dinnerOf(DATE);
    const stored = await ensureMealStored(slot, null);

    const again = await ensureMealStored({ ...slot, title: 'ignored' }, null);
    expect(again.updatedAt).toBe(stored.updatedAt);
    expect((await dinnerOf(DATE)).title).toBe('');
  });
});
