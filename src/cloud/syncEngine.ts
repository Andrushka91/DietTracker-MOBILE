// Synchronization engine - port of the Windows SyncEngine (spec 7).
//
// Offline first inside a session:
//   1. edit -> written to SQLite in a transaction
//   2. change recorded in the durable outbox (SyncOperation)
//   3. UI updates immediately
//   4. a debounced background cycle (3 s) uploads when an account is
//      connected, uploads are allowed and the device is online
//
// Triggers: after sign-in, at startup, after local changes (debounced), when
// connectivity returns, on "Synchronize now", and periodically (hourly knock;
// the schedule from Settings only paces CHANGE CHECKS - it never delays an
// upload that was just journaled, spec 8.8).
//
// States (spec 6.3): NotConfigured / Synced / Syncing / PendingChanges /
// Offline / AuthenticationRequired / Error / Paused. Synced is reported only
// after the provider confirmed the upload. The states are no longer painted on
// a permanent strip: they only feed the one status row of the Settings
// synchronization card. Pulling a list down (or the "Synchronize now" button)
// is the only visible manual surface.

import {
  CLOUD_SCHEMA_MIN_SUPPORTED,
  CLOUD_SCHEMA_VERSION,
  EntityType,
  SyncFrequency,
  SyncOperationStatus,
  SyncOperationType,
  SyncState,
  SyncStatus,
  SyncTrigger,
} from '../domain/enums';
import { CloudEnvelope, MealEntry, SyncOperation } from '../domain/models';
import { parseEnvelope, readEnvelopeHeader, serializeEnvelope } from '../domain/json';
import {
  categoryFromPayload,
  encodePayload,
  mealEntryFromPayload,
  mealPhotoFromPayload,
  mealTemplateFromPayload,
  preferencesFromPayload,
  profileFromPayload,
  reminderFromPayload,
} from '../domain/payloads';
import {
  hasMealUserContent,
  localIdentity,
  mergeProfileFromRemote,
  mergeSharedPreferences,
  remapMealEntryPayload,
  remapPhotoPayload,
  remapPreferencesPayload,
  remapReminderPayload,
  remapTemplatePayload,
  type LocalIdentity,
} from './identityMapping';
import { sha256OfString } from '../domain/hashing';
import { newGuid } from '../domain/rules/mealSlotRules';
import { isDue, isPassivePullAllowed } from '../domain/rules/syncFrequencyRules';
import { checkOnline, onConnectivityRestored } from '../services/connectivity';
import { getDeviceId } from '../services/deviceId';
import {
  adoptRemoteMealEntry,
  completeOperation,
  countPendingOperations,
  deleteMeal,
  deletePhoto,
  deleteReminder,
  deleteTemplate,
  deleteTombstone,
  failOperation,
  getActiveAccount,
  getActiveProfile,
  getCategories,
  getMealById,
  getMealBySlot,
  getMetadata,
  getPendingOperations,
  getPhotoById,
  getPreferences,
  getReminderById,
  getTemplateById,
  hasOpenConflict,
  insertConflict,
  upsertAccount,
  upsertCategory,
  upsertMeal,
  upsertMetadata,
  upsertPhotoRow,
  upsertPreferences,
  upsertProfile,
  upsertReminder,
  upsertTemplate,
} from '../data/repositories';
import {
  deleteObject,
  downloadObject,
  downloadObjectBase64,
  listChanges,
  listObjects,
  uploadObject,
  type DriveObject,
} from './driveProvider';
import { AuthError, type AuthErrorCode } from './auth';
import { ensureThumbnail, originalPath, thumbnailPath } from '../data/photoStore';
import RNFS from '../platform/fs';

export interface CycleResult {
  uploaded: number;
  downloaded: number;
  /**
   * Documents that were listed but could not be applied yet (missing bytes,
   * missing parent row, provider error). They stay behind the cursor and are
   * retried; they are never reported as a successful synchronization.
   */
  failed: number;
  /** Records whose two versions were both kept in ConflictRecord. */
  conflicts: number;
  /** Documents deliberately ignored (own echo, unsupported schema, corrupt). */
  skipped: number;
  /** Present when the cycle failed (the state also reflects the cause). */
  error?: string;
}

export type SyncStateListener = (state: SyncState, lastSuccess: string | null) => void;

let currentState: SyncState = SyncState.NotConfigured;
let lastSuccessfulSync: string | null = null;
let runningCycle: Promise<CycleResult> | null = null;
/**
 * Session token. Sign-out bumps it, so a cycle that is still in flight when the
 * session ends stops at its next document instead of writing the previous
 * account's records back into the freshly purged (guest) database.
 */
let sessionEpoch = 0;
/** A request that arrived while a cycle was running, run as one more pass. */
let pendingTrigger: SyncTrigger | null = null;
/** When the last automatic download ran, for the throttle of SyncTrigger.AutoPull. */
let lastAutoPullAt = 0;
const stateListeners = new Set<SyncStateListener>();

/** Listeners told to reload when a cycle imported records from another device. */
export type DataChangeListener = (imported: number) => void;
const dataListeners = new Set<DataChangeListener>();

/**
 * Subscribes to "records from the other device were applied". The screen uses
 * it to refresh the visible day, and it must keep an editor that is open in
 * front of the user untouched.
 */
export function subscribeDataChange(listener: DataChangeListener): () => void {
  dataListeners.add(listener);
  return () => {
    dataListeners.delete(listener);
  };
}

function emitState(state: SyncState): void {
  currentState = state;
  for (const listener of stateListeners) {
    listener(currentState, lastSuccessfulSync);
  }
}

export function getSyncState(): { state: SyncState; lastSuccess: string | null } {
  return { state: currentState, lastSuccess: lastSuccessfulSync };
}

export function subscribeSyncState(listener: SyncStateListener): () => void {
  stateListeners.add(listener);
  listener(currentState, lastSuccessfulSync);
  return () => stateListeners.delete(listener);
}

/**
 * Derives the visible state from the stored account at start-up so the
 * screens do not depend on a cycle having run (spec 7.8 / overview).
 */
export async function refreshStateAsync(): Promise<SyncState> {
  const account = await getActiveAccount();
  if (account === null) {
    lastSuccessfulSync = null;
    emitState(SyncState.NotConfigured);
    return currentState;
  }
  lastSuccessfulSync = account.lastSynchronizedAt;
  if (account.synchronizationEnabled === 0) {
    emitState(SyncState.Paused);
  } else if (!(await checkOnline())) {
    emitState(SyncState.Offline);
  } else if ((await countPendingOperations(account.id)) > 0) {
    emitState(SyncState.PendingChanges);
  } else {
    emitState(SyncState.Synced);
  }
  return currentState;
}

/** Exponential backoff: 5 s, 10 s, 20 s ... capped at 5 minutes (spec 16.3). */
export function backoffDelayMs(retryCount: number): number {
  return Math.min(300000, 5000 * 2 ** retryCount);
}

/** Logical cloud path of one entity document (parity with CloudObjectPaths). */
export function entityPath(entityType: EntityType, entityId: string): string {
  return `entities/${entityTypeNameSafe(entityType)}/${entityId}.json`;
}

function entityTypeNameSafe(entityType: EntityType): string {
  switch (entityType) {
    case EntityType.UserProfile:
      return 'UserProfile';
    case EntityType.MealEntry:
      return 'MealEntry';
    case EntityType.MealPhoto:
      return 'MealPhoto';
    case EntityType.MealTemplate:
      return 'MealTemplate';
    case EntityType.ReminderSettings:
      return 'ReminderSettings';
    case EntityType.AppPreferences:
      return 'AppPreferences';
    case EntityType.MealCategory:
      return 'MealCategory';
    default:
      return 'MealEntry';
  }
}

