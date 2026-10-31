// Entity payload (de)serializers for the cloud envelope and .dtbackup backup -
// parity with System.Text.Json on Windows: camelCase names, nulls omitted,
// enums as strings, dates 'yyyy-MM-dd', times 'HH:mm:ss', instants ISO-8601.

import {
  EntityType,
  MealCategoryKey,
  ProviderType,
  SyncFrequency,
  SyncStatus,
} from './enums';
import {
  AppPreferences,
  MealCategory,
  MealEntry,
  MealPhoto,
  MealTemplate,
  ReminderSettings,
  UserProfile,
} from './models';
import { mealStatusFromString, mealStatusToString } from './json';

export type EntityPayload =
  | MealEntry
  | MealPhoto
  | MealTemplate
  | ReminderSettings
  | AppPreferences
  | MealCategory
  | UserProfile;

/** camelCase name of an enum member, e.g. MealCategoryKey.Breakfast -> 'Breakfast'. */
function enumString<T extends number>(value: T, names: Record<string, number>): string {
  for (const [name, v] of Object.entries(names)) {
    if (v === value) {
      return name;
    }
  }
  return String(value);
}

function readEnum<T extends number>(value: unknown, names: Record<string, number>, fallback: T): T {
  if (typeof value === 'number') {
    return value as T;
  }
  if (typeof value === 'string') {
    const lower = value.toLowerCase();
    for (const [name, v] of Object.entries(names)) {
      if (name.toLowerCase() === lower) {
        return v as T;
      }
    }
  }
  return fallback;
}

const MEAL_CATEGORY_KEY_NAMES: Record<string, number> = {
  Breakfast: 1,
  MorningSnack: 2,
  Lunch: 3,
  AfternoonSnack: 4,
  Dinner: 5,
};
const SYNC_STATUS_NAMES: Record<string, number> = {
  PendingUpload: 0,
  Synced: 1,
  PendingUpdate: 2,
  PendingDelete: 3,
  Failed: 4,
  Conflict: 5,
};
const PROVIDER_TYPE_NAMES: Record<string, number> = { None: 0, Microsoft: 1, Google: 2 };
const SYNC_FREQUENCY_NAMES: Record<string, number> = { Manual: 0, Weekly: 1, Monthly: 2 };

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function strOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function num(value: unknown, fallback = 0): number {
  if (typeof value === 'number') {
    return value;
  }
  if (typeof value === 'string' && value.trim() !== '' && !Number.isNaN(Number(value))) {
    return Number(value);
  }
  return fallback;
}

function bool(value: unknown): boolean {
  return value === true || value === 1 || value === '1' || value === 'true';
}

/** MealEntry -> cloud/backup payload (nulls omitted, enums as strings). */
export function mealEntryToPayload(entry: MealEntry): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    id: entry.id,
    localProfileId: entry.localProfileId,
    date: entry.date,
    mealCategoryId: entry.mealCategoryId,
    mealCategoryKey: enumString(entry.mealCategoryKey, MEAL_CATEGORY_KEY_NAMES),
    title: entry.title,
    ingredients: entry.ingredients,
    status: mealStatusToString(entry.status),
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
    revision: entry.revision,
    syncStatus: enumString(entry.syncStatus, SYNC_STATUS_NAMES),
  };
  if (entry.plannedTime !== null) {
    payload.plannedTime = entry.plannedTime;
  }
  if (entry.completedAt !== null) {
    payload.completedAt = entry.completedAt;
  }
  if (entry.cloudRevision !== null) {
    payload.cloudRevision = entry.cloudRevision;
  }
  if (entry.contentHash !== null) {
    payload.contentHash = entry.contentHash;
  }
  return payload;
}

export function mealEntryFromPayload(raw: unknown): MealEntry {
  const obj = (raw ?? {}) as Record<string, unknown>;
  return {
    id: str(obj.id),
    localProfileId: str(obj.localProfileId),
    date: str(obj.date),
    mealCategoryId: str(obj.mealCategoryId),
    mealCategoryKey: readEnum(obj.mealCategoryKey, MEAL_CATEGORY_KEY_NAMES, MealCategoryKey.Breakfast),
    title: str(obj.title),
    ingredients: str(obj.ingredients),
    plannedTime: strOrNull(obj.plannedTime),
    status: mealStatusFromString(obj.status),
    completedAt: strOrNull(obj.completedAt),
    createdAt: str(obj.createdAt),
    updatedAt: str(obj.updatedAt),
    revision: num(obj.revision),
    syncStatus: readEnum(obj.syncStatus, SYNC_STATUS_NAMES, SyncStatus.PendingUpload),
    cloudRevision: strOrNull(obj.cloudRevision),
    contentHash: strOrNull(obj.contentHash),
  };
}

