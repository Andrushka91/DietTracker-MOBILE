// Photo store - only metadata lives in SQLite; the bytes are files inside
// the app-private sandbox (spec 4.6):
//
//   photos/<LocalFileId>     original bytes, never in SQLite
//   photos/<ThumbnailId>     thumbnails (256 px, JPEG q80)
//
// Every add runs the same pipeline as Windows: extension -> size -> magic
// byte sniffing -> SHA-256 duplicate check per meal -> copy original ->
// generate thumbnail -> insert row + journal (spec 5.6 / 8.4).

import { ImageManipulator, manipulateAsync, SaveFormat } from 'expo-image-manipulator';

import RNFS from '../platform/fs';

import { EntityType, MealPhoto, SyncStatus } from '../domain';
import { journalEntity } from '../cloud/journal';
import { sha256OfBase64 } from '../domain/hashing';
import { newGuid } from '../domain/rules/mealSlotRules';
import {
  MAX_PHOTOS_PER_MEAL,
  THUMBNAIL_QUALITY,
  THUMBNAIL_SIZE,
} from '../domain/rules/photoRules';
import { validatePhoto, validatePhotoDuplicate, validatePhotoSlot } from '../domain/validation';
import { dataRoot } from './database';
import { deletePhoto, getPhotosForMeal, insertPhoto, photoExistsWithHash } from './repositories';

export function photosDir(): string {
  return `${dataRoot()}/photos`;
}

/** Absolute path of a stored original. */
export function originalPath(localFileId: string): string {
  return `${photosDir()}/${localFileId}`;
}

/** Absolute path of a stored thumbnail. */
export function thumbnailPath(thumbnailId: string): string {
  return `${photosDir()}/${thumbnailId}`;
}

/**
 * Generates the 256 px thumbnail of an already stored original (best effort).
 * Used for photographs downloaded from another device, whose metadata carries
 * the sender's thumbnail name but whose bytes are not synchronized.
 */