/** Photograph binary path (parity with CloudObjectPaths.GetPhotoBinaryPath). */
export function photoBinaryPath(photoId: string): string {
  return `photos/${photoId}.bin`;
}

/** Reads the local row behind one journal entry (all seven entity types). */
async function loadEntityForSync(
  entityType: EntityType,
  entityId: string,
): Promise<{ payload: Record<string, unknown>; updatedAt: string; revision: number } | null> {
  switch (entityType) {
    case EntityType.MealEntry: {
      const entry = await getMealById(entityId);
      if (entry === null) {
        return null;
      }
      return {
        payload: encodePayload(EntityType.MealEntry, entry),
        updatedAt: entry.updatedAt,
        revision: entry.revision,
      };
    }
    case EntityType.MealPhoto: {
      const photo = await getPhotoById(entityId);
      if (photo === null) {
        return null;
      }
      return {
        payload: encodePayload(EntityType.MealPhoto, photo),
        updatedAt: photo.updatedAt,
        revision: 1,
      };
    }
    case EntityType.MealTemplate: {
      const template = await getTemplateById(entityId);
      if (template === null) {
        return null;
      }
      return {
        payload: encodePayload(EntityType.MealTemplate, template),
        updatedAt: template.updatedAt,
        revision: 1,
      };
    }
    case EntityType.ReminderSettings: {
      const reminder = await getReminderById(entityId);
      if (reminder === null) {
        return null;
      }
      return {
        payload: encodePayload(EntityType.ReminderSettings, reminder),
        updatedAt: reminder.updatedAt,
        revision: 1,
      };
    }
    case EntityType.AppPreferences: {
      const profile = await getActiveProfile();
      const prefs = profile === null ? null : await getPreferences(profile.id);
      if (prefs === null) {
        return null;
      }
      return {
        payload: encodePayload(EntityType.AppPreferences, prefs),
        updatedAt: prefs.updatedAt,
        revision: 1,
      };
    }
    case EntityType.MealCategory: {
      const categories = await getCategories();
      const category = categories.find((c) => c.id === entityId);
      if (category === undefined) {
        return null;
      }
      return {
        payload: encodePayload(EntityType.MealCategory, category),
        updatedAt: new Date().toISOString(),
        revision: 1,
      };
    }
    case EntityType.UserProfile: {
      const profile = await getActiveProfile();
      if (profile === null || profile.id !== entityId) {
        return null;
      }
      return {
        payload: encodePayload(EntityType.UserProfile, profile),
        updatedAt: profile.updatedAt,
        revision: 1,
      };
    }
    default:
      return null;
  }
}

/** Builds the versioned envelope for a local record (spec 7.4). */
export async function buildEnvelope(
  entityType: EntityType,
  entityId: string,
  isDeleted: boolean,
): Promise<CloudEnvelope<Record<string, unknown>> | null> {
  const deviceId = await getDeviceId();
  const localProfileId = (await getActiveProfile())?.id ?? '';
  const entity = isDeleted ? null : await loadEntityForSync(entityType, entityId);
  const payload = entity?.payload ?? null;
  const contentHash = payload === null ? '' : sha256OfString(JSON.stringify(payload));
  return {
    schemaVersion: CLOUD_SCHEMA_VERSION,
    entityType,
    entityId,
    localProfileId,
    // The revision the payload was produced from - the Windows conflict resolver compares it
    // with the local row, so publishing a constant zero made every new record look stale.
    revision: entity?.revision ?? 0,
    updatedAt: entity?.updatedAt ?? new Date().toISOString(),
    deviceId,
    isDeleted,
    contentHash,
    payload,
  };
}

/** Index of existing dataset files (path -> DriveObject) for CAS updates. */
async function buildFileIndex(): Promise<Map<string, DriveObject>> {
  const objects = await listObjects();
  return new Map(objects.map((object) => [object.path, object]));
}
/**
 * Decides what a stale compare-and-swap base revision means for one meal.
 *
 * The provider reports the version of the object it holds; the local row remembers the version its
 * own upload produced. When the two differ, another device wrote the record in between. A strictly
 * newer local revision wins (the base is released and the upload replaces the cloud copy); an equal
 * or older local revision keeps BOTH versions in ConflictRecord and finishes the operation, so the
 * outbox never holds an entry that can only fail.
 *
 * @returns true when the operation was settled here and must not upload.
 */
async function resolveStaleBaseRevision(
  op: SyncOperation,
  existing: DriveObject,
  fileIndex: Map<string, DriveObject>,
): Promise<boolean> {
  const local = await loadEntityForSync(EntityType.MealEntry, op.entityId);
  if (local === null) {
    return false;
  }

  const remoteRevision = Number(existing.revision ?? 0);
  if (local.revision > remoteRevision) {
    // This device's version is newer: the stored base is simply out of date.
    await releaseCompareAndSwapBase(EntityType.MealEntry, op.entityId);
    return false;
  }

  const json = await downloadObject(existing.path, existing.id);
  const envelope = json === null ? null : parseEnvelope(json);
  if (json === null || envelope === null || envelope.payload === null) {
    // The cloud copy cannot be read: keep the operation and try again later rather than guess.
    throw new Error('sync.remote-changed');
  }

  const header = readEnvelopeHeader(json);
  await recordConflict(
    {
      entityType: EntityType.MealEntry,
      entityId: op.entityId,
      updatedAt: header?.updatedAt ?? new Date().toISOString(),
      revision: header?.revision ?? remoteRevision,
      deviceId: header?.deviceId ?? '',
    },
    local.payload,
    envelope.payload,
  );

  // The user decides from now on. Ending the operation is what keeps the pending counter honest;
  // leaving it in the outbox would retry the same rejected upload forever.
  await completeOperation(op.id, new Date().toISOString());
  fileIndex.set(existing.path, existing);
  return true;
}



