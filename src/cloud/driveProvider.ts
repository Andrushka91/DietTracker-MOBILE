// Google Drive storage provider - port of GoogleDriveStorageProvider (spec 7.4).
//
// Addressing: logical paths are encoded as FLAT file names in the hidden
// appDataFolder ("/" <-> "__"), exactly like Windows, so both platforms
// address the same dataset:
//
//   entities/MealEntry/<guid>.json  ->  entities__MealEntry__<guid>.json
//   photos/<guid>.bin               ->  photos__<guid>.bin
//   manifest.json                   ->  manifest.json
//
// Concurrency token = file "version"; change tracking = modified-time
// watermark (objects may be examined twice - every apply is idempotent).
// The app never sees the user's other Drive files (drive.appdata scope).

import { AuthError, getValidAccessToken } from './auth';

export const NAME_SEPARATOR = '__';
const UPLOAD_BASE = 'https://www.googleapis.com/upload/drive/v3/files';
const FILES_BASE = 'https://www.googleapis.com/drive/v3/files';
const ABOUT_BASE = 'https://www.googleapis.com/drive/v3/about';

/** Encodes a logical path as a flat Google Drive file name. */
export function toDriveName(logicalPath: string): string {
  return logicalPath.replace(/\//g, NAME_SEPARATOR);
}

/** Decodes a flat Google Drive file name back into the logical path. */
export function toLogicalPath(driveName: string): string {
  return driveName.split(NAME_SEPARATOR).join('/');
}

/** Provider object descriptor (revision = file "version"). */
export interface DriveObject {
  /** Logical path (our addressing). */
  path: string;
  id: string;
  revision: string | null;
  modifiedAt: string;
  sizeBytes: number;
  /** md5Checksum - content hash as computed by Drive. */
  hash: string | null;
}

export interface QuotaInfo {
  totalBytes: number | null;
  remainingBytes: number | null;
}

const FILE_FIELDS = 'id,name,version,modifiedTime,size,md5Checksum';

interface RawFile {
  id: string;
  name: string;
  version?: string;
  modifiedTime?: string;
  size?: string;
  md5Checksum?: string;
}

function toObject(file: RawFile): DriveObject {
  return {
    path: toLogicalPath(file.name),
    id: file.id,
    revision: file.version ?? null,
    modifiedAt: file.modifiedTime ?? new Date().toISOString(),
    sizeBytes: file.size !== undefined ? Number(file.size) : 0,
    hash: file.md5Checksum ?? null,
  };
}

// --- logical path -> Drive file id -------------------------------------------
//
// Google Drive has no path addressing: the opaque file `id` is the only thing
// /files/{id} accepts. Windows keeps the same index in memory
// (GoogleDriveStorageProvider.RefreshIndexAsync); this is its mobile twin.
// The index is rebuilt by every listing and refreshed once when a lookup
// misses, so an object another device created after the last listing is still
// found instead of being reported as absent.

let objectIndex: Map<string, DriveObject> | null = null;

/** Test hook: forgets the cached path -> id index. */
export function resetObjectIndex(): void {
  objectIndex = null;
}

function indexObjects(objects: DriveObject[]): void {
  const next = new Map<string, DriveObject>();
  for (const object of objects) {
    const existing = next.get(object.path);
    if (existing === undefined) {
      next.set(object.path, object);
      continue;
    }
    // Two uploads raced and produced the same flat name. The newest content wins the
    // index; the older object is left in Drive untouched (nothing is deleted behind
    // the user's back) and the situation is logged.
    console.warn('[drive] duplicate dataset object; keeping the newest', object.path);
    if (Date.parse(object.modifiedAt) >= Date.parse(existing.modifiedAt)) {
      next.set(object.path, object);
    }
  }
  objectIndex = next;
}

/**
 * Resolves a logical path to the Drive file id used by /files/{id}.
 * `knownId` (the id of a listed object) always wins. Returns null only when the
 * object genuinely does not exist - provider failures throw.
 */
export async function resolveObjectId(
  logicalPath: string,
  knownId?: string | null,
): Promise<string | null> {
  if (knownId !== undefined && knownId !== null && knownId !== '') {
    return knownId;
  }
  const cached = objectIndex?.get(logicalPath);
  if (cached !== undefined) {
    return cached.id;
  }
  // Possibly a stale index: the object may have been created since the last listing.
  await listObjects();
  return objectIndex?.get(logicalPath)?.id ?? null;
}

function isNotFound(error: unknown): boolean {
  return String(error).includes('drive.http.404');
}

async function authHeader(): Promise<Record<string, string>> {
  const accessToken = await getValidAccessToken();
  return { Authorization: `Bearer ${accessToken}` };
}

async function request(url: string, init: RequestInit = {}): Promise<Response> {
  const headers = { ...(await authHeader()), ...(init.headers as Record<string, string>) };
  const response = await fetch(url, { ...init, headers });
  if (response.status === 401) {
    // Expired/revoked grant -> the sync engine surfaces AuthenticationRequired.
    throw new AuthError('Auth_google_unauthorized');
  }
  if (response.status === 403) {
    throw new AuthError('Auth_google_insufficient_permissions');
  }
  if (!response.ok) {
    throw new Error(`drive.http.${response.status}`);
  }
  return response;
}

/**
 * Lists every object of the dataset in appDataFolder (paged, 1000 per call).
 * This is the file index Windows keeps in memory (RefreshIndexAsync).
 */
export async function listObjects(): Promise<DriveObject[]> {
  const results: DriveObject[] = [];
  let pageToken: string | null = null;
  do {
    let url = `${FILES_BASE}?spaces=appDataFolder&pageSize=1000&fields=nextPageToken,files(${FILE_FIELDS})`;
    if (pageToken !== null) {
      url += `&pageToken=${encodeURIComponent(pageToken)}`;
    }
    const response = await request(url);
    const body = (await response.json()) as { files?: RawFile[]; nextPageToken?: string };
    for (const file of body.files ?? []) {
      results.push(toObject(file));
    }
    pageToken = body.nextPageToken ?? null;
  } while (pageToken !== null && pageToken !== '');
  indexObjects(results);
  return results;
}

/**
 * Objects modified after the stored watermark (minus a skew window),
 * newest first. The watermark lives in SyncMetadata (LastSyncCursor).
 */
export async function listChanges(sinceIso: string | null): Promise<DriveObject[]> {
  const all = await listObjects();
  if (sinceIso === null || sinceIso === '') {
    return all;
  }
  const sinceMs = Date.parse(sinceIso);
  if (Number.isNaN(sinceMs)) {
    return all;
  }
  // 5 s skew so clock differences never skip a write (spec 7.5).
  const window = sinceMs - 5000;
  return all
    .filter((object) => Date.parse(object.modifiedAt) > window)
    .sort((a, b) => (a.modifiedAt < b.modifiedAt ? 1 : -1));
}

/** Uploads (create or update) one object; returns the new revision token. */
export async function uploadObject(
  logicalPath: string,
  content: string | Uint8Array,
  contentType: string,
  existingId: string | null,
): Promise<DriveObject> {
  const driveName = toDriveName(logicalPath);
  const metadata: Record<string, unknown> = { name: driveName };
  if (existingId === null) {
    metadata.parents = ['appDataFolder'];
  }
  const boundary = `diettracker-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const metaJson = JSON.stringify(metadata);
  const contentBytes = typeof content === 'string' ? utf8Bytes(content) : content;

  const head = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metaJson}\r\n--${boundary}\r\nContent-Type: ${contentType}\r\n\r\n`;
  const tail = `\r\n--${boundary}--`;
  const body = concat(utf8Bytes(head), contentBytes, utf8Bytes(tail));

  const endpoint =
    existingId === null
      ? `${UPLOAD_BASE}?uploadType=multipart&fields=${FILE_FIELDS}`
      : `${UPLOAD_BASE}/${existingId}?uploadType=multipart&fields=${FILE_FIELDS}`;
  const method = existingId === null ? 'POST' : 'PATCH';

  const response = await request(endpoint, {
    method,
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body: body as unknown as BodyInit_,
  });
  const file = (await response.json()) as RawFile;
  return toObject(file);
}

/**
 * Downloads one object's text content (JSON documents). Null only when the
 * object genuinely does not exist; a provider failure is thrown so the caller
 * never mistakes an error for "nothing there".
 */
export async function downloadObject(
  logicalPath: string,
  knownId?: string | null,
): Promise<string | null> {
  const bytes = await downloadBytes(logicalPath, knownId);
  return bytes === null ? null : utf8Decode(bytes);
}

/** Downloads one object's raw bytes as base64 (photograph binaries). */
export async function downloadObjectBase64(
  logicalPath: string,
  knownId?: string | null,
): Promise<string | null> {
  const bytes = await downloadBytes(logicalPath, knownId);
  return bytes === null ? null : arrayBufferToBase64(bytes);
}

/**
 * Fetches the content of one logical object by its Drive file id.
 * A 404 means the object vanished between the listing and the download (or the
 * index was stale): the index is rebuilt once and the download retried with the
 * fresh id. Only a second miss is reported as "absent".
 */
async function downloadBytes(
  logicalPath: string,
  knownId?: string | null,
): Promise<ArrayBuffer | null> {
  const id = await resolveObjectId(logicalPath, knownId);
  if (id === null) {
    return null;
  }
  try {
    const response = await request(`${FILES_BASE}/${encodeURIComponent(id)}?alt=media`);
    return await response.arrayBuffer();
  } catch (error) {
    if (!isNotFound(error)) {
      throw error;
    }
  }

  objectIndex?.delete(logicalPath);
  const retryId = await resolveObjectId(logicalPath);
  if (retryId === null || retryId === id) {
    objectIndex?.delete(logicalPath);
    return null;
  }
  try {
    const retry = await request(`${FILES_BASE}/${encodeURIComponent(retryId)}?alt=media`);
    return await retry.arrayBuffer();
  } catch (error) {
    if (isNotFound(error)) {
      objectIndex?.delete(logicalPath);
      return null;
    }
    throw error;
  }
}

/** Deletes one object (tombstone propagation); a missing file is a no-op. */
export async function deleteObject(logicalPath: string, knownId?: string | null): Promise<void> {
  const id = await resolveObjectId(logicalPath, knownId);
  if (id === null) {
    objectIndex?.delete(logicalPath);
    return;
  }
  try {
    await request(`${FILES_BASE}/${encodeURIComponent(id)}`, { method: 'DELETE' });
  } catch (error) {
    if (!isNotFound(error)) {
      throw error;
    }
  } finally {
    objectIndex?.delete(logicalPath);
  }
}

/** Storage quota for the account card (about?fields=storageQuota). */
export async function getQuota(): Promise<QuotaInfo> {
  const response = await request(`${ABOUT_BASE}?fields=storageQuota`);
  const body = (await response.json()) as { storageQuota?: { limit?: string; usage?: string } };
  const limit = body.storageQuota?.limit;
  const usage = body.storageQuota?.usage;
  const total = limit !== undefined ? Number(limit) : null;
  const used = usage !== undefined ? Number(usage) : 0;
  return {
    totalBytes: total !== null && Number.isFinite(total) ? total : null,
    remainingBytes: total !== null && Number.isFinite(total) ? Math.max(total - used, 0) : null,
  };
}

// --- helpers ----------------------------------------------------------------

/**
 * Encodes text as UTF-8. The previous implementation assigned UTF-16 code units
 * into a byte array, which silently truncated every character outside ASCII
 * (Romanian diacritics, emoji icons) and produced unreadable JSON.
 */
export function utf8Bytes(value: string): Uint8Array {
  const encoder = textEncoder();
  if (encoder !== null) {
    return encoder.encode(value);
  }
  return utf8EncodeManually(value);
}

/** Decodes UTF-8 bytes (a leading BOM from a Windows-written file is dropped). */
export function utf8Decode(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const decoder = textDecoder();
  const text =
    decoder !== null
      ? decoder.decode(bytes)
      : utf8DecodeManually(bytes);
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

interface Utf8EncoderLike {
  encode(value: string): Uint8Array;
}

interface Utf8DecoderLike {
  decode(bytes: Uint8Array): string;
}

function textEncoder(): Utf8EncoderLike | null {
  const globalObject = globalThis as unknown as { TextEncoder?: new () => Utf8EncoderLike };
  return typeof globalObject.TextEncoder === 'function' ? new globalObject.TextEncoder() : null;
}

function textDecoder(): Utf8DecoderLike | null {
  const globalObject = globalThis as unknown as { TextDecoder?: new () => Utf8DecoderLike };
  return typeof globalObject.TextDecoder === 'function' ? new globalObject.TextDecoder() : null;
}

/** Pure JavaScript UTF-8 encoder for runtimes without TextEncoder (old Hermes). */
function utf8EncodeManually(value: string): Uint8Array {
  const bytes: number[] = [];
  for (let i = 0; i < value.length; i += 1) {
    let codePoint = value.charCodeAt(i);
    // Surrogate pair -> single code point.
    if (codePoint >= 0xd800 && codePoint <= 0xdbff && i + 1 < value.length) {
      const low = value.charCodeAt(i + 1);
      if (low >= 0xdc00 && low <= 0xdfff) {
        codePoint = 0x10000 + ((codePoint - 0xd800) << 10) + (low - 0xdc00);
        i += 1;
      }
    }
    if (codePoint < 0x80) {
      bytes.push(codePoint);
    } else if (codePoint < 0x800) {
      bytes.push(0xc0 | (codePoint >> 6), 0x80 | (codePoint & 0x3f));
    } else if (codePoint < 0x10000) {
      bytes.push(
        0xe0 | (codePoint >> 12),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
    } else {
      bytes.push(
        0xf0 | (codePoint >> 18),
        0x80 | ((codePoint >> 12) & 0x3f),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
    }
  }
  return Uint8Array.from(bytes);
}

/** Pure JavaScript UTF-8 decoder for runtimes without TextDecoder (old Hermes). */
function utf8DecodeManually(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; ) {
    const first = bytes[i];
    let codePoint: number;
    let width: number;
    if (first < 0x80) {
      codePoint = first;
      width = 1;
    } else if ((first & 0xe0) === 0xc0) {
      codePoint = first & 0x1f;
      width = 2;
    } else if ((first & 0xf0) === 0xe0) {
      codePoint = first & 0x0f;
      width = 3;
    } else {
      codePoint = first & 0x07;
      width = 4;
    }
    if (i + width > bytes.length) {
      break;
    }
    for (let k = 1; k < width; k += 1) {
      codePoint = (codePoint << 6) | (bytes[i + k] & 0x3f);
    }
    i += width;
    if (codePoint > 0x10ffff) {
      out += '\uFFFD';
    } else if (codePoint > 0xffff) {
      const adjusted = codePoint - 0x10000;
      out += String.fromCharCode(0xd800 + (adjusted >> 10), 0xdc00 + (adjusted & 0x3ff));
    } else {
      out += String.fromCharCode(codePoint);
    }
  }
  return out;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    merged.set(part, offset);
    offset += part.length;
  }
  return merged;
}

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Bytes -> base64 without btoa/Buffer (works in Hermes + Jest). */
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : undefined;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : undefined;
    out += BASE64_ALPHABET[b0 >> 2];
    out += BASE64_ALPHABET[((b0 & 0x03) << 4) | ((b1 ?? 0) >> 4)];
    out += b1 === undefined ? '=' : BASE64_ALPHABET[((b1 & 0x0f) << 2) | ((b2 ?? 0) >> 6)];
    out += b2 === undefined ? '=' : BASE64_ALPHABET[b2 & 0x3f];
  }
  return out;
}