export async function ensureThumbnail(originalFileId: string, thumbnailId: string): Promise<void> {
  try {
    const target = thumbnailPath(thumbnailId);
    if (await RNFS.exists(target)) {
      return;
    }
    const source = originalPath(originalFileId);
    if (!(await RNFS.exists(source))) {
      return;
    }
    const probe = await ImageManipulator.manipulate(source).renderAsync();
    const scale = Math.min(THUMBNAIL_SIZE / probe.width, THUMBNAIL_SIZE / probe.height, 1);
    const resized = await manipulateAsync(
      source,
      [
        {
          resize: {
            width: Math.max(1, Math.round(probe.width * scale)),
            height: Math.max(1, Math.round(probe.height * scale)),
          },
        },
      ],
      { compress: THUMBNAIL_QUALITY / 100, format: SaveFormat.JPEG },
    );
    await RNFS.copyFile(resized.uri.replace(/^file:\/\//, ''), target);
  } catch (error) {
    // A missing thumbnail only costs the preview; the original stays usable.
    console.warn('[photos] thumbnail generation failed', thumbnailId, error);
  }
}

/** 'file://' URI for <Image> sources. */
export function fileUri(fileName: string): string {
  return `file://${originalPath(fileName)}`;
}

export function thumbnailUri(thumbnailId: string): string {
  return `file://${thumbnailPath(thumbnailId)}`;
}

export interface AddPhotoResult {
  ok: boolean;
  photo?: MealPhoto;
  /** Stable validation code (photo.*, shown localized on the card). */
  code?: string;
}

/**
 * Validates + stores one picked image for a meal, then journals the change.
 * 'sourceUri' is what expo-image-picker returned (file:// URI).
 */
export async function addPhotoToMeal(
  mealEntryId: string,
  sourceUri: string,
  originalFileName: string,
  accountId: string | null,
): Promise<AddPhotoResult> {
  const current = await getPhotosForMeal(mealEntryId);

  const slot = validatePhotoSlot(current.length, MAX_PHOTOS_PER_MEAL);
  if (!slot.isValid) {
    return { ok: false, code: slot.failures[0].code };
  }

  const plainPath = sourceUri.replace(/^file:\/\//, '');
  if (!(await RNFS.exists(plainPath))) {
    return { ok: false, code: 'photo.source.missing' };
  }

  const stat = await RNFS.stat(plainPath);
  const sizeBytes = Number(stat.size);
  const base64 = await RNFS.readFile(sourceUri, 'base64');
  const header = base64ToBytes(base64.slice(0, 64));

  const shape = validatePhoto(originalFileName, sizeBytes, header);
  if (!shape.isValid) {
    return { ok: false, code: shape.failures[0].code };
  }

  const contentHash = sha256OfBase64(base64);
  if (!validatePhotoDuplicate(await photoExistsWithHash(mealEntryId, contentHash)).isValid) {
    return { ok: false, code: 'photo.duplicate' };
  }

  const localFileId = `${newGuid()}.bin`;
  const thumbnailId = `${newGuid()}.jpg`;
  await RNFS.copyFile(sourceUri, originalPath(localFileId));

  // Thumbnails: 256 px max edge, JPEG q80 (spec 4.6/8.4). A resize failure
  // keeps the photo usable - the gallery falls back to the original file.
  try {
    // Probe the decoded dimensions first so the resize can fit INSIDE the
    // 256x256 box while keeping the aspect ratio (expo's resize with both
    // dimensions would stretch to an exact square).
    const probe = await ImageManipulator.manipulate(originalPath(localFileId)).renderAsync();
    const scale = Math.min(THUMBNAIL_SIZE / probe.width, THUMBNAIL_SIZE / probe.height, 1);
    const resized = await manipulateAsync(
      originalPath(localFileId),
      [
        {
          resize: {
            width: Math.max(1, Math.round(probe.width * scale)),
            height: Math.max(1, Math.round(probe.height * scale)),
          },
        },
      ],
      { compress: THUMBNAIL_QUALITY / 100, format: SaveFormat.JPEG },
    );
    await RNFS.copyFile(resized.uri.replace(/^file:\/\//, ''), thumbnailPath(thumbnailId));
  } catch (error) {
    console.warn('[photos] thumbnail generation failed', error);
  }

  const now = new Date().toISOString();
  const photo: MealPhoto = {
    id: newGuid(),
    mealEntryId,
    originalFileName,
    localFileId,
    thumbnailId,
    mimeType: mimeTypeOf(originalFileName),
    fileSize: sizeBytes,
    contentHash,
    cloudObjectId: null,
    cloudRevision: null,
    createdAt: now,
    updatedAt: now,
    syncStatus: SyncStatus.PendingUpload,
  };
  await insertPhoto(photo);

  // The bytes live outside SQLite: the journal references the metadata
  // document; the sync engine uploads the binary separately (spec 7.4).
  // Journaling never breaks the user's edit: a failure is reported and the
  // photograph stays local, where the next full reconciliation picks it up.
  if (accountId !== null) {
    try {
      await journalEntity(accountId, EntityType.MealPhoto, photo.id, photo.updatedAt);
    } catch (error) {
      console.warn('[photos] the photograph could not be queued for upload', error);
    }
  }
  return { ok: true, photo };
}

/** Removes a photograph: row + both files (UI confirms first, spec 8.4). */
export async function removePhoto(photo: MealPhoto): Promise<void> {
  await deletePhoto(photo.id);
  for (const path of [originalPath(photo.localFileId), thumbnailPath(photo.thumbnailId)]) {
    try {
      if (await RNFS.exists(path)) {
        await RNFS.unlink(path);
      }
    } catch (error) {
      console.warn('[photos] file removal failed', error);
    }
  }
}

/** Deletes every stored photo file (sign-out purge / account transition). */
export async function removeAllPhotoFiles(): Promise<void> {
  try {
    if (await RNFS.exists(photosDir())) {
      await RNFS.unlink(photosDir());
      await RNFS.mkdir(photosDir());
    }
  } catch (error) {
    console.warn('[photos] store purge failed', error);
  }
}

function mimeTypeOf(fileName: string): string {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.png')) {
    return 'image/png';
  }
  if (lower.endsWith('.webp')) {
    return 'image/webp';
  }
  return 'image/jpeg';
}

/** Base64 -> bytes without depending on atob/Buffer (Hermes + tests). */
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