/** Uploads one pending journal entry. Returns true on provider success. */
async function pushOperation(
  op: SyncOperation,
  fileIndex: Map<string, DriveObject>,
): Promise<void> {
  const path = entityPath(op.entityType, op.entityId);
  const existing = fileIndex.get(path) ?? null;

  if (op.operationType === SyncOperationType.Delete) {
    const envelope = await buildEnvelope(op.entityType, op.entityId, true);
    if (envelope !== null) {
      // Tombstone document first, then the binary removal is best-effort.
      const uploaded = await uploadObject(
        path,
        serializeEnvelope(envelope as CloudEnvelope<Record<string, unknown>>),
        'application/json',
        existing?.id ?? null,
      );
      fileIndex.set(path, uploaded);
      if (op.entityType === EntityType.MealPhoto) {
        const binaryPath = photoBinaryPath(op.entityId);
        await deleteObject(binaryPath, fileIndex.get(binaryPath)?.id ?? null);
        fileIndex.delete(binaryPath);
      }
    } else if (op.entityType === EntityType.MealPhoto) {
      const binaryPath = photoBinaryPath(op.entityId);
      await deleteObject(binaryPath, fileIndex.get(binaryPath)?.id ?? null);
      fileIndex.delete(binaryPath);
    }
    await completeOperation(op.id, new Date().toISOString());
    await deleteTombstone(op.entityType, op.entityId);
    return;
  }

  const envelope = await buildEnvelope(op.entityType, op.entityId, false);
  if (envelope === null) {
    // The local row is gone (placeholder skipped) - complete as tombstone-free no-op.
    await completeOperation(op.id, new Date().toISOString());
    return;
  }

  // Compare-and-swap: an update may only replace the exact cloud version this device last saw. When
  // another device is ahead, the upload must not overwrite that edit - and it must not wait forever
  // either: the pull only lists documents inside its clock-skew window, so a stale base revision
  // would keep the operation in the outbox with no conflict ever recorded. The mismatch is therefore
  // resolved here, with the same rule the apply path uses: a strictly newer local revision replaces
  // the cloud copy, anything else preserves both versions for the user.
  if (op.entityType === EntityType.MealEntry && existing !== null) {
    const meal = await getMealById(op.entityId);
    const baseRevision = meal?.cloudRevision ?? null;
    if (
      baseRevision !== null &&
      existing.revision !== null &&
      existing.revision !== baseRevision
    ) {
      if (await resolveStaleBaseRevision(op, existing, fileIndex)) {
        // Both versions were preserved for the user; this operation is settled.
        return;
      }
    }
  }

  // Photograph binaries travel before their metadata document so a reader
  // never sees a photo row without bytes (spec 7.4).
  if (op.entityType === EntityType.MealPhoto) {
    const photo = await getPhotoById(op.entityId);
    if (photo !== null) {
      const localPath = originalPath(photo.localFileId);
      if (await RNFS.exists(localPath)) {
        const base64 = await RNFS.readFile(localPath, 'base64');
        const binaryPath = photoBinaryPath(op.entityId);
        // The binary is updated in place: without the existing file id every edit
        // created a second object with the same name in the app folder.
        const uploadedBinary = await uploadObject(
          binaryPath,
          base64ToBytes(base64),
          'application/octet-stream',
          fileIndex.get(binaryPath)?.id ?? null,
        );
        fileIndex.set(binaryPath, uploadedBinary);
      }
    }
  }

  const uploaded = await uploadObject(
    path,
    serializeEnvelope(envelope as CloudEnvelope<Record<string, unknown>>),
    'application/json',
    existing?.id ?? null,
  );
  fileIndex.set(path, uploaded);
  if (op.entityType === EntityType.MealEntry) {
    const meal = await getMealById(op.entityId);
    // Only when the row did not change while it was uploading: the badge and the compare-and-swap
    // base revision now describe the version the cloud holds.
    if (meal !== null && meal.revision === envelope.revision) {
      await upsertMeal({
        ...meal,
        syncStatus: SyncStatus.Synced,
        cloudRevision: uploaded.revision ?? null,
      });
    }
  }
  await completeOperation(op.id, new Date().toISOString());
}

// --- the upload pipeline -----------------------------------------------------
//
// One standard, shared by every caller that drains the outbox (the background
// cycle, "Synchronize now", the sign-out barrier):
//
//  1. the outbox is the durable source of truth (SyncOperation), already
//     coalesced per document by journalOperation,
//  2. ONE listing per pass builds the path -> Drive id index, so every document
//     updates the object it already has instead of creating a new copy,
//  3. documents are sent through a small bounded window of parallel requests -
//     uploads are latency bound, and a strictly sequential loop paid one round
//     trip per document,
//  4. every document settles on its own: a failure records the backoff and
//     stays in the outbox, a success removes it - reported progress therefore
//     always means "documents that really reached the cloud",
//  5. the push phase is serialized process-wide, so a background cycle and an
//     account boundary can never upload the same outbox twice,
//  6. a pass accepts a deadline: no NEW document starts after it, while requests
//     already in flight finish (each is bounded by its own HTTP timeout), so the
//     caller is never left hanging and never has to guess what happened.

/** Documents one push pass may send at the same time. */
const UPLOAD_CONCURRENCY = 3;

/**
 * Serializes the push phase. A cycle that is downloading must never block an
 * account boundary, so the lock covers the uploads only - not the whole cycle.
 */
let pushChain: Promise<unknown> = Promise.resolve();

function withPushLock<T>(work: () => Promise<T>): Promise<T> {
  const run = pushChain.then(work, work);
  pushChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/** Options of one outbox pass (see the rules above). */
export interface OutboxUploadOptions {
  /** Ignores the exponential-backoff window of a failed document. */
  ignoreBackoff?: boolean;
  /** Called with (settled, total) after every document that left the outbox. */
  onProgress?: (settled: number, total: number) => void;
  /** Absolute epoch ms: no new document starts after it. */
  deadlineAt?: number;
  /** Reuses the listing of an earlier pass (retry rounds of one barrier). */
  fileIndex?: Map<string, DriveObject>;
  /** Session epoch the caller captured (its own work must never look stale). */
  epoch?: number;
}

/** What one outbox pass achieved. */
export interface OutboxUploadResult {
  /** Documents that reached the cloud in this pass. */
  uploaded: number;
  /** Documents that failed in this pass (they stay in the outbox). */
  failed: number;
  /** Documents still waiting when the pass ended. */
  pending: number;
  /** The listing the pass used - hand it back to the next round. */
  fileIndex: Map<string, DriveObject>;
  /** Stable code when the pass was aborted (auth failure). */
  error?: string;
}

/**
 * Drains the outbox once. Returns how many documents really reached the cloud
 * plus what is still waiting, so the caller never has to guess.
 */
export function uploadOutbox(options: OutboxUploadOptions = {}): Promise<OutboxUploadResult> {
  return withPushLock(() => uploadOutboxLocked(options));
}

async function uploadOutboxLocked(options: OutboxUploadOptions): Promise<OutboxUploadResult> {
  const account = await getActiveAccount();
  const cachedIndex = options.fileIndex ?? new Map<string, DriveObject>();
  if (account === null) {
    return { uploaded: 0, failed: 0, pending: 0, fileIndex: cachedIndex };
  }
  const pending = await getPendingOperations(account.id);
  if (pending.length === 0) {
    return { uploaded: 0, failed: 0, pending: 0, fileIndex: cachedIndex };
  }

  const total = pending.length;
  // 0 of N is the first frame of the sign-out bar: the bar starts empty and
  // moves one step per settled document.
  options.onProgress?.(0, total);

  // The listing is the first request of a pass. A dead connection fails it, and
  // then nothing can be decided about an individual document: the pass reports
  // "no progress" (the caller retries or refuses) instead of throwing at the
  // caller, which would leave the sign-out bar without an answer.
  let fileIndex: Map<string, DriveObject>;
  try {
    fileIndex = options.fileIndex ?? (await buildFileIndex());
  } catch (error) {
    const message = error instanceof AuthError ? error.code : String(error);
    return {
      uploaded: 0,
      failed: 0,
      pending: pending.length,
      fileIndex: cachedIndex,
      ...(error instanceof AuthError ? { error: message } : {}),
    };
  }
  const epoch = options.epoch ?? sessionEpoch;
  const ignoreBackoff = options.ignoreBackoff === true;
  const deadlineAt = options.deadlineAt ?? Number.POSITIVE_INFINITY;

  let settled = 0;
  let failed = 0;
  let next = 0;
  let fatal: string | null = null;

  /** One worker: takes the next document of the list until it is exhausted. */
  const worker = async (): Promise<void> => {
    for (;;) {
      if (fatal !== null || cycleIsStale(epoch) || Date.now() >= deadlineAt) {
        return;
      }
      const index = next;
      if (index >= pending.length) {
        return;
      }
      next += 1;
      const op = pending[index];
      if (!ignoreBackoff && op.status === SyncOperationStatus.Failed && op.nextAttemptAt !== null) {
        if (Date.parse(op.nextAttemptAt) > Date.now()) {
          continue; // still inside the backoff window: not due, not a failure
        }
      }
      try {
        await pushOperation(op, fileIndex);
        settled += 1;
        options.onProgress?.(settled, total);
      } catch (error) {
        const message = error instanceof AuthError ? error.code : String(error);
        failed += 1;
        const retryCount = op.retryCount + 1;
        const nextAttempt =
          retryCount > 8
            ? null
            : new Date(Date.now() + backoffDelayMs(op.retryCount)).toISOString();
        await failOperation(op.id, message, retryCount, nextAttempt);
        if (error instanceof AuthError) {
          // Retrying revoked credentials only burns the user's time.
          fatal = error.code;
          return;
        }
      }
    }
  };

  const workers = Math.max(1, Math.min(UPLOAD_CONCURRENCY, pending.length));
  await Promise.all(Array.from({ length: workers }, () => worker()));

  const remaining = await countPendingOperations(account.id);
  return {
    uploaded: settled,
    failed,
    pending: remaining,
    fileIndex,
    ...(fatal === null ? {} : { error: fatal }),
  };
}

/** Push phase of a cycle: drain the durable outbox (order = CreatedAt). */
async function pushPending(
  epoch: number,
  onProgress?: (uploaded: number, total: number) => void,
  ignoreBackoff = false,
): Promise<number> {
  const pass = await uploadOutbox({ ignoreBackoff, onProgress, epoch });
  if (pass.error !== undefined) {
    // A rejected grant aborts the whole cycle: the pull would fail the same way.
    throw new AuthError(pass.error as AuthErrorCode);
  }
  return pass.uploaded;
}

/** Base64 -> bytes (upload helper; works in Hermes + Jest). */
function base64ToBytes(base64: string): Uint8Array {
  const alphabet =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const clean = base64.replace(/[=]+$/, '');
  const bytes = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let byteIndex = 0;
  let buffer = 0;
  let bits = 0;
  for (let i = 0; i < clean.length; i += 1) {
    const value = alphabet.indexOf(clean[i]);
    if (value < 0) {
      continue;
    }
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes[byteIndex] = (buffer >> bits) & 0xff;
      byteIndex += 1;
    }
  }
  return bytes.subarray(0, byteIndex);
}

