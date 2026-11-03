/**
 * The sign-in barrier: the user must WAIT for the account's dataset.
 *
 * Reported: after signing in the app was usable immediately, but the Today tab
 * and the calendar were still empty - the first synchronization ran in the
 * background, so the changes only appeared a minute later (and looked lost).
 *
 * `signInWithGoogle` now runs that first cycle INSIDE the call behind the same
 * determinate bar the sign-out uses, and reports every document it settles.
 *
 * Covered here:
 *  - the account's document really is in the local database when the call
 *    resolves (nothing is left to a background cycle),
 *  - the progress frames are sign-in frames (`mode: 'signIn'`) with a
 *    `downloading` phase that counts the listed documents,
 *  - a connection that never answers cannot trap the user: the deadline ends the
 *    bar, the account stays connected and the records keep arriving later.
 */

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

jest.mock('../src/cloud/auth', () => {
  class AuthError extends Error {
    readonly code: string;
    constructor(code: string) {
      super(code);
      this.code = code;
    }
  }
  return {
    AuthError,
    readTokens: jest.fn(async () => null),
    signIn: jest.fn(async () => ({
      accessToken: 'token',
      expiresAt: Date.now() + 3600000,
      idToken: '',
      refreshToken: null,
      email: 'user@example.com',
      displayName: 'User',
      userId: 'google-sub-1',
    })),
    signOutLocal: jest.fn(async () => undefined),
  };
});