/** MealPhoto -> payload. */
export function mealPhotoToPayload(photo: MealPhoto): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    id: photo.id,
    mealEntryId: photo.mealEntryId,
    originalFileName: photo.originalFileName,
    localFileId: photo.localFileId,
    thumbnailId: photo.thumbnailId,
    mimeType: photo.mimeType,
    fileSize: photo.fileSize,
    contentHash: photo.contentHash,
    createdAt: photo.createdAt,
    updatedAt: photo.updatedAt,
    syncStatus: enumString(photo.syncStatus, SYNC_STATUS_NAMES),
  };
  if (photo.cloudObjectId !== null) {
    payload.cloudObjectId = photo.cloudObjectId;
  }
  if (photo.cloudRevision !== null) {
    payload.cloudRevision = photo.cloudRevision;
  }
  return payload;
}

export function mealPhotoFromPayload(raw: unknown): MealPhoto {
  const obj = (raw ?? {}) as Record<string, unknown>;
  return {
    id: str(obj.id),
    mealEntryId: str(obj.mealEntryId),
    originalFileName: str(obj.originalFileName),
    localFileId: str(obj.localFileId),
    thumbnailId: str(obj.thumbnailId),
    mimeType: str(obj.mimeType) || 'image/jpeg',
    fileSize: num(obj.fileSize),
    contentHash: str(obj.contentHash),
    cloudObjectId: strOrNull(obj.cloudObjectId),
    cloudRevision: strOrNull(obj.cloudRevision),
    createdAt: str(obj.createdAt),
    updatedAt: str(obj.updatedAt),
    syncStatus: readEnum(obj.syncStatus, SYNC_STATUS_NAMES, SyncStatus.PendingUpload),
  };
}
/** MealTemplate -> payload (mirrors the C# model, including its TemplateData string). */
export function mealTemplateToPayload(template: MealTemplate): Record<string, unknown> {
  const templateData = JSON.stringify({
    single: template.isFullDay ? null : template.templateMeal,
    day: template.templateDay,
  });
  const payload: Record<string, unknown> = {
    id: template.id,
    localProfileId: template.localProfileId,
    name: template.name,
    isFullDay: template.isFullDay,
    templateData,
    templateDay: template.templateDay,
    createdAt: template.createdAt,
    updatedAt: template.updatedAt,
    syncStatus: enumString(template.syncStatus, SYNC_STATUS_NAMES),
  };
  if (template.recurrenceRules !== null) {
    payload.recurrenceRules = template.recurrenceRules;
  }
  if (template.templateMealSlot !== null) {
    payload.templateMealSlot = enumString(template.templateMealSlot, MEAL_CATEGORY_KEY_NAMES);
  }
  if (template.templateMeal !== null) {
    payload.templateMeal = template.templateMeal;
  }
  return payload;
}

