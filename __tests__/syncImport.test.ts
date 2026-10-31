// Regression tests for the cross-device import defects, executed against a REAL
// SQLite database (node:sqlite stands in for expo-sqlite) so the schema
// constraints - UNIQUE(ProviderType, ProviderUserId), FOREIGN KEY MealEntry ->
// UserProfile/MealCategory, the unique meal slot index - actually apply.
//
// Covered:
//  - a Windows profile document merges into the local profile (no UNIQUE error),
//  - a Windows meal/reminder/preferences document is remapped onto the local
//    profile and category ids (no FOREIGN KEY error),
//  - a photograph is deferred until its meal exists, then applied,
//  - a local placeholder slot adopts the cloud identity and keeps its photo,
//  - genuine concurrent edits keep both versions exactly once,
//  - a published envelope carries the row revision (not a constant zero).

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
  uploadObject: jest.fn(async () => ({ path: '', id: 'id', revision: '1', modifiedAt: '', sizeBytes: 0, hash: null })),
  downloadObject: jest.fn(async () => null),
  downloadObjectBase64: jest.fn(async () => 'AQIDBA=='),
  deleteObject: jest.fn(async () => undefined),
  resolveObjectId: jest.fn(async () => null),
  resetObjectIndex: jest.fn(),
}));

import {
  EntityType,
  MealCategoryKey,
  ProviderType,
  SyncFrequency,
  SyncStatus,
  SyncTrigger,
} from '../src/domain/enums';
import { closeDb, getDb, queryOne } from '../src/data/database';
import {
  getActiveProfile,
  getCategories,
  getMealById,
  getMealBySlot,
  getOpenConflicts,
  getPhotoById,
  getPreferences,
  getPhotosForMeal,
  getPendingOperations,
  insertPhoto,
  journalOperation,
  upsertAccount,
  upsertCategory,
  upsertMeal,
  upsertPreferences,
  upsertProfile,
} from '../src/data/repositories';
import { applyRemoteDocument, buildEnvelope, runCycle } from '../src/cloud/syncEngine';
import { defaultPreferences } from '../src/services/bootstrap';
import { ensureCategories } from '../src/services/mealTracking';

const LOCAL_PROFILE = '11111111-1111-4111-8111-111111111111';
const REMOTE_PROFILE = '22222222-2222-4222-8222-222222222222';
const GOOGLE_SUB = '106708405189816831162';
const LOCAL_ACCOUNT = '33333333-3333-4333-8333-333333333333';

const REMOTE_MEAL = '9aa0da4a-7517-4677-b303-e0cb15d80396';
const REMOTE_MEAL_2 = 'aaaaaaaa-7517-4677-b303-e0cb15d80396';
const LOCAL_PLACEHOLDER = 'bbbbbbbb-7517-4677-b303-e0cb15d80396';
const REMOTE_PHOTO = 'cccccccc-7517-4677-b303-e0cb15d80396';
const LOCAL_PHOTO = 'dddddddd-7517-4677-b303-e0cb15d80396';
const REMOTE_CATEGORY_ID = 'eeeeeeee-7517-4677-b303-e0cb15d80396';
const REMOTE_REMINDER = 'ffffffff-7517-4677-b303-e0cb15d80396';
const REMOTE_TEMPLATE = '99999999-7517-4677-b303-e0cb15d80396';

/** Cross-platform meal document (foreign profile + category ids); revision 0 by default. */
function mealEnvelope(overrides: Record<string, unknown> = {}): string {
  const payload: Record<string, unknown> = {
    id: REMOTE_MEAL,
    localProfileId: REMOTE_PROFILE,
    date: '2026-10-31',
    mealCategoryId: REMOTE_CATEGORY_ID,
    mealCategoryKey: 'Breakfast',
    title: 'Șnițel cu mămăligă 🥗',
    ingredients: 'brânză, smântână',
    plannedTime: '07:30:00',
    status: 'Pending',
    createdAt: '2026-10-31T16:38:16.276Z',
    updatedAt: '2026-10-31T16:38:55.733Z',
    revision: 0,
    syncStatus: 'PendingUpload',
    ...overrides,
  };
  return JSON.stringify({
    schemaVersion: 1,
    entityType: 'MealEntry',
    entityId: REMOTE_MEAL,
    localProfileId: REMOTE_PROFILE,
    // The envelope always publishes the revision of the payload it carries.
    revision: Number(payload.revision ?? 0),
    updatedAt: '2026-10-31T16:38:55.733Z',
    deviceId: '9fcb58f1-3e09-4b2f-bc0a-078501fff47c',
    isDeleted: false,
    contentHash: 'abc',
    payload,
  });
}