/**
 * Applies one remote document to the local cache. Returns true when the
 * document was applied (counted as downloaded).
 *
 * Rules (spec 7.5/7.7):
 *  - corrupt JSON / schema outside [min, current] -> ignored, never crashes
 *  - echo suppression: documents produced by THIS installation are skipped
 *    while the local record still exists; after a purge the local record is
 *    missing and the document IS applied (an interrupted rebuild repairs itself)
 *  - a tombstone deletes the local row: a meal slot re-materializes as an
 *    empty placeholder (the five cards are permanent)
 *  - both-changed conflicts keep BOTH versions in ConflictRecord and leave
 *    the local row untouched for the user to decide
 */
export async function applyRemoteDocument(
  json: string,
  options: { acceptOwnDevice: boolean },
  /**
   * Provider revision of the cloud object (the Drive file version). It is what the local row stores
   * as its compare-and-swap base, so an upload can prove it still replaces the version it saw.
   * Defaults to the envelope revision when the caller has no provider metadata (tests, backups).
   */
  cloudRevisionToken?: string | null,
): Promise<ApplyOutcome> {
  const header = readEnvelopeHeader(json);
  if (header === null) {
    return 'skipped'; // corrupt document: never crashes, never blocks the cursor
  }
  if (
    header.schemaVersion > CLOUD_SCHEMA_VERSION ||
    header.schemaVersion < CLOUD_SCHEMA_MIN_SUPPORTED
  ) {
    return 'skipped';
  }
  const envelope = parseEnvelope(json);
  if (envelope === null) {
    return 'skipped';
  }

  const deviceId = await getDeviceId();
  if (!options.acceptOwnDevice && envelope.deviceId === deviceId) {
    // Echo of our own upload. Skip it while the local copy is unchanged; when the local row moved on
    // after that upload, THIS version is the newer one and the queued change replaces it.
    const local = await loadEntityForSync(header.entityType, header.entityId);
    if (local !== null) {
      if (!(await hasPendingLocalChanges(header.entityType, header.entityId))) {
        return 'skipped';
      }
      await releaseCompareAndSwapBase(header.entityType, header.entityId);
      return 'skipped';
    }
  }

  if (header.isDeleted) {
    await removeLocalEntity(header.entityType, header.entityId);
    return 'applied';
  }

  if (envelope.payload === null) {
    return 'skipped';
  }

  const local = await loadEntityForSync(header.entityType, header.entityId);
  if (
    local !== null &&
    header.entityType === EntityType.MealEntry &&
    local.revision > header.revision
  ) {
    // This device holds a NEWER revision than the cloud copy (not a concurrent edit: revisions are
    // ordered). The local version wins, so the compare-and-swap base is released and the queued
    // upload replaces the older cloud copy instead of being deferred forever.
    await releaseCompareAndSwapBase(header.entityType, header.entityId);
    return 'skipped';
  }

  // The provider re-lists documents modified within a few seconds of the stored watermark (the
  // clock-skew window in listChanges), so the same document arrives again on every cycle. Applying
  // it is idempotent, but reporting it as a download would flash the status strip and reload the
  // visible day every few seconds. The payload comparison is what makes this safe: an edit that
  // reached the cloud at the same revision still differs and must go through the conflict path.
  if (local !== null && local.revision === header.revision && samePayload(local.payload, envelope.payload)) {
    return 'unchanged';
  }

  if (local !== null && (await hasPendingLocalChanges(header.entityType, header.entityId))) {
    // Both sides changed at the same revision: keep both versions and leave the local row alone.
    await recordConflict(header, local.payload, envelope.payload);
    return 'conflict';
  }

  return writeRemoteEntity(
    header.entityType,
    header.entityId,
    envelope.payload,
    header.revision,
    cloudRevisionToken ?? null,
  );
}

/** Outcome of applying one remote document. */
export type ApplyOutcome = 'applied' | 'skipped' | 'conflict' | 'retry' | 'unchanged';

/**
 * Deep equality of two payload objects, independent of key order.
 *
 * Used only for the documents the provider re-lists inside its clock-skew window: comparing the
 * payloads is what proves that a re-listed document carries nothing new.
 */
function samePayload(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  return stableJson(a) === stableJson(b);
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'null';
  }
  if (Array.isArray(value)) {
    return '[' + value.map((item) => stableJson(item)).join(',') + ']';
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, item]) => JSON.stringify(key) + ':' + stableJson(item));
  return '{' + entries.join(',') + '}';
}

/**
 * Forgets the cloud version a local record was based on, so the next upload may replace the cloud
 * copy unconditionally (the local revision was proved to be newer than the cloud one).
 */
async function releaseCompareAndSwapBase(
  entityType: EntityType,
  entityId: string,
): Promise<void> {
  if (entityType !== EntityType.MealEntry) {
    return;
  }
  const meal = await getMealById(entityId);
  if (meal !== null && meal.cloudRevision !== null) {
    await upsertMeal({ ...meal, cloudRevision: null });
  }
}

/** True when the journal still holds an unconfirmed change for this record. */
async function hasPendingLocalChanges(
  entityType: EntityType,
  entityId: string,
): Promise<boolean> {
  const account = await getActiveAccount();
  if (account === null) {
    return false;
  }
  const pending = await getPendingOperations(account.id);
  return pending.some((op) => op.entityType === entityType && op.entityId === entityId);
}

/** Stores both versions in ConflictRecord (spec 7.7 - never auto-merged). */
async function recordConflict(
  header: {
    entityType: EntityType;
    entityId: string;
    updatedAt: string;
    revision: number;
    deviceId: string;
  },
  localPayload: Record<string, unknown>,
  remotePayload: Record<string, unknown>,
): Promise<void> {
  const revision = String(header.revision);
  if (await hasOpenConflict(header.entityType, header.entityId, revision)) {
    // The same remote revision is already waiting for the user: do not stack
    // duplicate conflict rows on every cycle.
    return;
  }
  await insertConflict({
    id: newGuid(),
    entityType: header.entityType,
    entityId: header.entityId,
    localPayload: JSON.stringify(localPayload, null, 2),
    remotePayload: JSON.stringify(remotePayload, null, 2),
    localModifiedAt: new Date().toISOString(),
    remoteModifiedAt: header.updatedAt,
    remoteRevision: revision,
    deviceId: header.deviceId,
    detectedAt: new Date().toISOString(),
    isResolved: 0,
  });
}