export function mealTemplateFromPayload(raw: unknown): MealTemplate {
  const obj = (raw ?? {}) as Record<string, unknown>;
  // TemplateData ({single, day}) is the authoritative column on Windows; fall
  // back to the first-class properties when only those are present.
  let single: unknown = null;
  let day: unknown[] = [];
  if (typeof obj.templateData === 'string' && obj.templateData.trim() !== '') {
    try {
      const parsed = JSON.parse(obj.templateData) as Record<string, unknown>;
      single = parsed.single ?? null;
      day = Array.isArray(parsed.day) ? parsed.day : [];
    } catch {
      // corrupt template column - fall through to the first-class properties
    }
  }
  if (single === null && obj.templateMeal) {
    single = obj.templateMeal;
  }
  if (day.length === 0 && Array.isArray(obj.templateDay)) {
    day = obj.templateDay;
  }
  const isFullDay = bool(obj.isFullDay);
  const slot =
    single !== null && (single as Record<string, unknown>).mealCategoryKey !== undefined
      ? readEnum(
          (single as Record<string, unknown>).mealCategoryKey,
          MEAL_CATEGORY_KEY_NAMES,
          MealCategoryKey.Breakfast,
        )
      : obj.templateMealSlot !== undefined
        ? readEnum(obj.templateMealSlot, MEAL_CATEGORY_KEY_NAMES, MealCategoryKey.Breakfast)
        : null;
  return {
    id: str(obj.id),
    localProfileId: str(obj.localProfileId),
    name: str(obj.name),
    isFullDay,
    templateMealSlot: isFullDay ? null : slot,
    templateMeal: isFullDay ? null : (single as MealTemplate['templateMeal']),
    templateDay: day as MealTemplate['templateDay'],
    recurrenceRules: strOrNull(obj.recurrenceRules),
    createdAt: str(obj.createdAt),
    updatedAt: str(obj.updatedAt),
    syncStatus: readEnum(obj.syncStatus, SYNC_STATUS_NAMES, SyncStatus.PendingUpload),
  };
}
/** ReminderSettings -> payload. */
export function reminderToPayload(r: ReminderSettings): Record<string, unknown> {
  return {
    id: r.id,
    localProfileId: r.localProfileId,
    mealCategoryId: r.mealCategoryId,
    mealCategoryKey: enumString(r.mealCategoryKey, MEAL_CATEGORY_KEY_NAMES),
    enabled: r.enabled,
    time: r.time,
    weekdays: r.weekdays,
    snoozeMinutes: r.snoozeMinutes ?? null,
    updatedAt: r.updatedAt,
    syncStatus: enumString(r.syncStatus, SYNC_STATUS_NAMES),
  };
}

export function reminderFromPayload(raw: unknown): ReminderSettings {
  const obj = (raw ?? {}) as Record<string, unknown>;
  return {
    id: str(obj.id),
    localProfileId: str(obj.localProfileId),
    mealCategoryId: str(obj.mealCategoryId),
    mealCategoryKey: readEnum(obj.mealCategoryKey, MEAL_CATEGORY_KEY_NAMES, MealCategoryKey.Breakfast),
    enabled: bool(obj.enabled),
    time: str(obj.time),
    weekdays: num(obj.weekdays, 127),
    snoozeMinutes: obj.snoozeMinutes === null || obj.snoozeMinutes === undefined ? null : num(obj.snoozeMinutes, 10),
    updatedAt: str(obj.updatedAt),
    syncStatus: readEnum(obj.syncStatus, SYNC_STATUS_NAMES, SyncStatus.PendingUpload),
  };
}

/** AppPreferences -> payload. */
export function preferencesToPayload(p: AppPreferences): Record<string, unknown> {
  return {
    localProfileId: p.localProfileId,
    timeZone: p.timeZone,
    showSnackCards: p.showSnackCards,
    startWithWindows: p.startWithWindows,
    minimizeToTray: p.minimizeToTray,
    remindersEnabled: p.remindersEnabled,
    use12HourClock: p.use12HourClock,
    synchronizationEnabled: p.synchronizationEnabled,
    syncFrequency: enumString(p.syncFrequency, SYNC_FREQUENCY_NAMES),
    preferredProvider: enumString(p.preferredProvider, PROVIDER_TYPE_NAMES),
    cloudUploadConsentGranted: p.cloudUploadConsentGranted,
    onboardingCompleted: p.onboardingCompleted,
    updatedAt: p.updatedAt,
    syncStatus: enumString(p.syncStatus, SYNC_STATUS_NAMES),
  };
}

export function preferencesFromPayload(raw: unknown): AppPreferences {
  const obj = (raw ?? {}) as Record<string, unknown>;
  return {
    localProfileId: str(obj.localProfileId),
    timeZone: str(obj.timeZone),
    showSnackCards: obj.showSnackCards === undefined ? true : bool(obj.showSnackCards),
    startWithWindows: bool(obj.startWithWindows),
    minimizeToTray: bool(obj.minimizeToTray),
    remindersEnabled: obj.remindersEnabled === undefined ? true : bool(obj.remindersEnabled),
    use12HourClock: bool(obj.use12HourClock),
    synchronizationEnabled: bool(obj.synchronizationEnabled),
    syncFrequency: readEnum(obj.syncFrequency, SYNC_FREQUENCY_NAMES, SyncFrequency.Weekly),
    preferredProvider: readEnum(obj.preferredProvider, PROVIDER_TYPE_NAMES, ProviderType.None),
    cloudUploadConsentGranted: bool(obj.cloudUploadConsentGranted),
    onboardingCompleted: bool(obj.onboardingCompleted),
    updatedAt: str(obj.updatedAt),
    syncStatus: readEnum(obj.syncStatus, SYNC_STATUS_NAMES, SyncStatus.PendingUpload),
  };
}
/** MealCategory -> payload. */
export function categoryToPayload(c: MealCategory): Record<string, unknown> {
  return {
    id: c.id,
    fixedCategoryKey: enumString(c.fixedCategoryKey, MEAL_CATEGORY_KEY_NAMES),
    name: c.name,
    color: c.color,
    icon: c.icon,
    defaultTime: c.defaultTime,
    displayOrder: c.displayOrder,
  };
}