function photoEnvelope(mealEntryId: string, overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    schemaVersion: 1,
    entityType: 'MealPhoto',
    entityId: REMOTE_PHOTO,
    localProfileId: REMOTE_PROFILE,
    revision: 0,
    updatedAt: '2026-10-31T16:40:00.000Z',
    deviceId: 'windows-device',
    isDeleted: false,
    contentHash: 'photo-hash',
    payload: {
      id: REMOTE_PHOTO,
      mealEntryId,
      originalFileName: 'IMG_8819.JPG',
      localFileId: 'abcdef0123456789abcdef0123456789.jpg',
      thumbnailId: 'abcdef0123456789abcdef0123456789.png',
      mimeType: 'image/jpeg',
      fileSize: 1234,
      contentHash: 'photo-hash',
      createdAt: '2026-10-31T16:40:00.000Z',
      updatedAt: '2026-10-31T16:40:00.000Z',
      syncStatus: 'PendingUpload',
      ...overrides,
    },
  });
}

function envelopeOf(
  entityType: string,
  entityId: string,
  payload: Record<string, unknown>,
  revision = 0,
  deviceId = 'windows-device',
): string {
  return JSON.stringify({
    schemaVersion: 1,
    entityType,
    entityId,
    localProfileId: REMOTE_PROFILE,
    revision,
    updatedAt: '2026-10-31T16:00:00.000Z',
    deviceId,
    isDeleted: false,
    contentHash: 'hash',
    payload,
  });
}

/** Fresh database with a signed-in local profile and the five categories. */
async function seed() {
  await getDb();
  await ensureCategories();
  const now = new Date().toISOString();
  await upsertProfile({
    id: LOCAL_PROFILE,
    providerType: ProviderType.Google,
    providerUserId: GOOGLE_SUB,
    displayName: 'Andrei Razmerita',
    email: 'andrushkadeveloper@gmail.com',
    timeZone: '',
    isActive: 1,
    createdAt: now,
    updatedAt: now,
    syncStatus: SyncStatus.Synced,
    cloudRevision: null,
  });
  await upsertPreferences(defaultPreferences(LOCAL_PROFILE));
  return getCategories();
}

async function countRows(table: string): Promise<number> {
  const value = await queryOne(`SELECT COUNT(*) AS c FROM ${table};`, [], (row) => Number(row.c));
  return value ?? 0;
}

beforeEach(async () => {
  await closeDb();
  await seed();
});

afterAll(async () => {
  await closeDb();
});

describe('profile identity mapping', () => {
  test('a Windows profile document merges into the local profile row', async () => {
    const json = envelopeOf(
      'UserProfile',
      REMOTE_PROFILE,
      {
        id: REMOTE_PROFILE,
        providerType: 'Google',
        providerUserId: GOOGLE_SUB,
        displayName: 'Andrushka Developer',
        email: 'andrushkadeveloper@gmail.com',
        timeZone: '',
        isActive: 1,
        createdAt: '2026-10-31T16:43:51.211Z',
        updatedAt: '2026-10-31T16:44:02.497Z',
        syncStatus: 'PendingUpdate',
      },
      1,
    );

    await expect(applyRemoteDocument(json, { acceptOwnDevice: false })).resolves.toBe('applied');

    const profile = await getActiveProfile();
    expect(profile?.id).toBe(LOCAL_PROFILE); // the local id survives
    expect(profile?.displayName).toBe('Andrushka Developer');
    expect(await countRows('UserProfile')).toBe(1); // no UNIQUE violation, no duplicate
  });
});

