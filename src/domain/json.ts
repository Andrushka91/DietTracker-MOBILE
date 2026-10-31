// Port of DietTracker.Core.Serialization.DietTrackerJson - the JSON contract
// shared with Windows for cloud payloads, backups and template columns.
//
//  - property names: camelCase
//  - nulls omitted (WhenWritingNull)
//  - enums: string names (JsonStringEnumConverter) with MealStatus having a
//    tolerant reader ("Pending"/"Done"/"Missed", legacy integers accepted)
//  - dates: 'yyyy-MM-dd'; times: 'HH:mm:ss'; instants: ISO-8601 with offset
//  - numbers written as strings are accepted when reading (NumberHandling)

import { EntityType, MealStatus, ProviderType, SyncStatus } from './enums';
import { CloudEnvelope, EnvelopeHeader } from './models';

/** Writes a MealStatus as the word (parity with MealStatusJsonConverter). */
export function mealStatusToString(status: MealStatus): string {
  switch (status) {
    case MealStatus.Done:
      return 'Done';
    case MealStatus.Missed:
      return 'Missed';
    default:
      return 'Pending';
  }
}

/** Tolerant reader: words, legacy integers, unknown builds -> Pending. */
export function mealStatusFromString(value: unknown): MealStatus {
  if (typeof value === 'number') {
    if (value === 1) {
      return MealStatus.Done;
    }
    if (value === 2) {
      return MealStatus.Missed;
    }
    return MealStatus.Pending;
  }
  if (typeof value === 'string') {
    if (value.toLowerCase() === 'done') {
      return MealStatus.Done;
    }
    if (value.toLowerCase() === 'missed') {
      return MealStatus.Missed;
    }
  }
  return MealStatus.Pending;
}

/** Enum -> its string name (JSON string enum converter parity). */
function enumName<T extends Record<string, string | number>>(value: T[keyof T], names: T): string {
  const entry = Object.entries(names).find(([, v]) => v === value);
  return entry ? entry[0] : String(value);
}

export function entityTypeName(value: EntityType): string {
  const names: Record<string, EntityType> = {
    UserProfile: EntityType.UserProfile,
    MealEntry: EntityType.MealEntry,
    MealPhoto: EntityType.MealPhoto,
    MealTemplate: EntityType.MealTemplate,
    ReminderSettings: EntityType.ReminderSettings,
    AppPreferences: EntityType.AppPreferences,
    MealCategory: EntityType.MealCategory,
  };
  return enumName(value, names);
}

/** Reads entityType accepting both number and name (spec 7.4). */
export function entityTypeFromJson(value: unknown): EntityType {
  if (typeof value === 'number' && Number.isInteger(value)) {
    return value as EntityType;
  }
  if (typeof value === 'string') {
    const direct: Record<string, EntityType> = {
      UserProfile: EntityType.UserProfile,
      MealEntry: EntityType.MealEntry,
      MealPhoto: EntityType.MealPhoto,
      MealTemplate: EntityType.MealTemplate,
      ReminderSettings: EntityType.ReminderSettings,
      AppPreferences: EntityType.AppPreferences,
      MealCategory: EntityType.MealCategory,
    };
    const lower = value.toLowerCase();
    for (const [name, enumValue] of Object.entries(direct)) {
      if (name.toLowerCase() === lower) {
        return enumValue;
      }
    }
  }
  // Unknown values fall back the same way the Windows header reader does.
  return EntityType.MealEntry;
}

export function syncStatusName(value: SyncStatus): string {
  const names: Record<string, SyncStatus> = {
    PendingUpload: SyncStatus.PendingUpload,
    Synced: SyncStatus.Synced,
    PendingUpdate: SyncStatus.PendingUpdate,
    PendingDelete: SyncStatus.PendingDelete,
    Failed: SyncStatus.Failed,
    Conflict: SyncStatus.Conflict,
  };
  return enumName(value, names);
}

export function providerTypeName(value: ProviderType): string {
  const names: Record<string, ProviderType> = {
    None: ProviderType.None,
    Google: ProviderType.Google,
  };
  return enumName(value, names);
}

/**
 * Serializes a cloud envelope: header fields camelCase, entityType as its
 * string name, payload already encoded by domain/payloads.encodePayload.
 * Indented output matches DietTrackerJson.Indented (readable, diff friendly).
 */
export function serializeEnvelope<T extends Record<string, unknown>>(
  envelope: CloudEnvelope<T>,
): string {
  const doc: Record<string, unknown> = {
    schemaVersion: envelope.schemaVersion,
    entityType: entityTypeName(envelope.entityType),
    entityId: envelope.entityId,
    localProfileId: envelope.localProfileId,
    revision: envelope.revision,
    updatedAt: envelope.updatedAt,
    deviceId: envelope.deviceId,
    isDeleted: envelope.isDeleted,
    contentHash: envelope.contentHash,
  };
  if (envelope.payload !== null) {
    doc.payload = envelope.payload;
  }
  return JSON.stringify(doc, null, 2);
}

/**
 * Reads the envelope header without fully deserializing the payload.
 * Returns null for corrupt JSON or an unparseable entityId - never throws
 * (spec 7.4: corrupt JSON is ignored, documents with a higher schema than
 * understood are skipped by the caller).
 */
export function readEnvelopeHeader(json: string): EnvelopeHeader | null {
  if (json.trim() === '') {
    return null;
  }
  try {
    const root = JSON.parse(json) as Record<string, unknown>;
    const entityId = root.entityId;
    if (typeof entityId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(entityId)) {
      return null;
    }
    return {
      schemaVersion: typeof root.schemaVersion === 'number' ? root.schemaVersion : 1,
      entityType: entityTypeFromJson(root.entityType),
      entityId,
      revision: typeof root.revision === 'number' ? root.revision : numFrom(root.revision),
      updatedAt: typeof root.updatedAt === 'string' ? root.updatedAt : '',
      deviceId: typeof root.deviceId === 'string' ? root.deviceId : '',
      isDeleted: root.isDeleted === true,
      contentHash: typeof root.contentHash === 'string' ? root.contentHash : '',
    };
  } catch {
    return null;
  }
}

/** Full envelope parse (header + payload object). Null when corrupt. */
export function parseEnvelope(json: string): CloudEnvelope<Record<string, unknown>> | null {
  const header = readEnvelopeHeader(json);
  if (header === null) {
    return null;
  }
  try {
    const root = JSON.parse(json) as Record<string, unknown>;
    return {
      schemaVersion: header.schemaVersion,
      entityType: header.entityType,
      entityId: header.entityId,
      localProfileId: typeof root.localProfileId === 'string' ? root.localProfileId : '',
      revision: header.revision,
      updatedAt: header.updatedAt,
      deviceId: header.deviceId,
      isDeleted: header.isDeleted,
      contentHash: header.contentHash,
      payload:
        root.payload !== undefined && root.payload !== null
          ? (root.payload as Record<string, unknown>)
          : null,
    };
  } catch {
    return null;
  }
}

function numFrom(value: unknown): number {
  if (typeof value === 'number') {
    return value;
  }
  if (typeof value === 'string' && value.trim() !== '' && !Number.isNaN(Number(value))) {
    return Number(value);
  }
  return 0;
}