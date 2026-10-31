// Port of DietTracker.Core.Models - date/time fields follow the Windows storage
// conventions (spec 4.2): dates 'yyyy-MM-dd', times 'HH:mm:ss', instants
// ISO-8601 UTC with offset. GUIDs are lowercase strings.

import {
  EntityType,
  MealCategoryKey,
  MealStatus,
  ProviderType,
  SyncFrequency,
  SyncOperationStatus,
  SyncOperationType,
  SyncStatus,
} from './enums';

export interface UserProfile {
  id: string;
  providerType: ProviderType;
  providerUserId: string;
  displayName: string;
  email: string;
  timeZone: string;
  isActive: number;
  createdAt: string;
  updatedAt: string;
  syncStatus: SyncStatus;
  cloudRevision: string | null;
}

/** One of the five permanent meal categories (configuration, never deletable). */
export interface MealCategory {
  id: string;
  fixedCategoryKey: MealCategoryKey;
  /** Empty = use the localized default name. */
  name: string;
  /** Card color '#AARRGGBB'. */
  color: string;
  /** Food emoji pictogram. */
  icon: string;
  /** Default planned time 'HH:mm:ss'. */
  defaultTime: string;
  displayOrder: number;
}

/**
 * One meal slot instance for one date. Exactly one per
 * (profile, date, FixedCategoryKey); created lazily, never deleted normally.
 */
export interface MealEntry {
  id: string;
  localProfileId: string;
  /** Calendar date 'yyyy-MM-dd'. */
  date: string;
  mealCategoryId: string;
  mealCategoryKey: MealCategoryKey;
  title: string;
  /** Free-form food description. */
  ingredients: string;
  /** Planned consumption time 'HH:mm:ss' or null (category default applies). */
  plannedTime: string | null;
  status: MealStatus;
  /** ISO-8601 UTC - set only when the user confirms the meal. */
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  /** Monotonic local revision; incremented on every local write. */
  revision: number;
  syncStatus: SyncStatus;
  cloudRevision: string | null;
  contentHash: string | null;
}

/** Photograph metadata; bytes live in the photo store, never in SQLite. */
export interface MealPhoto {
  id: string;
  mealEntryId: string;
  originalFileName: string;
  /** File name of the full-size copy. */
  localFileId: string;
  /** File name of the 256px thumbnail. */
  thumbnailId: string;
  mimeType: string;
  fileSize: number;
  /** SHA-256 of the image bytes (dedupe + corruption detection). */
  contentHash: string;
  cloudObjectId: string | null;
  cloudRevision: string | null;
  createdAt: string;
  updatedAt: string;
  syncStatus: SyncStatus;
}

/** Content of one meal slot inside a template. Never carries status/photos. */
export interface MealTemplateContent {
  mealCategoryKey: MealCategoryKey;
  title: string;
  ingredients: string;
  plannedTime: string | null;
}

/** Reusable template - single meal or full day. Never carries completion state. */
export interface MealTemplate {
  id: string;
  localProfileId: string;
  name: string;
  isFullDay: boolean;
  /** Single-meal template slot. */
  templateMealSlot: MealCategoryKey | null;
  /** Single-meal template payload. */
  templateMeal: MealTemplateContent | null;
  /** Full-day template payload (ordered by key, up to 5). */
  templateDay: MealTemplateContent[];
  recurrenceRules: string | null;
  createdAt: string;
  updatedAt: string;
  syncStatus: SyncStatus;
}

/** Reminder configuration attached to a permanent meal category (spec 10.1). */
export interface ReminderSettings {
  id: string;
  localProfileId: string;
  mealCategoryId: string;
  mealCategoryKey: MealCategoryKey;
  enabled: boolean;
  /** Local wall-clock time 'HH:mm:ss'. */
  time: string;
  /** Bit mask, Sunday = bit 0; all days = 127. */
  weekdays: number;
  /** Snooze duration offered by the notification; null disables snoozing. */
  snoozeMinutes: number | null;
  updatedAt: string;
  syncStatus: SyncStatus;
}