describe('meal import', () => {
  test('Windows ids are mapped onto the local profile and category', async () => {
    const categories = await getCategories();
    const breakfast = categories.find((c) => c.fixedCategoryKey === MealCategoryKey.Breakfast);

    await expect(applyRemoteDocument(mealEnvelope(), { acceptOwnDevice: false })).resolves.toBe(
      'applied',
    );

    const meal = await getMealById(REMOTE_MEAL);
    expect(meal).not.toBeNull();
    expect(meal?.localProfileId).toBe(LOCAL_PROFILE);
    expect(meal?.mealCategoryId).toBe(breakfast?.id);
    // Romanian text and the emoji arrive intact (UTF-8, not truncated).
    expect(meal?.title).toBe('Șnițel cu mămăligă 🥗');
    expect(meal?.ingredients).toBe('brânză, smântână');
  });

  test('a revision-zero record with no local copy is accepted, not treated as a conflict', async () => {
    await applyRemoteDocument(mealEnvelope(), { acceptOwnDevice: false });
    expect(await countRows('ConflictRecord')).toBe(0);
  });

  test('a local placeholder slot adopts the cloud identity and keeps its photo', async () => {
    const categories = await getCategories();
    const breakfast = categories.find((c) => c.fixedCategoryKey === MealCategoryKey.Breakfast);
    const now = new Date().toISOString();
    await upsertMeal({
      id: LOCAL_PLACEHOLDER,
      localProfileId: LOCAL_PROFILE,
      date: '2026-10-31',
      mealCategoryId: breakfast?.id ?? '',
      mealCategoryKey: MealCategoryKey.Breakfast,
      title: '',
      ingredients: '',
      plannedTime: null,
      status: 0,
      completedAt: null,
      createdAt: now,
      updatedAt: now,
      revision: 0,
      syncStatus: SyncStatus.Synced,
      cloudRevision: null,
      contentHash: null,
    });
    await insertPhoto({
      id: LOCAL_PHOTO,
      mealEntryId: LOCAL_PLACEHOLDER,
      originalFileName: 'local.jpg',
      localFileId: 'local.jpg',
      thumbnailId: 'local.png',
      mimeType: 'image/jpeg',
      fileSize: 10,
      contentHash: 'local-hash',
      cloudObjectId: null,
      cloudRevision: null,
      createdAt: now,
      updatedAt: now,
      syncStatus: SyncStatus.Synced,
    });

    await expect(applyRemoteDocument(mealEnvelope(), { acceptOwnDevice: false })).resolves.toBe(
      'applied',
    );

    const slot = await getMealBySlot(LOCAL_PROFILE, '2026-10-31', MealCategoryKey.Breakfast);
    expect(slot?.id).toBe(REMOTE_MEAL);
    expect(await getMealById(LOCAL_PLACEHOLDER)).toBeNull();
    // The photograph followed the slot to its cloud identity.
    const photos = await getPhotosForMeal(REMOTE_MEAL);
    expect(photos).toHaveLength(1);
    expect(photos[0].id).toBe(LOCAL_PHOTO);
  });
});


describe('photograph import', () => {
  test('a photograph whose meal has not arrived is deferred, then applied', async () => {
    await expect(
      applyRemoteDocument(photoEnvelope(REMOTE_MEAL), { acceptOwnDevice: false }),
    ).resolves.toBe('retry');
    expect(await getPhotoById(REMOTE_PHOTO)).toBeNull();

    await applyRemoteDocument(mealEnvelope(), { acceptOwnDevice: false });

    await expect(
      applyRemoteDocument(photoEnvelope(REMOTE_MEAL), { acceptOwnDevice: false }),
    ).resolves.toBe('applied');

    const photo = await getPhotoById(REMOTE_PHOTO);
    expect(photo?.mealEntryId).toBe(REMOTE_MEAL);
  });

  test('a photograph of a meal under a different local id is re-pointed, never orphaned', async () => {
    const categories = await getCategories();
    const breakfast = categories.find((c) => c.fixedCategoryKey === MealCategoryKey.Breakfast);
    const now = new Date().toISOString();
    await upsertMeal({
      id: LOCAL_PLACEHOLDER,
      localProfileId: LOCAL_PROFILE,
      date: '2026-10-31',
      mealCategoryId: breakfast?.id ?? '',
      mealCategoryKey: MealCategoryKey.Breakfast,
      title: '',
      ingredients: '',
      plannedTime: null,
      status: 0,
      completedAt: null,
      createdAt: now,
      updatedAt: now,
      revision: 0,
      syncStatus: SyncStatus.Synced,
      cloudRevision: null,
      contentHash: null,
    });
    await applyRemoteDocument(mealEnvelope(), { acceptOwnDevice: false });

    await expect(
      applyRemoteDocument(photoEnvelope(REMOTE_MEAL), { acceptOwnDevice: false }),
    ).resolves.toBe('applied');

    expect(await getPhotoById(REMOTE_PHOTO)).not.toBeNull();
    expect(await countRows('MealPhoto')).toBe(1);
  });
});