/** Removes the local row behind a tombstone document. */
async function removeLocalEntity(entityType: EntityType, entityId: string): Promise<void> {
  switch (entityType) {
    case EntityType.MealEntry:
      // The card itself never disappears: loadDay re-materializes an empty
      // placeholder for the permanent slot (spec 7.6).
      await deleteMeal(entityId);
      break;
    case EntityType.MealPhoto: {
      const photo = await getPhotoById(entityId);
      await deletePhoto(entityId);
      if (photo !== null) {
        for (const path of [originalPath(photo.localFileId), thumbnailPath(photo.thumbnailId)]) {
          try {
            if (await RNFS.exists(path)) {
              await RNFS.unlink(path);
            }
          } catch {
            // best effort - missing files are fine
          }
        }
      }
      break;
    }
    case EntityType.MealTemplate:
      await deleteTemplate(entityId);
      break;
    case EntityType.ReminderSettings:
      await deleteReminder(entityId);
      break;
    default:
      // Preferences/profile/categories are never removed by tombstones in
      // practice; the upsert path overwrites them instead.
      break;
  }
}

/** The receiving device's profile + category ids (see identityMapping.ts). */
async function loadLocalIdentity(): Promise<LocalIdentity | null> {
  const profile = await getActiveProfile();
  if (profile === null) {
    return null;
  }
  const categories = await getCategories();
  if (categories.length === 0) {
    return null;
  }
  return localIdentity(profile.id, categories);
}

/**
 * Writes a remote payload into the local row, marked Synced.
 *
 * Remote documents carry the ids of the device that produced them, so every
 * reference is mapped onto this installation's rows before the write. Anything
 * that cannot be written yet (a photograph whose meal has not arrived) returns
 * 'retry' so the cursor stays before the document and the next cycle finishes
 * the job instead of silently dropping it.
 */
async function writeRemoteEntity(
  entityType: EntityType,
  entityId: string,
  payload: Record<string, unknown>,
  revision: number,
  cloudRevisionToken: string | null,
): Promise<ApplyOutcome> {
  // The compare-and-swap base is the provider's revision of the object; the envelope revision is the
  // sender's local counter and cannot prove which cloud version this row is based on.
  const cloudRevision = cloudRevisionToken ?? String(revision);
  const identity = await loadLocalIdentity();
  if (identity === null && entityType !== EntityType.UserProfile) {
    return 'retry';
  }

  switch (entityType) {
    case EntityType.MealEntry: {
      const mapped = remapMealEntryPayload(payload, identity as LocalIdentity);
      const entry: MealEntry = {
        ...mealEntryFromPayload(mapped),
        id: entityId,
        syncStatus: SyncStatus.Synced,
        cloudRevision,
      };
      const current = await getMealById(entityId);
      if (current !== null) {
        await upsertMeal(entry);
        return 'applied';
      }
      const slotOccupant = await getMealBySlot(
        entry.localProfileId,
        entry.date,
        entry.mealCategoryKey,
      );
      if (slotOccupant === null) {
        await upsertMeal(entry);
        return 'applied';
      }
      // The same slot exists under an id this device generated. An untouched
      // placeholder is replaced by the cloud identity (its photographs follow it
      // through the foreign key remap); a row with real content keeps both
      // versions in ConflictRecord.
      if (!hasMealUserContent(entry)) {
        // The incoming record is only an empty placeholder: it cannot displace
        // anything, so it is not worth a conflict row.
        return 'skipped';
      }
      if (hasMealUserContent(slotOccupant)) {
        await recordConflict(
          {
            entityType,
            entityId,
            updatedAt: String(payload.updatedAt ?? ''),
            revision,
            deviceId: '',
          },
          encodePayload(EntityType.MealEntry, slotOccupant),
          payload,
        );
        return 'conflict';
      }
      await adoptRemoteMealEntry(entry, slotOccupant.id);
      return 'applied';
    }
    case EntityType.MealPhoto: {
      const raw = mealPhotoFromPayload(payload);
      // Foreign key first: a photograph is only accepted once its meal slot is
      // local, otherwise the insert is rejected and the picture is lost.
      const meal = await getMealById(raw.mealEntryId);
      if (meal === null) {
        return 'retry';
      }
      const photo = mealPhotoFromPayload(remapPhotoPayload(payload, meal.id));
      await upsertPhotoRow({
        ...photo,
        id: entityId,
        syncStatus: SyncStatus.Synced,
        cloudRevision,
      });
      const bytesPresent = await downloadPhotoBytesIfMissing(
        entityId,
        photo.localFileId,
        photo.thumbnailId,
      );
      return bytesPresent ? 'applied' : 'retry';
    }
    case EntityType.MealTemplate: {
      const template = mealTemplateFromPayload(remapTemplatePayload(payload, identity as LocalIdentity));
      await upsertTemplate({ ...template, id: entityId, syncStatus: SyncStatus.Synced });
      return 'applied';
    }
    case EntityType.ReminderSettings: {
      const reminder = reminderFromPayload(remapReminderPayload(payload, identity as LocalIdentity));
      await upsertReminder({ ...reminder, id: entityId, syncStatus: SyncStatus.Synced });
      return 'applied';
    }
    case EntityType.AppPreferences: {
      const remote = preferencesFromPayload(remapPreferencesPayload(payload, identity as LocalIdentity));
      const local = await getPreferences(remote.localProfileId);
      if (local === null) {
        await upsertPreferences({ ...remote, syncStatus: SyncStatus.Synced });
      } else {
        // Only the shared settings travel; the synchronization switch, the
        // schedule and the onboarding state stay with this installation.
        await upsertPreferences(mergeSharedPreferences(local, remote));
      }
      return 'applied';
    }
    case EntityType.MealCategory: {
      // Matched by the permanent FixedCategoryKey; the local id is preserved so
      // existing meals and reminders keep their foreign key.
      await upsertCategory({ ...categoryFromPayload(payload), id: entityId });
      return 'applied';
    }
    case EntityType.UserProfile: {
      const remote = profileFromPayload(payload);
      const local = await getActiveProfile();
      if (local === null) {
        await upsertProfile({
          ...remote,
          id: entityId,
          syncStatus: SyncStatus.Synced,
          cloudRevision,
        });
        return 'applied';
      }
      if (
        local.providerUserId !== '' &&
        remote.providerUserId !== '' &&
        local.providerUserId !== remote.providerUserId
      ) {
        // A profile document of a different provider identity never replaces
        // the signed-in profile (one account owns this cache).
        return 'skipped';
      }
      await upsertProfile({ ...mergeProfileFromRemote(local, remote), cloudRevision });
      return 'applied';
    }
    default:
      return 'skipped';
  }
}

/** True when the logical path belongs to the Diet Tracker dataset (spec 7.4). */
function isManagedPath(path: string): boolean {
  return path.startsWith('entities/') || path.startsWith('photos/') || path === 'manifest.json';
}

function maxIso(a: string, b: string): string {
  if (a === '') {
    return b;
  }
  if (b === '') {
    return a;
  }
  return Date.parse(a) >= Date.parse(b) ? a : b;
}

