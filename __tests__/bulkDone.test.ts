// Regression tests for the bulk "Mark all DONE / MISSED" defect.
//
// Reported: pressing "Mark all meals as DONE" flipped cards that were never
// edited (untouched, or only turned red by an earlier "Mark all MISSED") to
// green, next to a dialog that said only the edited cards can be confirmed - and
// that dialog had TWO identical "OK" buttons.
//
// Cause: the skip test was `hasUserContent`, which counts a state, a photograph
// or a planned time as content, so an empty card that was already red became
// "green-able". Only a title or a description may be confirmed.
//
// Covered here:
//  - untouched cards keep PENDING after both bulk actions (and are not written),
//  - a card that was marked MISSED without text stays untouched,
//  - a card with only a photograph keeps PENDING,
//  - the acknowledgement is a SINGLE-button dialog (no "OK OK").

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

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { MealCategoryKey, MealStatus, ProviderType, SyncStatus } from '../src/domain/enums';
import { MealEntry, MealPhoto } from '../src/domain/models';
import { closeDb, getDb } from '../src/data/database';
import { insertPhoto, upsertPreferences, upsertProfile } from '../src/data/repositories';
import { defaultPreferences } from '../src/services/bootstrap';
import {
  ensureCategories,
  ensureMealStored,
  loadDay,
  markAllDone,
  markAllMissed,
  saveMeal,
} from '../src/services/mealTracking';

const PROFILE = '11111111-1111-4111-8111-111111111111';
const DAY = '2026-11-01';

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
}

async function day(): Promise<MealEntry[]> {
  return (await loadDay(PROFILE, DAY)).meals;
}

function slotOf(meals: MealEntry[], key: MealCategoryKey): MealEntry {
  const meal = meals.find((entry) => entry.mealCategoryKey === key);
  if (meal === undefined) {
    throw new Error('the day model must always hold the five permanent slots');
  }
  return meal;
}

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
  await seed();
});

afterAll(async () => {
  await closeDb();
});

describe('bulk DONE / MISSED only touches edited cards (spec 8.2)', () => {
  test('untouched cards stay pending and are reported as skipped', async () => {
    const meals = await day();
    await saveMeal({ ...slotOf(meals, MealCategoryKey.Breakfast), title: 'Omletă', ingredients: 'ouă' }, null, true);
    await saveMeal({ ...slotOf(meals, MealCategoryKey.Lunch), title: 'Ciorbă', ingredients: 'legume' }, null, true);

    const result = await markAllDone(PROFILE, DAY, null, new Date());

    expect(result.changed).toBe(2);
    expect(result.skippedEmpty).toBe(3);
    const after = await day();
    expect(slotOf(after, MealCategoryKey.Breakfast).status).toBe(MealStatus.Done);
    expect(slotOf(after, MealCategoryKey.Lunch).status).toBe(MealStatus.Done);
    for (const key of [
      MealCategoryKey.MorningSnack,
      MealCategoryKey.AfternoonSnack,
      MealCategoryKey.Dinner,
    ]) {
      expect(slotOf(after, key).status).toBe(MealStatus.Pending);
    }
  });

  test('a card that was only marked MISSED stays red then never turns green', async () => {
    await markAllMissed(PROFILE, DAY, null, new Date());
    // Nothing had text, so nothing was written at all: the day is still pending.
    let after = await day();
    expect(after.every((meal) => meal.status === MealStatus.Pending)).toBe(true);

    // One real meal, then both bulk actions in the order the user tried them.
    const meals = after;
    await saveMeal({ ...slotOf(meals, MealCategoryKey.Lunch), title: 'Ciorbă', ingredients: 'legume' }, null, true);
    await markAllMissed(PROFILE, DAY, null, new Date());
    after = await day();
    expect(slotOf(after, MealCategoryKey.Lunch).status).toBe(MealStatus.Missed);

    const done = await markAllDone(PROFILE, DAY, null, new Date());
    expect(done.changed).toBe(1);
    after = await day();
    expect(slotOf(after, MealCategoryKey.Lunch).status).toBe(MealStatus.Done);
    expect(slotOf(after, MealCategoryKey.Dinner).status).toBe(MealStatus.Pending);
  });

  test('a card with only a photograph is not confirmed', async () => {
    const meals = await day();
    const photoSlot = slotOf(meals, MealCategoryKey.AfternoonSnack);
    await ensureMealStored(photoSlot, null);
    await insertPhoto(photoRow(photoSlot.id, 'aaaaaaaa-7517-4677-b303-e0cb15d80396'));

    const result = await markAllDone(PROFILE, DAY, null, new Date());
    expect(result.changed).toBe(0);
    expect(result.skippedEmpty).toBe(5);
    const after = await day();
    expect(slotOf(after, MealCategoryKey.AfternoonSnack).status).toBe(MealStatus.Pending);
  });

  test('the skipped-card acknowledgement has ONE button', () => {
    // The old dialog passed the same label as cancel and confirm, which drew two
    // identical "OK" buttons. The bulk result is a single-action alert now.
    const source = readFileSync(
      join(__dirname, '..', 'src', 'ui', 'screens', 'DashboardScreen.tsx'),
      'utf8',
    );
    const block = source.slice(source.indexOf('const reportBulkResult'), source.indexOf('const handleMarkAllDone'));
    expect(block).toContain('singleAction: true');
    expect(block).not.toContain('cancelText');
  });
});