describe('conflicts', () => {
  test('a genuine concurrent edit keeps both versions exactly once', async () => {
    await upsertAccount({
      id: LOCAL_ACCOUNT,
      providerType: ProviderType.Google,
      providerUserId: GOOGLE_SUB,
      displayName: 'local',
      email: 'local@example.com',
      rootFolderId: null,
      lastAuthenticatedAt: new Date().toISOString(),
      lastSynchronizedAt: null,
      isActive: 1,
      synchronizationEnabled: 1,
      quotaTotalBytes: null,
      quotaRemainingBytes: null,
    });
    await applyRemoteDocument(mealEnvelope(), { acceptOwnDevice: false });

    const local = await getMealById(REMOTE_MEAL);
    // The user edits the same meal on this device: pending journal entry + new content.
    if (local === null) {
      throw new Error('meal missing');
    }
    await upsertMeal({ ...local, title: 'Edited on mobile', revision: 2 });
    await journalOperation({
      id: '44444444-4444-4444-8444-444444444444',
      cloudAccountId: LOCAL_ACCOUNT,
      entityType: EntityType.MealEntry,
      entityId: REMOTE_MEAL,
      operationType: 0,
      status: 0,
      entityRevision: 2,
      retryCount: 0,
      lastError: null,
      nextAttemptAt: null,
      createdAt: new Date().toISOString(),
      completedAt: null,
    });

    // The cloud still holds the other device's version at the SAME revision: a genuine tie.
    const remote = mealEnvelope({ title: 'Edited on Windows', revision: 2 });
    await expect(applyRemoteDocument(remote, { acceptOwnDevice: false })).resolves.toBe('conflict');

    const conflicts = await getOpenConflicts();
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].localPayload).toContain('Edited on mobile');
    expect(conflicts[0].remotePayload).toContain('Edited on Windows');
    // The local row is untouched for the user to decide.
    expect((await getMealById(REMOTE_MEAL))?.title).toBe('Edited on mobile');

    // A second cycle does not stack a duplicate row for the same revision.
    await applyRemoteDocument(remote, { acceptOwnDevice: false });
    expect(await getOpenConflicts()).toHaveLength(1);
  });

  test('a slot with real local content is preserved as a conflict, not overwritten', async () => {
    const categories = await getCategories();
    const breakfast = categories.find((c) => c.fixedCategoryKey === MealCategoryKey.Breakfast);
    const now = new Date().toISOString();
    await upsertMeal({
      id: LOCAL_PLACEHOLDER,
      localProfileId: LOCAL_PROFILE,
      date: '2026-10-31',
      mealCategoryId: breakfast?.id ?? '',
      mealCategoryKey: MealCategoryKey.Breakfast,
      title: 'Local breakfast',
      ingredients: 'oats',
      plannedTime: '07:00:00',
      status: 0,
      completedAt: null,
      createdAt: now,
      updatedAt: now,
      revision: 1,
      syncStatus: SyncStatus.Synced,
      cloudRevision: null,
      contentHash: null,
    });

    await expect(applyRemoteDocument(mealEnvelope(), { acceptOwnDevice: false })).resolves.toBe(
      'conflict',
    );

    const untouched = await getMealById(LOCAL_PLACEHOLDER);
    expect(untouched?.title).toBe('Local breakfast');
    expect(await getMealById(REMOTE_MEAL)).toBeNull();
    expect(await getOpenConflicts()).toHaveLength(1);
  });
});