jest.mock('../src/cloud/driveProvider', () => ({
  listObjects: jest.fn(async () => []),
  listChanges: jest.fn(async () => []),
  // The engine's pull phase reuses the listing of the push phase of the same
  // cycle, so the folder snapshot has to be filtered here instead of fetched.
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

import { MealCategoryKey, ProviderType, SyncStatus } from '../src/domain/enums';
import { closeDb, getDb } from '../src/data/database';
import {
  getActiveAccount,
  getMealsForDate,
  upsertPreferences,
  upsertProfile,
} from '../src/data/repositories';
import { defaultPreferences } from '../src/services/bootstrap';
import { ensureCategories, loadDay, saveMeal } from '../src/services/mealTracking';
import { signInWithGoogle, type AccountSyncProgress } from '../src/cloud/session';
import * as drive from '../src/cloud/driveProvider';

const PROFILE = '11111111-1111-4111-8111-111111111111';
const CLOUD_PROFILE = '22222222-2222-4222-8222-222222222222';
const CLOUD_MEAL = '9aa0da4a-7517-4677-b303-e0cb15d80396';
const DAY = '2026-11-01';

const listObjects = drive.listObjects as jest.Mock;
const listChanges = drive.listChanges as jest.Mock;
const downloadObject = drive.downloadObject as jest.Mock;

/** The one object the account stores: another device's lunch document. */
function cloudListing() {
  return [
    {
      path: `entities/MealEntry/${CLOUD_MEAL}.json`,
      id: `id-${CLOUD_MEAL}`,
      revision: '1',
      modifiedAt: '2026-11-01T08:30:00.000Z',
      sizeBytes: 100,
      hash: null,
    },
  ];
}


/** The meal document another device uploaded for the same account. */
function cloudMealDocument(): string {
  return JSON.stringify({
    schemaVersion: 1,
    entityType: 'MealEntry',
    entityId: CLOUD_MEAL,
    localProfileId: CLOUD_PROFILE,
    revision: 0,
    updatedAt: '2026-11-01T08:30:00.000Z',
    deviceId: 'the-other-device',
    isDeleted: false,
    contentHash: 'abc',
    payload: {
      id: CLOUD_MEAL,
      localProfileId: CLOUD_PROFILE,
      date: DAY,
      mealCategoryId: 'cccccccc-7517-4677-b303-e0cb15d80396',
      mealCategoryKey: 'Lunch',
      title: 'Ciorbă de legume',
      ingredients: 'legume, smântână',
      plannedTime: '12:30:00',
      status: 'Pending',
      createdAt: '2026-11-01T08:30:00.000Z',
      updatedAt: '2026-11-01T08:30:00.000Z',
      revision: 0,
      syncStatus: 'PendingUpload',
    },
  });
}

/** Guest database (profile + preferences + the five slots), nothing else. */
async function seedGuest(): Promise<void> {
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

beforeEach(async () => {
  await seedGuest();
  // Both listing calls answer with the same folder snapshot, like the provider.
  listObjects.mockReset();
  listObjects.mockImplementation(async () => cloudListing());
  listChanges.mockReset();
  listChanges.mockImplementation(async () => cloudListing());
  downloadObject.mockReset();
  downloadObject.mockImplementation(async () => cloudMealDocument());
});

afterAll(async () => {
  await closeDb();
});


describe('sign-in waits for the account data (spec 1.2 / 6.4)', () => {
  test('the dataset is on the device when the call resolves', async () => {
    const frames: AccountSyncProgress[] = [];
    const result = await signInWithGoogle({
      consentGranted: true,
      onProgress: (progress) => frames.push(progress),
    });

    expect(result.ok).toBe(true);
    expect(result.downloaded).toBeGreaterThanOrEqual(1);

    // The meal is already local: no background cycle produced it, so the screens
    // that open next can never show an empty day for this account.
    const meals = await getMealsForDate(PROFILE, DAY);
    expect(meals.map((meal) => meal.title)).toContain('Ciorbă de legume');
    await expect(getActiveAccount()).resolves.not.toBeNull();
  });

  test('the bar reports the sign-in phases, not sign-out ones', async () => {
    const frames: AccountSyncProgress[] = [];
    await signInWithGoogle({
      consentGranted: true,
      onProgress: (progress) => frames.push(progress),
    });

    expect(frames.length).toBeGreaterThan(0);
    expect(frames.every((frame) => frame.mode === 'signIn')).toBe(true);
    expect(frames[0].stage).toBe('preparing');
    const downloads = frames.filter((frame) => frame.stage === 'downloading');
    expect(downloads.length).toBeGreaterThan(0);
    // The listing publishes "0 of 1", then the document itself moves the bar.
    const counted = downloads.filter((frame) => frame.total > 0);
    expect(counted[0]).toEqual({
      mode: 'signIn',
      stage: 'downloading',
      settled: 0,
      total: 1,
    });
    expect(counted[counted.length - 1].settled).toBe(1);
    expect(frames[frames.length - 1].stage).toBe('finishing');
  });

  test('a connection that never answers ends the bar but keeps the session', async () => {
    let release: () => void = () => undefined;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    downloadObject.mockImplementation(async () => {
      await blocked;
      return cloudMealDocument();
    });

    const result = await signInWithGoogle({ consentGranted: true, syncBudgetMs: 30 });

    expect(result.ok).toBe(true);
    expect(result.pendingData).toBe(true);
    await expect(getActiveAccount()).resolves.not.toBeNull();

    release();
  });
});



/**
 * The FALSE "the data could not be loaded yet" report. The sign-in status was
 * driven by `failed || conflicts`, and a conflict is not missing data: the pull
 * keeps the local row and preserves the cloud version in the conflict log. A meal
 * slot that exists on BOTH sides - the everyday case of guest meals recorded
 * before signing in - produced the error although everything had synced.
 */
describe('a conflict is not missing data', () => {
  test('a slot held on both sides is kept and reported as synced', async () => {
    // The guest recorded this lunch before signing in; the account holds its own
    // lunch for the same day and slot.
    const day = await loadDay(PROFILE, DAY);
    const lunch = day.meals.find((meal) => meal.mealCategoryKey === MealCategoryKey.Lunch);
    expect(lunch).toBeDefined();
    const saved = await saveMeal(
      {
        ...(lunch as NonNullable<typeof lunch>),
        title: 'Ciorbă de legume',
        ingredients: 'legume, smântână',
      },
      null,
      true,
    );
    expect(saved.ok).toBe(true);

    const result = await signInWithGoogle({ consentGranted: true });

    expect(result.ok).toBe(true);
    // The cloud copy could not take the occupied slot: both versions are kept.
    expect(result.conflicts).toBe(1);
    expect(result.downloaded).toBe(0);
    // ...and that is NOT "the data could not be loaded": nothing is missing.
    expect(result.pendingData).toBeUndefined();

    // The device still shows the record the user actually has.
    const meals = await getMealsForDate(PROFILE, DAY);
    const local = meals.find((meal) => meal.mealCategoryKey === MealCategoryKey.Lunch);
    expect(local?.title).toBe('Ciorbă de legume');
  });

  test('a document that really failed is the only "not loaded yet" case', async () => {
    // The listed document is gone by the time it is fetched (deleted between the
    // listing and the download): it stays behind the cursor and is retried, which
    // is a genuine "not everything arrived" - but the account's other records are
    // untouched and the session is complete.
    downloadObject.mockImplementation(async () => null);

    const result = await signInWithGoogle({ consentGranted: true });

    expect(result.ok).toBe(true);
    expect(result.failed).toBeGreaterThan(0);
    expect(result.conflicts).toBe(0);
    // No deadline: the bar finished, so `pendingData` stays unset and the screen
    // reports the failed documents themselves (Rn_SignInPartial).
    expect(result.pendingData).toBeUndefined();
  });
});