export function categoryFromPayload(raw: unknown): MealCategory {
  const obj = (raw ?? {}) as Record<string, unknown>;
  return {
    id: str(obj.id),
    fixedCategoryKey: readEnum(obj.fixedCategoryKey, MEAL_CATEGORY_KEY_NAMES, MealCategoryKey.Breakfast),
    name: str(obj.name),
    color: str(obj.color) || '#FF107C10',
    icon: str(obj.icon),
    defaultTime: str(obj.defaultTime) || '00:00:00',
    displayOrder: num(obj.displayOrder),
  };
}

/** UserProfile -> payload. */
export function profileToPayload(p: UserProfile): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    id: p.id,
    providerType: enumString(p.providerType, PROVIDER_TYPE_NAMES),
    providerUserId: p.providerUserId,
    displayName: p.displayName,
    email: p.email,
    timeZone: p.timeZone,
    isActive: p.isActive,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    syncStatus: enumString(p.syncStatus, SYNC_STATUS_NAMES),
  };
  if (p.cloudRevision !== null) {
    payload.cloudRevision = p.cloudRevision;
  }
  return payload;
}

export function profileFromPayload(raw: unknown): UserProfile {
  const obj = (raw ?? {}) as Record<string, unknown>;
  return {
    id: str(obj.id),
    providerType: readEnum(obj.providerType, PROVIDER_TYPE_NAMES, ProviderType.None),
    providerUserId: str(obj.providerUserId),
    displayName: str(obj.displayName),
    email: str(obj.email),
    timeZone: str(obj.timeZone),
    isActive: num(obj.isActive),
    createdAt: str(obj.createdAt),
    updatedAt: str(obj.updatedAt),
    syncStatus: readEnum(obj.syncStatus, SYNC_STATUS_NAMES, SyncStatus.PendingUpload),
    cloudRevision: strOrNull(obj.cloudRevision),
  };
}

/** Encodes an entity payload for the given entity type (cloud + backup). */
export function encodePayload(entityType: EntityType, entity: EntityPayload): Record<string, unknown> {
  switch (entityType) {
    case EntityType.MealEntry:
      return mealEntryToPayload(entity as MealEntry);
    case EntityType.MealPhoto:
      return mealPhotoToPayload(entity as MealPhoto);
    case EntityType.MealTemplate:
      return mealTemplateToPayload(entity as MealTemplate);
    case EntityType.ReminderSettings:
      return reminderToPayload(entity as ReminderSettings);
    case EntityType.AppPreferences:
      return preferencesToPayload(entity as AppPreferences);
    case EntityType.MealCategory:
      return categoryToPayload(entity as MealCategory);
    case EntityType.UserProfile:
      return profileToPayload(entity as UserProfile);
    default:
      return { ...(entity as unknown as Record<string, unknown>) };
  }
}

/** Decodes a payload object back into the entity for the given entity type. */
export function decodePayload(entityType: EntityType, raw: unknown): EntityPayload {
  switch (entityType) {
    case EntityType.MealEntry:
      return mealEntryFromPayload(raw);
    case EntityType.MealPhoto:
      return mealPhotoFromPayload(raw);
    case EntityType.MealTemplate:
      return mealTemplateFromPayload(raw);
    case EntityType.ReminderSettings:
      return reminderFromPayload(raw);
    case EntityType.AppPreferences:
      return preferencesFromPayload(raw);
    case EntityType.MealCategory:
      return categoryFromPayload(raw);
    case EntityType.UserProfile:
      return profileFromPayload(raw);
    default:
      return raw as EntityPayload;
  }
}