describe('shared settings, categories, templates and reminders', () => {
  test('only the shared preference fields are taken over', async () => {
    const local = await getPreferences(LOCAL_PROFILE);
    expect(local).not.toBeNull();
    // A device-specific setting the user chose locally.
    await upsertPreferences({ ...(local as NonNullable<typeof local>), syncFrequency: SyncFrequency.Manual, synchronizationEnabled: false });

    const json = envelopeOf('AppPreferences', REMOTE_PROFILE, {
      localProfileId: REMOTE_PROFILE,
      timeZone: 'Europe/Bucharest',
      showSnackCards: false,
      remindersEnabled: false,
      use12HourClock: true,
      synchronizationEnabled: true,
      syncFrequency: 'Monthly',
      preferredProvider: 'Google',
      cloudUploadConsentGranted: true,
      onboardingCompleted: true,
      updatedAt: '2026-10-31T16:50:00.000Z',
      syncStatus: 'Synced',
    });

    await expect(applyRemoteDocument(json, { acceptOwnDevice: false })).resolves.toBe('applied');

    const merged = await getPreferences(LOCAL_PROFILE);
    expect(merged?.localProfileId).toBe(LOCAL_PROFILE);
    expect(merged?.timeZone).toBe('Europe/Bucharest');
    expect(merged?.showSnackCards).toBe(false);
    expect(merged?.remindersEnabled).toBe(false);
    expect(merged?.use12HourClock).toBe(true);
    // Device-specific settings survive.
    expect(merged?.syncFrequency).toBe(SyncFrequency.Manual);
    expect(merged?.synchronizationEnabled).toBe(false);
    expect(await countRows('AppPreferences')).toBe(1);
  });

  test('a category document keeps the local id but takes the emoji icon', async () => {
    const before = (await getCategories()).find((c) => c.fixedCategoryKey === MealCategoryKey.Lunch);
    const json = envelopeOf('MealCategory', REMOTE_CATEGORY_ID, {
      id: REMOTE_CATEGORY_ID,
      fixedCategoryKey: 'Lunch',
      name: 'Prânz',
      color: '#FF107C10',
      icon: '🍲️',
      defaultTime: '13:30:00',
      displayOrder: 2,
    });

    await expect(applyRemoteDocument(json, { acceptOwnDevice: false })).resolves.toBe('applied');

    const after = (await getCategories()).find((c) => c.fixedCategoryKey === MealCategoryKey.Lunch);
    expect(after?.id).toBe(before?.id);
    expect(after?.name).toBe('Prânz');
    expect(after?.icon).toBe('🍲️');
    expect(await getMealById(REMOTE_CATEGORY_ID)).toBeNull();
  });

  test('a template is stored under the local profile', async () => {
    const json = envelopeOf('MealTemplate', REMOTE_TEMPLATE, {
      id: REMOTE_TEMPLATE,
      localProfileId: REMOTE_PROFILE,
      name: 'Mic dejun',
      isFullDay: false,
      templateData: JSON.stringify({
        single: { mealCategoryKey: 'Breakfast', title: 'Omletă 🍳', ingredients: 'ouă', plannedTime: '07:30:00' },
        day: [],
      }),
      createdAt: '2026-10-31T16:00:00.000Z',
      updatedAt: '2026-10-31T16:00:00.000Z',
      syncStatus: 'Synced',
    });

    await expect(applyRemoteDocument(json, { acceptOwnDevice: false })).resolves.toBe('applied');

    const row = await queryOne(
      'SELECT LocalProfileId, Name FROM MealTemplate WHERE Id = ?;',
      [REMOTE_TEMPLATE],
      (r) => ({ profileId: String(r.LocalProfileId), name: String(r.Name) }),
    );
    expect(row?.profileId).toBe(LOCAL_PROFILE);
    expect(row?.name).toBe('Mic dejun');
  });

  test('a reminder is stored under the local profile and category', async () => {
    const categories = await getCategories();
    const lunch = categories.find((c) => c.fixedCategoryKey === MealCategoryKey.Lunch);
    await upsertCategory({ ...(lunch as NonNullable<typeof lunch>) });

    const json = envelopeOf('ReminderSettings', REMOTE_REMINDER, {
      id: REMOTE_REMINDER,
      localProfileId: REMOTE_PROFILE,
      mealCategoryId: REMOTE_CATEGORY_ID,
      mealCategoryKey: 'Lunch',
      enabled: true,
      time: '13:15:00',
      weekdays: 127,
      snoozeMinutes: 10,
      updatedAt: '2026-10-31T16:00:00.000Z',
      syncStatus: 'Synced',
    });

    await expect(applyRemoteDocument(json, { acceptOwnDevice: false })).resolves.toBe('applied');

    const row = await queryOne(
      'SELECT LocalProfileId, MealCategoryId FROM ReminderSettings LIMIT 1;',
      [],
      (r) => ({ profileId: String(r.LocalProfileId), categoryId: String(r.MealCategoryId) }),
    );
    expect(row?.profileId).toBe(LOCAL_PROFILE);
    expect(row?.categoryId).toBe(lunch?.id);
  });
});