/** Best-effort download of a photograph binary (idempotent). True when the bytes exist. */
async function downloadPhotoBytesIfMissing(
  photoId: string,
  localFileId: string,
  thumbnailId: string,
): Promise<boolean> {
  try {
    const path = originalPath(localFileId);
    if (!(await RNFS.exists(path))) {
      const base64 = await downloadObjectBase64(photoBinaryPath(photoId));
      if (base64 === null) {
        return false;
      }
      const dir = photosParent();
      if (!(await RNFS.exists(dir))) {
        await RNFS.mkdir(dir);
      }
      await RNFS.writeFile(path, base64, 'base64');
    }
    // The sender's thumbnail bytes are not synchronized; the preview is rebuilt locally.
    await ensureThumbnail(localFileId, thumbnailId);
    return true;
  } catch (error) {
    // Never swallowed into "done": the caller keeps the cursor behind the
    // document so the picture is fetched again on the next cycle.
    console.warn('[sync] photo binary download failed', photoId, error);
    return false;
  }
}

function photosParent(): string {
  const fullPath = originalPath('');
  return fullPath.endsWith('/') ? fullPath.slice(0, -1) : fullPath;
}

/** Tallies of one pull phase. */
interface PullResult {
  downloaded: number;
  failed: number;
  conflicts: number;
  skipped: number;
  /** Documents that were listed again but already match the local copy (clock-skew window). */
  unchanged: number;
  /** New modified-time watermark; never past a document that still has to be retried. */
  watermark: string;
}

/**
 * Pull phase: everything changed since the stored watermark (minus the 5 s
 * skew), newest first.
 *
 * Meal documents are applied before photograph documents, because a photograph
 * can only be stored once its meal slot exists (foreign key). A document that
 * cannot be applied yet - missing bytes, missing parent, provider error - does
 * NOT advance the watermark: the cursor is clamped to the oldest such document
 * so the next cycle retries it. That is what makes previously skipped records
 * recoverable instead of silently lost.
 */
async function pullChanges(
  accountId: string,
  options: { acceptOwnDevice: boolean },
  epoch: number,
): Promise<PullResult> {
  const metadata = await getMetadata(accountId);
  const since = metadata?.lastSyncCursor ?? null;
  const changes = await listChanges(since);

  let downloaded = 0;
  let failed = 0;
  let conflicts = 0;
  let skipped = 0;
  let unchanged = 0;
  let watermark = since ?? '';
  let retryFrom: string | null = null;

  const markRetry = (modifiedAt: string): void => {
    retryFrom = retryFrom === null ? modifiedAt : minIso(retryFrom, modifiedAt);
  };

  const managed = changes.filter((change) => isManagedPath(change.path));

  for (const change of managed) {
    if (change.path === 'manifest.json' || change.path.startsWith('photos/')) {
      // Binaries are fetched together with their metadata document.
      watermark = maxIso(watermark, change.modifiedAt);
    }
  }

  const entityDocuments = managed.filter((change) => change.path.startsWith('entities/'));
  const photos = entityDocuments.filter((change) => isPhotoDocument(change.path));
  const others = entityDocuments.filter((change) => !isPhotoDocument(change.path));

  for (const change of [...others, ...photos]) {
    if (cycleIsStale(epoch)) {
      // The session ended while the listing was in flight (sign-out): stop
      // before the first write - the cache it would touch no longer exists.
      return { downloaded, failed, conflicts, skipped, unchanged, watermark };
    }
    try {
      const json = await downloadObject(change.path, change.id);
      if (json === null) {
        // Listed a moment ago but the object is gone (deleted by another device
        // between listing and download) or its bytes are unreadable: retry, and
        // never move the cursor past it silently.
        failed += 1;
        markRetry(change.modifiedAt);
        continue;
      }
      const outcome = await applyRemoteDocument(json, options, change.revision);
      if (outcome === 'retry') {
        failed += 1;
        markRetry(change.modifiedAt);
        continue;
      }
      if (outcome === 'conflict') {
        conflicts += 1;
      } else if (outcome === 'unchanged') {
        // Listed again inside the clock-skew window: the same version this device already holds.
        unchanged += 1;
      } else if (outcome === 'skipped') {
        skipped += 1;
      } else {
        downloaded += 1;
      }
      watermark = maxIso(watermark, change.modifiedAt);
    } catch (error) {
      if (error instanceof AuthError) {
        throw error;
      }
      console.warn('[sync] document could not be applied', change.path, error);
      failed += 1;
      markRetry(change.modifiedAt);
    }
  }

  if (retryFrom !== null) {
    // One second before the oldest document that still has to be retried, so the
    // next change listing includes it again.
    const clamped = isoBefore(retryFrom);
    watermark = watermark === '' ? clamped : minIso(watermark, clamped);
  }

  return { downloaded, failed, conflicts, skipped, unchanged, watermark };
}

function isPhotoDocument(path: string): boolean {
  return path.startsWith('entities/MealPhoto/');
}

function minIso(a: string, b: string): string {
  if (a === '') {
    return b;
  }
  if (b === '') {
    return a;
  }
  return Date.parse(a) <= Date.parse(b) ? a : b;
}

function isoBefore(iso: string): string {
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) {
    return iso;
  }
  return new Date(parsed - 1000).toISOString();
}

export interface RunCycleOptions {
  trigger: SyncTrigger;
  /**
   * Rebuild/restore variants apply THIS installation's own documents too
   * (spec: a rebuilt cache must accept its own uploads).
   */
  acceptOwnDevice?: boolean;
  /**
   * Downloads without uploading. Used by the foreground poll: a local edit has
   * its own cycle, and a pull at the same moment would only duplicate the push
   * it is about to run.
   */
  pullOnly?: boolean;
  /**
   * Uploads without downloading. Used by the account boundaries (sign in / sign
   * out), which only need the outbox emptied before the session changes: a full
   * listing + pull of the other device's documents is seconds of waiting the
   * user cannot see the result of, and the regular triggers keep the local copy
   * current anyway.
   */
  pushOnly?: boolean;
  /**
   * Called once with 0/total and then after every document the outbox settles,
   * so the sign-out barrier can paint a real 0-100 % bar instead of a spinner.
   */
  onUploadProgress?: (uploaded: number, total: number) => void;
  /**
   * Ignores the exponential-backoff window of a failed operation. The sign-out
   * barrier cannot wait a minute for the next retry: the user asked for the
   * upload now and the whole screen is already blocked behind the progress bar.
   */
  ignoreBackoff?: boolean;
}

/**
 * Records the reason of a request that arrived during a running cycle. A
 * passive download never downgrades a request that carries real work: an edit
 * that landed together with the poll is uploaded, not skipped because the tick
 * happened to be the later caller.
 */
function rememberPendingTrigger(trigger: SyncTrigger): void {
  if (trigger === SyncTrigger.AutoPull && pendingTrigger !== null && pendingTrigger !== SyncTrigger.AutoPull) {
    return;
  }
  pendingTrigger = trigger;
}

/**
 * Runs one full cycle (push -> pull -> watermark). Serialized: a second call
 * while one is running awaits the same promise, and its trigger is remembered
 * so a change committed while the journal was already read gets its own pass.
 */
export function runCycle(options: RunCycleOptions): Promise<CycleResult> {
  if (runningCycle !== null) {
    rememberPendingTrigger(options.trigger);
    return runningCycle;
  }

  const current = executeCycle(options).then(
    (result) => {
      runningCycle = null;
      followUp();
      return result;
    },
    (error: unknown) => {
      runningCycle = null;
      followUp();
      throw error;
    },
  );
  runningCycle = current;
  return current;
}

/** Starts the remembered pass, if any, without blocking the caller. */
function followUp(): void {
  const trigger = pendingTrigger;
  pendingTrigger = null;
  if (trigger === null) {
    return;
  }
  setTimeout(() => {
    void runCycle({ trigger });
  }, 0);
}

