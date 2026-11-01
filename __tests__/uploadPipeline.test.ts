// Regression tests for the upload pipeline and the sign-out barrier.
//
// Reported defects:
//  1. Signing out sat on "Uploading your changes" for a long time and then said
//     "Could not finish uploading". The barrier drove a full synchronization
//     CYCLE: when a background cycle was already running (the 3 s debounce of
//     the last edit), runCycle returned THAT promise, so the barrier's own
//     progress callback was never installed (bar stuck at 0 %), an 8 s deadline
//     fired, and after four such rounds the sign-out was refused while the
//     upload was in fact still running.
//  2. The upload itself was strictly sequential - one round trip per document.
//
// Covered here:
//  - one pass sends documents through a bounded parallel window (never above 3),
//  - progress is monotonic and ends on "everything settled",
//  - the barrier uploads and reports progress while another cycle is running,
//  - one transient failure is retried (backoff ignored) and the sign-out ends ok,
//  - a dead connection refuses the sign-out in bounded time and keeps the cache,
//  - a rejected grant ends the barrier at once.

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

import { ProviderType, SyncStatus, SyncTrigger } from '../src/domain/enums';
import { closeDb, getDb } from '../src/data/database';
import {
  countPendingOperations,
  getActiveAccount,
  upsertAccount,
  upsertPreferences,
  upsertProfile,
} from '../src/data/repositories';
import { defaultPreferences } from '../src/services/bootstrap';
import { ensureCategories, loadDay, saveMeal } from '../src/services/mealTracking';
import { runCycle, uploadOutbox } from '../src/cloud/syncEngine';
import { signOutGoogle, type SignOutProgress } from '../src/cloud/session';
import { AuthError } from '../src/cloud/auth';
import * as drive from '../src/cloud/driveProvider';

const LOCAL_PROFILE = '11111111-1111-4111-8111-111111111111';
const LOCAL_ACCOUNT = '33333333-3333-4333-8333-333333333333';
const DAY = '2026-11-01';

const uploadObject = drive.uploadObject as jest.Mock;
const listObjects = drive.listObjects as jest.Mock;
const listChanges = drive.listChanges as jest.Mock;

function driveObject(path: string) {
  return {
    path,
    id: `id-${path}`,
    revision: '1',
    modifiedAt: new Date().toISOString(),
    sizeBytes: 1,
    hash: null,
  };
}

/** Resolves after `ms` (used to keep an upload "in flight" across a check). */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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

/** Writes `count` meals of the day, each one journaled for the account. */
async function journalMeals(count: number): Promise<void> {
  const day = await loadDay(LOCAL_PROFILE, DAY);
  for (let index = 0; index < count; index += 1) {
    const meal = day.meals[index];
    await saveMeal(
      { ...meal, title: `Meal ${index + 1}`, ingredients: 'content' },
      LOCAL_ACCOUNT,
      true,
    );
  }
}

beforeEach(async () => {
  await closeDb();
  uploadObject.mockReset();
  uploadObject.mockImplementation(async (path: string) => driveObject(path));
  listObjects.mockReset();
  listObjects.mockImplementation(async () => []);
  listChanges.mockReset();
  listChanges.mockImplementation(async () => []);
  await seedProfile();
});

afterAll(async () => {
  await closeDb();
});


describe('the upload pipeline drains the outbox in a bounded parallel window', () => {
  test('several documents travel at the same time, never more than three', async () => {
    await seedAccount();
    await journalMeals(5);
    await expect(countPendingOperations(LOCAL_ACCOUNT)).resolves.toBe(5);

    let inFlight = 0;
    let peak = 0;
    uploadObject.mockImplementation(async (path: string) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await sleep(25);
      inFlight -= 1;
      return driveObject(path);
    });

    const pass = await uploadOutbox({});

    expect(pass.uploaded).toBe(5);
    expect(pass.failed).toBe(0);
    expect(pass.pending).toBe(0);
    // Parallel (one round trip is not waited for before the next starts) and
    // bounded (the phone is not asked to run the whole outbox at once).
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThanOrEqual(3);
    await expect(countPendingOperations(LOCAL_ACCOUNT)).resolves.toBe(0);
  });

  test('progress is monotonic and ends on the last document', async () => {
    await seedAccount();
    await journalMeals(5);

    const frames: Array<{ settled: number; total: number }> = [];
    await uploadOutbox({
      onProgress: (settled, total) => frames.push({ settled, total }),
    });

    expect(frames[0]).toEqual({ settled: 0, total: 5 });
    expect(frames[frames.length - 1]).toEqual({ settled: 5, total: 5 });
    for (let index = 1; index < frames.length; index += 1) {
      expect(frames[index].settled).toBeGreaterThanOrEqual(frames[index - 1].settled);
      expect(frames[index].total).toBe(5);
    }
  });

  test('a document that cannot be sent stays in the outbox and is not counted as progress', async () => {
    await seedAccount();
    await journalMeals(2);
    uploadObject.mockImplementation(async () => {
      throw new Error('drive.network.timeout');
    });

    const frames: number[] = [];
    const pass = await uploadOutbox({
      onProgress: (settled) => frames.push(settled),
    });

    expect(pass.uploaded).toBe(0);
    expect(pass.failed).toBe(2);
    expect(pass.pending).toBe(2);
    // Only the 0 of 2 frame: nothing reached the cloud, so nothing moved.
    expect(Math.max(...frames)).toBe(0);
    await expect(countPendingOperations(LOCAL_ACCOUNT)).resolves.toBe(2);
  });
});