describe('published envelopes', () => {
  test('the envelope carries the row revision, not a constant zero', async () => {
    const categories = await getCategories();
    const breakfast = categories.find((c) => c.fixedCategoryKey === MealCategoryKey.Breakfast);
    const now = new Date().toISOString();
    await upsertMeal({
      id: REMOTE_MEAL_2,
      localProfileId: LOCAL_PROFILE,
      date: '2026-11-01',
      mealCategoryId: breakfast?.id ?? '',
      mealCategoryKey: MealCategoryKey.Breakfast,
      title: 'Trei revizii',
      ingredients: 'test',
      plannedTime: null,
      status: 0,
      completedAt: null,
      createdAt: now,
      updatedAt: now,
      revision: 3,
      syncStatus: SyncStatus.PendingUpload,
      cloudRevision: null,
      contentHash: null,
    });

    const envelope = await buildEnvelope(EntityType.MealEntry, REMOTE_MEAL_2, false);
    expect(envelope?.revision).toBe(3);
    expect(envelope?.localProfileId).toBe(LOCAL_PROFILE);
  });
});

describe('upload compare-and-swap', () => {
  test('a stale local edit is not uploaded over a newer cloud copy', async () => {
    const provider = jest.requireMock('../src/cloud/driveProvider') as {
      listObjects: jest.Mock;
      listChanges: jest.Mock;
      uploadObject: jest.Mock;
    };

    await upsertAccount({
      id: LOCAL_ACCOUNT,
      providerType: ProviderType.Google,
      providerUserId: GOOGLE_SUB,
      displayName: 'local',
      email: 'local@example.com',
      rootFolderId: null,
      lastAuthenticatedAt: new Date().toISOString(),
      lastSynchronizedAt: null,
      isActive: 1,
      synchronizationEnabled: 1,
      quotaTotalBytes: null,
      quotaRemainingBytes: null,
    });

    const categories = await getCategories();
    const lunch = categories.find((c) => c.fixedCategoryKey === MealCategoryKey.Lunch);
    const now = new Date().toISOString();
    await upsertMeal({
      id: REMOTE_MEAL_2,
      localProfileId: LOCAL_PROFILE,
      date: '2026-11-02',
      mealCategoryId: lunch?.id ?? '',
      mealCategoryKey: MealCategoryKey.Lunch,
      title: 'Edited on this device',
      ingredients: 'test',
      plannedTime: null,
      status: 0,
      completedAt: null,
      createdAt: now,
      updatedAt: now,
      revision: 2,
      syncStatus: SyncStatus.PendingUpdate,
      cloudRevision: '1',
      contentHash: 'local-hash',
    });
    await journalOperation({
      id: '55555555-5555-4555-8555-555555555555',
      cloudAccountId: LOCAL_ACCOUNT,
      entityType: EntityType.MealEntry,
      entityId: REMOTE_MEAL_2,
      operationType: 0,
      status: 0,
      entityRevision: 2,
      retryCount: 0,
      lastError: null,
      nextAttemptAt: null,
      createdAt: now,
      completedAt: null,
    });

    // The cloud already holds a newer version of the same document.
    provider.listObjects.mockResolvedValue([
      {
        path: `entities/MealEntry/${REMOTE_MEAL_2}.json`,
        id: 'file-1',
        revision: '99',
        modifiedAt: now,
        sizeBytes: 10,
        hash: null,
      },
    ]);
    provider.listChanges.mockResolvedValue([]);

    await runCycle({ trigger: SyncTrigger.Manual });

    expect(provider.uploadObject).not.toHaveBeenCalled();
    const pending = await getPendingOperations(LOCAL_ACCOUNT);
    expect(pending).toHaveLength(1);
    expect(pending[0].lastError).toContain('sync.remote-changed');
    expect(pending[0].status).toBe(3); // SyncOperationStatus.Failed → retried later
  });
});