export const REMINDER_ALL_DAYS = 0b1111111;

/** True when the reminder applies on the supplied JS day (0 = Sunday). */
export function reminderAppliesTo(weekdays: number, jsDay: number): boolean {
  return (weekdays & (1 << jsDay)) !== 0;
}
/** Preferences that follow the user across devices. */
export interface AppPreferences {
  localProfileId: string;
  timeZone: string;
  showSnackCards: boolean;
  startWithWindows: boolean;
  minimizeToTray: boolean;
  remindersEnabled: boolean;
  /** Off by default = 24-hour clock (migration 0011). */
  use12HourClock: boolean;
  synchronizationEnabled: boolean;
  syncFrequency: SyncFrequency;
  preferredProvider: ProviderType;
  cloudUploadConsentGranted: boolean;
  onboardingCompleted: boolean;
  updatedAt: string;
  syncStatus: SyncStatus;
}

/** Connected cloud account - exactly one active (partial unique index). */
export interface CloudAccount {
  id: string;
  providerType: ProviderType;
  providerUserId: string;
  displayName: string;
  email: string;
  rootFolderId: string | null;
  lastAuthenticatedAt: string | null;
  lastSynchronizedAt: string | null;
  isActive: number;
  synchronizationEnabled: number;
  quotaTotalBytes: number | null;
  quotaRemainingBytes: number | null;
}

/** One entry of the durable outbox journal (spec 7.2). */
export interface SyncOperation {
  id: string;
  cloudAccountId: string;
  entityType: EntityType;
  entityId: string;
  operationType: SyncOperationType;
  status: SyncOperationStatus;
  entityRevision: number;
  retryCount: number;
  lastError: string | null;
  nextAttemptAt: string | null;
  createdAt: string;
  completedAt: string | null;
}

/** Per-account synchronization metadata (cursor, watermark, device id). */
export interface SyncMetadata {
  cloudAccountId: string;
  providerType: ProviderType;
  lastSyncCursor: string | null;
  lastSyncTimestamp: string | null;
  schemaVersion: number;
  deviceId: string;
  manifestRevision: string | null;
  lastFullUploadAt: string | null;
}

/** Conflict preserved for user resolution (never auto-merged, spec 2.4). */
export interface ConflictRecord {
  id: string;
  entityType: EntityType;
  entityId: string;
  localPayload: string;
  remotePayload: string;
  localModifiedAt: string;
  remoteModifiedAt: string;
  remoteRevision: string | null;
  deviceId: string | null;
  detectedAt: string;
  isResolved: number;
}

/** Deletion marker; travels to the cloud so deletions propagate (spec 7.6). */
export interface DeletionTombstone {
  id: string;
  entityType: EntityType;
  entityId: string;
  deletedAt: string;
  syncStatus: SyncStatus;
}

/**
 * Cloud payload envelope for one entity - provider agnostic, this is what gets
 * serialized to the appDataFolder (spec 7.4). Property names are camelCase,
 * enums serialize as strings (parity with DietTrackerJson on Windows).
 */
export interface CloudEnvelope<T = unknown> {
  schemaVersion: number;
  entityType: EntityType;
  entityId: string;
  localProfileId: string;
  /** Local revision the payload was produced from. */
  revision: number;
  /** UTC timestamp of the local write (ISO-8601). */
  updatedAt: string;
  /** Identifier of the device that produced this revision. */
  deviceId: string;
  /** Set for tombstones so deletions propagate deterministically. */
  isDeleted: boolean;
  /** SHA-256 of the payload JSON; integrity + echo suppression. */
  contentHash: string;
  payload: T | null;
}

/** Header fields read without full deserialization (spec 7.4). */
export interface EnvelopeHeader {
  schemaVersion: number;
  entityType: EntityType;
  entityId: string;
  revision: number;
  updatedAt: string;
  deviceId: string;
  isDeleted: boolean;
  contentHash: string;
}