/** A cycle result with nothing done (no account, paused, offline, failure). */
export function emptyCycleResult(error?: string): CycleResult {
  return { uploaded: 0, downloaded: 0, failed: 0, conflicts: 0, skipped: 0, error };
}

/**
 * Tells any cycle still in flight that its session is over (sign-out). The
 * engine abandons its work at the next document instead of writing the previous
 * account's records into the guest database the purge just created.
 */
export function invalidateRunningCycle(): void {
  sessionEpoch += 1;
}

/** True once the session that started a cycle has ended. */
function cycleIsStale(epoch: number): boolean {
  return epoch !== sessionEpoch;
}

async function executeCycle(options: RunCycleOptions): Promise<CycleResult> {
  const epoch = sessionEpoch;
  const account = await getActiveAccount();
  if (account === null) {
    emitState(SyncState.NotConfigured);
    return emptyCycleResult();
  }
  if (account.synchronizationEnabled === 0) {
    emitState(SyncState.Paused);
    return emptyCycleResult();
  }

  // The passive download of an open app is not part of the schedule: it exists
  // so the other device's changes appear within a minute instead of within a
  // week. "Only with the button below" is still respected - the user asked for
  // no automatic cloud traffic at all - and the throttle keeps the poll from
  // turning into a request storm.
  const pushOnly = options.pushOnly === true;
  const pullOnly =
    !pushOnly && (options.pullOnly === true || options.trigger === SyncTrigger.AutoPull);

  if (pullOnly) {
    const profile = await getActiveProfile();
    const prefs = profile === null ? null : await getPreferences(profile.id);
    if (!isPassivePullAllowed(prefs?.syncFrequency ?? SyncFrequency.Weekly)) {
      return emptyCycleResult('sync.manual-only');
    }
    const now = Date.now();
    if (now - lastAutoPullAt < AUTO_PULL_MIN_INTERVAL_MS) {
      return emptyCycleResult();
    }
    lastAutoPullAt = now;
  }

  if (!(await checkOnline())) {
    emitState(SyncState.Offline);
    return emptyCycleResult('Auth_sync_offline');
  }

  // A passive pull that changes nothing keeps the state it had: blinking "Synchronizing" and a
  // status strip that pushes the whole day down every few seconds would report work the user did
  // not start (and move the buttons under a finger that is about to tap one).
  if (!pullOnly) {
    emitState(SyncState.Syncing);
  }
  try {
    const uploaded = pullOnly
      ? 0
      : await pushPending(
          epoch,
          options.onUploadProgress,
          options.ignoreBackoff === true,
        );
    // A push-only pass stops when the outbox is empty: no listing, no downloads,
    // no watermark. The account boundaries (sign in / sign out) use it and would
    // otherwise wait for a full pull nobody asked for.
    const pull: PullResult = pushOnly
      ? { downloaded: 0, failed: 0, conflicts: 0, skipped: 0, unchanged: 0, watermark: '' }
      : await pullChanges(
          account.id,
          {
            acceptOwnDevice: options.acceptOwnDevice ?? false,
          },
          epoch,
        );

    if (cycleIsStale(epoch)) {
      // The session ended under us (sign-out): report what happened, but never
      // write the metadata of an account that no longer exists.
      return {
        uploaded,
        downloaded: pull.downloaded,
        failed: pull.failed,
        conflicts: pull.conflicts,
        skipped: pull.skipped,
      };
    }

    const now = new Date().toISOString();
    if (!pushOnly) {
      const metadata = (await getMetadata(account.id)) ?? {
        cloudAccountId: account.id,
        providerType: account.providerType,
        lastSyncCursor: null,
        lastSyncTimestamp: null,
        schemaVersion: CLOUD_SCHEMA_VERSION,
        deviceId: await getDeviceId(),
        manifestRevision: null,
        lastFullUploadAt: null,
      };
      await upsertMetadata({
        ...metadata,
        lastSyncCursor: pull.watermark === '' ? metadata.lastSyncCursor : pull.watermark,
        lastSyncTimestamp: now,
      });
      await upsertAccount({ ...account, lastSynchronizedAt: now });
    }

    const stillPending = (await countPendingOperations(account.id)) > 0;
    const retryable = pull.failed > 0 || pull.conflicts > 0 || stillPending;
    if (!retryable && !pushOnly) {
      // "Last successful synchronization" is only claimed when every listed
      // document was handled: a skipped download used to look like success. A
      // push-only pass is not a synchronization and never claims it.
      lastSuccessfulSync = now;
    }

    // A cycle that materialized records of the other device tells the visible
    // screen to reload, so a card never keeps a stale snapshot that a later
    // save would write back over the imported version.
    if (pull.downloaded > 0) {
      for (const listener of dataListeners) {
        try {
          listener(pull.downloaded);
        } catch (listenerError) {
          console.warn('[sync] data-change listener failed', listenerError);
        }
      }
    }

    // A passive pull that found nothing keeps the state it had; one that brought records publishes
    // the result, which is also what refreshes the visible day. A push-only pass always publishes
    // (the Settings card was left on "Synchronizing" by the emit above).
    if (pushOnly || !pullOnly || retryable || pull.downloaded > 0) {
      emitState(retryable ? SyncState.PendingChanges : SyncState.Synced);
    }

    return {
      uploaded,
      downloaded: pull.downloaded,
      failed: pull.failed,
      conflicts: pull.conflicts,
      skipped: pull.skipped,
    };
  } catch (error) {
    const message = error instanceof AuthError ? error.code : String(error);
    if (error instanceof AuthError) {
      // Never delete local records because of an auth failure (spec 7.1.2).
      emitState(SyncState.AuthenticationRequired);
    } else if (!(await checkOnline())) {
      emitState(SyncState.Offline);
    } else {
      emitState(SyncState.Error);
    }
    return emptyCycleResult(message);
  }
}

// --- triggers ---------------------------------------------------------------

/**
 * Distance between two automatic downloads of a foregrounded app. The poll
 * asks more often than this; the extra calls collapse into "not due" before any
 * request leaves, so an idle app costs one small change-feed call per interval
 * and a backgrounded one costs none.
 */
const AUTO_PULL_INTERVAL_MS = 20 * 1000;
/** Minimum distance the engine accepts between two passive downloads. */
const AUTO_PULL_MIN_INTERVAL_MS = 10 * 1000;

let debounceHandle: ReturnType<typeof setTimeout> | null = null;
let periodicHandle: ReturnType<typeof setInterval> | null = null;
let autoPullHandle: ReturnType<typeof setInterval> | null = null;
let triggersStarted = false;
let appIsActive = true;

/**
 * Asks for a silent download of the other devices' changes. Throttled by the
 * engine, so calling it from a focus event and from the poll is cheap.
 */
export function requestPull(): void {
  if (!triggersStarted) {
    return;
  }
  void runCycle({ trigger: SyncTrigger.AutoPull });
}

/**
 * Tells the engine whether the app is in the foreground. A backgrounded app
 * stops polling, so a phone left on a desk does not spend battery on requests
 * nobody is waiting for.
 */
export function setAppActive(active: boolean): void {
  const wasActive = appIsActive;
  appIsActive = active;
  if (active && !wasActive) {
    // Coming back to the app is the moment the user expects the other device's
    // changes, so it pulls immediately instead of waiting for the next tick.
    requestPull();
  }
}

/**
 * Starts the automatic triggers (startup, debounced local changes, foreground
 * poll, hourly periodic knock, connectivity restore). Called once from App
 * bootstrap.
 */