describe('the sign-out barrier uploads instead of waiting for a cycle', () => {
  test('it reports real progress while a background cycle is running', async () => {
    await seedAccount();
    await journalMeals(5);

    // A download-only cycle (the foreground poll) is stuck in the change feed
    // when the user taps Sign out. The old barrier joined it, so its progress
    // callback was dropped and the bar never left 0 %.
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    listChanges.mockImplementation(async () => {
      await held;
      return [];
    });
    const cycle = runCycle({ trigger: SyncTrigger.Manual, pullOnly: true });
    await sleep(20);

    const frames: SignOutProgress[] = [];
    const started = Date.now();
    const result = await signOutGoogle({
      onProgress: (progress) => frames.push(progress),
      retryDelayMs: 0,
      uploadBudgetMs: 5000,
    });
    const elapsed = Date.now() - started;

    expect(result.ok).toBe(true);
    // Every document really travelled: no round of the barrier waited for a
    // cycle deadline, so the whole sign-out is a fraction of a second.
    expect(elapsed).toBeLessThan(2000);
    expect(uploadObject).toHaveBeenCalledTimes(5);
    const uploadedFrames = frames.filter((frame) => frame.stage === 'uploading');
    expect(uploadedFrames.some((frame) => frame.settled > 0)).toBe(true);
    expect(frames[frames.length - 1]).toEqual({
      mode: 'signOut',
      stage: 'finishing',
      settled: 5,
      total: 5,
    });
    await expect(getActiveAccount()).resolves.toBeNull();

    release();
    await cycle;
  });
});

describe('a failure is handled by the standard, not by a stuck bar', () => {
  test('one transient failure is retried and the sign-out still finishes', async () => {
    await seedAccount();
    await journalMeals(3);
    let calls = 0;
    uploadObject.mockImplementation(async (path: string) => {
      calls += 1;
      if (calls === 1) {
        throw new Error('drive.network.hiccup');
      }
      return driveObject(path);
    });

    const stages: string[] = [];
    const result = await signOutGoogle({
      onProgress: (progress) => stages.push(progress.stage),
      retryDelayMs: 0,
    });

    expect(result.ok).toBe(true);
    // The first round lost one document, so the barrier waited and retried it
    // instead of refusing the sign-out.
    expect(stages).toContain('waiting');
    expect(stages[stages.length - 1]).toBe('finishing');
    // 3 documents + the one that had to travel twice.
    expect(uploadObject).toHaveBeenCalledTimes(4);
    await expect(countPendingOperations(LOCAL_ACCOUNT)).resolves.toBe(0);
  });

  test('a dead connection refuses the sign-out in bounded time and keeps every record', async () => {
    await seedAccount();
    await journalMeals(3);
    uploadObject.mockImplementation(async () => {
      throw new Error('drive.network.timeout');
    });

    const frames: SignOutProgress[] = [];
    const started = Date.now();
    const result = await signOutGoogle({
      onProgress: (progress) => frames.push(progress),
      maxUploadAttempts: 2,
      retryDelayMs: 0,
      uploadBudgetMs: 5000,
    });
    const elapsed = Date.now() - started;

    expect(result.ok).toBe(false);
    expect(result.pending).toBe(3);
    expect(result.error).toBe('Account_SignOutPendingDetail');
    // Two rounds with no artificial deadline wait per round.
    expect(elapsed).toBeLessThan(2000);
    // The bar never claims to have finished, and nothing was deleted.
    expect(frames[frames.length - 1].stage).not.toBe('finishing');
    expect(frames.every((frame) => frame.settled === 0)).toBe(true);
    await expect(getActiveAccount()).resolves.not.toBeNull();
    await expect(countPendingOperations(LOCAL_ACCOUNT)).resolves.toBe(3);
  });

  test('a rejected grant ends the barrier at once (revoked credentials are not retried)', async () => {
    await seedAccount();
    await journalMeals(3);
    uploadObject.mockImplementation(async () => {
      throw new AuthError('Auth_google_unauthorized');
    });

    const started = Date.now();
    const result = await signOutGoogle({ retryDelayMs: 50 });
    const elapsed = Date.now() - started;

    expect(result.ok).toBe(false);
    expect(result.error).toBe('Auth_google_unauthorized');
    expect(elapsed).toBeLessThan(1000);
    await expect(getActiveAccount()).resolves.not.toBeNull();
  });
});