export function startSyncTriggers(): void {
  if (triggersStarted) {
    return;
  }
  triggersStarted = true;
  void refreshStateAsync().then(() => runCycle({ trigger: SyncTrigger.Startup }));
  onConnectivityRestored(() => {
    void runCycle({ trigger: SyncTrigger.ConnectivityRestored });
  });
  autoPullHandle = setInterval(() => {
    if (appIsActive) {
      requestPull();
    }
  }, AUTO_PULL_INTERVAL_MS);
  periodicHandle = setInterval(() => {
    void (async () => {
      const account = await getActiveAccount();
      if (account === null || account.synchronizationEnabled === 0) {
        return;
      }
      const last = account.lastSynchronizedAt;
      const age = last === null ? null : Date.now() - Date.parse(last);
      const profile = await getActiveProfile();
      const prefs = profile === null ? null : await getPreferences(profile.id);
      if (isDue(prefs?.syncFrequency ?? 1, age)) {
        void runCycle({ trigger: SyncTrigger.Periodic });
      }
    })();
  }, 60 * 60 * 1000); // the scheduler knocks once an hour
}

/** Stops timers (tests, account transitions). */
export function stopSyncTriggers(): void {
  triggersStarted = false;
  if (periodicHandle !== null) {
    clearInterval(periodicHandle);
    periodicHandle = null;
  }
  if (autoPullHandle !== null) {
    clearInterval(autoPullHandle);
    autoPullHandle = null;
  }
  if (debounceHandle !== null) {
    clearTimeout(debounceHandle);
    debounceHandle = null;
  }
}

/**
 * Called after every journaled local change: debounces 3 s, then runs a
 * silent background cycle (spec 7.2).
 */
export function notifyLocalChange(): void {
  if (!triggersStarted) {
    return;
  }
  if (debounceHandle !== null) {
    clearTimeout(debounceHandle);
  }
  debounceHandle = setTimeout(() => {
    debounceHandle = null;
    void runCycle({ trigger: SyncTrigger.LocalChange });
  }, 3000);
}

/**
 * Drops background work that has been requested but not started yet (the 3 s
 * debounce of a local edit, a pass remembered during a running cycle).
 *
 * The account boundaries use it: while the sign-out bar is draining the outbox,
 * a queued cycle would only start a second listing and a full download of an
 * account that is about to be removed.
 */
export function cancelScheduledCycle(): void {
  if (debounceHandle !== null) {
    clearTimeout(debounceHandle);
    debounceHandle = null;
  }
  pendingTrigger = null;
}

// --- special operations -----------------------------------------------------

/**
 * Queues EVERY local record for upload (first sign-in adoption of guest
 * records, post-provider-switch - spec 7.6 PushAllAsync).
 */
export async function pushAllLocalRecords(): Promise<number> {
  const account = await getActiveAccount();
  const profile = await getActiveProfile();
  if (account === null || profile === null) {
    return 0;
  }
  const { journalEntity } = await import('./journal');
  const now = new Date().toISOString();
  let queued = 0;

  const range = await import('../data/repositories');
  const meals = await range.getMealsInRange(profile.id, '0001-01-01', '9999-12-31');
  for (const meal of meals) {
    await journalEntity(account.id, EntityType.MealEntry, meal.id, meal.updatedAt);
    queued += 1;
  }
  const photos = await range.getAllPhotos();
  for (const photo of photos) {
    await journalEntity(account.id, EntityType.MealPhoto, photo.id, photo.updatedAt);
    queued += 1;
  }
  const templates = await range.getTemplates();
  for (const template of templates) {
    await journalEntity(account.id, EntityType.MealTemplate, template.id, template.updatedAt);
    queued += 1;
  }
  const reminders = await range.getReminders(profile.id);
  for (const reminder of reminders) {
    await journalEntity(account.id, EntityType.ReminderSettings, reminder.id, reminder.updatedAt);
    queued += 1;
  }
  const categories = await range.getCategories();
  for (const category of categories) {
    await journalEntity(account.id, EntityType.MealCategory, category.id, now);
    queued += 1;
  }
  const prefs = await range.getPreferences(profile.id);
  if (prefs !== null) {
    await journalEntity(account.id, EntityType.AppPreferences, profile.id, prefs.updatedAt);
    queued += 1;
  }
  await journalEntity(account.id, EntityType.UserProfile, profile.id, profile.updatedAt);
  queued += 1;
  return queued;
}

/** Counts reported by the restore preview (spec: PreviewRestoreAsync). */
export interface CloudPreview {
  meals: number;
  templates: number;
  reminders: number;
  photos: number;
  from: string | null;
  to: string | null;
}

/**
 * Lists what the connected account holds WITHOUT downloading the records
 * (reads only manifest.json + a light index of the entity names).
 */
export async function previewRestoreFromCloud(): Promise<CloudPreview> {
  const objects = await listObjects();
  const preview: CloudPreview = {
    meals: 0,
    templates: 0,
    reminders: 0,
    photos: 0,
    from: null,
    to: null,
  };
  for (const object of objects) {
    if (object.path.startsWith('entities/MealEntry/')) {
      preview.meals += 1;
    } else if (object.path.startsWith('entities/MealTemplate/')) {
      preview.templates += 1;
    } else if (object.path.startsWith('entities/ReminderSettings/')) {
      preview.reminders += 1;
    } else if (object.path.startsWith('photos/') && object.path.endsWith('.bin')) {
      preview.photos += 1;
    } else if (object.path.startsWith('entities/MealEntry/')) {
      preview.meals += 1;
    }
  }
  // Date range comes from the manifest when the Windows app wrote one.
  const manifestJson = await downloadObject('manifest.json');
  if (manifestJson !== null) {
    try {
      const manifest = JSON.parse(manifestJson) as { from?: string; to?: string };
      preview.from = manifest.from ?? null;
      preview.to = manifest.to ?? null;
    } catch {
      // a corrupt manifest never breaks the preview
    }
  }
  return preview;
}

/**
 * Merges the whole cloud dataset into the cache (never deletes anything by
 * itself, so a failed restore is harmless). Applies EVERY document including
 * this installation's own uploads (restore semantics, spec 7.6).
 *
 * This is also the deliberate replay for records an earlier build skipped: it
 * ignores the cursor, and documents that still cannot be applied are retried on
 * the next restore / cycle instead of being forgotten.
 */
export async function restoreFromCloud(): Promise<{
  downloaded: number;
  failed: number;
  conflicts: number;
}> {
  const account = await getActiveAccount();
  if (account === null) {
    return { downloaded: 0, failed: 0, conflicts: 0 };
  }
  // A restore ignores the watermark: clear it so everything is re-examined.
  const metadata = await getMetadata(account.id);
  if (metadata !== null) {
    await upsertMetadata({ ...metadata, lastSyncCursor: null });
  }
  emitState(SyncState.Syncing);
  try {
    const pull = await pullChanges(account.id, { acceptOwnDevice: true }, sessionEpoch);
    const now = new Date().toISOString();
    const fresh = (await getMetadata(account.id)) ?? metadata;
    if (fresh !== null) {
      await upsertMetadata({ ...fresh, lastSyncCursor: pull.watermark, lastSyncTimestamp: now });
    }
    const retryable = pull.failed > 0 || pull.conflicts > 0;
    emitState(retryable ? SyncState.PendingChanges : SyncState.Synced);
    return { downloaded: pull.downloaded, failed: pull.failed, conflicts: pull.conflicts };
  } catch (error) {
    emitState(error instanceof AuthError ? SyncState.AuthenticationRequired : SyncState.Error);
    throw error;
  }
}

/**
 * Cloud-only lifecycle rebuild: the cache is empty at this point, so every
 * document - including this installation's own uploads - is applied. An
 * interrupted rebuild is repaired by the next cycle.
 */
export async function rebuildFromCloud(): Promise<{ downloaded: number }> {
  const result = await restoreFromCloud();
  return { downloaded: result.downloaded };
}