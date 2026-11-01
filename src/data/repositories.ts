// Repositories over the local SQLite cache - port of the Windows
// Sqlite*Repository classes. Column names mirror the schema exactly
// (PascalCase); rows are mapped to the camelCase domain models.
//
// Offline-first rule (spec 1.2): every write here commits locally and
// journales a SyncOperation in the same transaction - the UI never waits
// for the network.

import { Scalar } from './sqlite';

import {
  EntityType,
  MealCategoryKey,
  MealStatus,
  ProviderType,
  SyncFrequency,
  SyncOperationStatus,
  SyncOperationType,
  SyncStatus,
} from '../domain/enums';
import {
  AppPreferences,
  CloudAccount,
  ConflictRecord,
  DeletionTombstone,
  MealCategory,
  MealEntry,
  MealPhoto,
  MealTemplate,
  MealTemplateContent,
  ReminderSettings,
  SyncMetadata,
  SyncOperation,
  UserProfile,
} from '../domain/models';
import { newGuid } from '../domain/rules/mealSlotRules';
import { execute, queryAll, queryOne, runInTransaction } from './database';

type Row = Record<string, Scalar>;

function s(row: Row, key: string): string {
  const value = row[key];
  return typeof value === 'string' ? value : value === null || value === undefined ? '' : String(value);
}

function sOrNull(row: Row, key: string): string | null {
  const value = row[key];
  if (value === null || value === undefined) {
    return null;
  }
  return typeof value === 'string' ? value : String(value);
}

function n(row: Row, key: string, fallback = 0): number {
  const value = row[key];
  if (typeof value === 'number') {
    return value;
  }
  if (typeof value === 'string' && value !== '' && !Number.isNaN(Number(value))) {
    return Number(value);
  }
  return fallback;
}

function b(row: Row, key: string): boolean {
  return n(row, key) !== 0;
}

function mapMealEntry(row: Row): MealEntry {
  return {
    id: s(row, 'Id'),
    localProfileId: s(row, 'LocalProfileId'),
    date: s(row, 'Date'),
    mealCategoryId: s(row, 'MealCategoryId'),
    mealCategoryKey: n(row, 'MealCategoryKey', 1) as MealCategoryKey,
    title: s(row, 'Title'),
    ingredients: s(row, 'Ingredients'),
    plannedTime: sOrNull(row, 'PlannedTime'),
    status: n(row, 'Status', 0) as MealStatus,
    completedAt: sOrNull(row, 'CompletedAt'),
    createdAt: s(row, 'CreatedAt'),
    updatedAt: s(row, 'UpdatedAt'),
    revision: n(row, 'Revision'),
    syncStatus: n(row, 'SyncStatus', 0) as SyncStatus,
    cloudRevision: sOrNull(row, 'CloudRevision'),
    contentHash: sOrNull(row, 'ContentHash'),
  };
}

function mapCategory(row: Row): MealCategory {
  return {
    id: s(row, 'Id'),
    fixedCategoryKey: n(row, 'FixedCategoryKey', 1) as MealCategoryKey,
    name: s(row, 'Name'),
    color: s(row, 'Color'),
    icon: s(row, 'Icon'),
    defaultTime: s(row, 'DefaultTime'),
    displayOrder: n(row, 'DisplayOrder'),
  };
}

function mapPhoto(row: Row): MealPhoto {
  return {
    id: s(row, 'Id'),
    mealEntryId: s(row, 'MealEntryId'),
    originalFileName: s(row, 'OriginalFileName'),
    localFileId: s(row, 'LocalFileId'),
    thumbnailId: s(row, 'ThumbnailId'),
    mimeType: s(row, 'MimeType'),
    fileSize: n(row, 'FileSize'),
    contentHash: s(row, 'ContentHash'),
    cloudObjectId: sOrNull(row, 'CloudObjectId'),
    cloudRevision: sOrNull(row, 'CloudRevision'),
    createdAt: s(row, 'CreatedAt'),
    updatedAt: s(row, 'UpdatedAt'),
    syncStatus: n(row, 'SyncStatus', 0) as SyncStatus,
  };
}

function mapTemplate(row: Row): MealTemplate {
  const templateData = s(row, 'TemplateData');
  let single: MealTemplateContent | null = null;
  let day: MealTemplateContent[] = [];
  try {
    const parsed = JSON.parse(templateData || '{}') as {
      single?: MealTemplateContent | null;
      day?: MealTemplateContent[];
    };
    single = parsed.single ?? null;
    day = parsed.day ?? [];
  } catch {
    // corrupt column - treat as empty (the Windows mapper tolerates this too)
  }
  const isFullDay = b(row, 'IsFullDay');
  return {
    id: s(row, 'Id'),
    localProfileId: s(row, 'LocalProfileId'),
    name: s(row, 'Name'),
    isFullDay,
    templateMealSlot: single ? (single.mealCategoryKey ?? null) : null,
    templateMeal: isFullDay ? null : single,
    templateDay: day,
    recurrenceRules: sOrNull(row, 'RecurrenceRules'),
    createdAt: s(row, 'CreatedAt'),
    updatedAt: s(row, 'UpdatedAt'),
    syncStatus: n(row, 'SyncStatus', 0) as SyncStatus,
  };
}

function mapReminder(row: Row): ReminderSettings {
  return {
    id: s(row, 'Id'),
    localProfileId: s(row, 'LocalProfileId'),
    mealCategoryId: s(row, 'MealCategoryId'),
    mealCategoryKey: n(row, 'MealCategoryKey', 1) as MealCategoryKey,
    enabled: b(row, 'Enabled'),
    time: s(row, 'Time'),
    weekdays: n(row, 'Weekdays', 127),
    snoozeMinutes: row.SnoozeMinutes === null || row.SnoozeMinutes === undefined ? null : n(row, 'SnoozeMinutes', 10),
    updatedAt: s(row, 'UpdatedAt'),
    syncStatus: n(row, 'SyncStatus', 0) as SyncStatus,
  };
}

function mapPreferences(row: Row): AppPreferences {
  return {
    localProfileId: s(row, 'LocalProfileId'),
    timeZone: s(row, 'TimeZone'),
    showSnackCards: b(row, 'ShowSnackCards'),
    startWithWindows: b(row, 'StartWithWindows'),
    minimizeToTray: b(row, 'MinimizeToTray'),
    remindersEnabled: b(row, 'RemindersEnabled'),
    use12HourClock: b(row, 'Use12HourClock'),
    synchronizationEnabled: b(row, 'SynchronizationEnabled'),
    syncFrequency: n(row, 'SyncFrequency', 1) as SyncFrequency,
    preferredProvider: n(row, 'PreferredProvider', 0) as ProviderType,
    cloudUploadConsentGranted: b(row, 'CloudUploadConsentGranted'),
    onboardingCompleted: b(row, 'OnboardingCompleted'),
    updatedAt: s(row, 'UpdatedAt'),
    syncStatus: n(row, 'SyncStatus', 0) as SyncStatus,
  };
}

function mapProfile(row: Row): UserProfile {
  return {
    id: s(row, 'Id'),
    providerType: n(row, 'ProviderType', 0) as ProviderType,
    providerUserId: s(row, 'ProviderUserId'),
    displayName: s(row, 'DisplayName'),
    email: s(row, 'Email'),
    timeZone: s(row, 'TimeZone'),
    isActive: n(row, 'IsActive'),
    createdAt: s(row, 'CreatedAt'),
    updatedAt: s(row, 'UpdatedAt'),
    syncStatus: n(row, 'SyncStatus', 0) as SyncStatus,
    cloudRevision: sOrNull(row, 'CloudRevision'),
  };
}

function mapAccount(row: Row): CloudAccount {
  return {
    id: s(row, 'Id'),
    providerType: n(row, 'ProviderType', 0) as ProviderType,
    providerUserId: s(row, 'ProviderUserId'),
    displayName: s(row, 'DisplayName'),
    email: s(row, 'Email'),
    rootFolderId: sOrNull(row, 'RootFolderId'),
    lastAuthenticatedAt: sOrNull(row, 'LastAuthenticatedAt'),
    lastSynchronizedAt: sOrNull(row, 'LastSynchronizedAt'),
    isActive: n(row, 'IsActive'),
    synchronizationEnabled: n(row, 'SynchronizationEnabled', 1),
    quotaTotalBytes: row.QuotaTotalBytes === null || row.QuotaTotalBytes === undefined ? null : n(row, 'QuotaTotalBytes'),
    quotaRemainingBytes:
      row.QuotaRemainingBytes === null || row.QuotaRemainingBytes === undefined ? null : n(row, 'QuotaRemainingBytes'),
  };
}

function mapOperation(row: Row): SyncOperation {
  return {
    id: s(row, 'Id'),
    cloudAccountId: s(row, 'CloudAccountId'),
    entityType: n(row, 'EntityType') as EntityType,
    entityId: s(row, 'EntityId'),
    operationType: n(row, 'OperationType') as SyncOperationType,
    status: n(row, 'Status') as SyncOperationStatus,
    entityRevision: n(row, 'EntityRevision'),
    retryCount: n(row, 'RetryCount'),
    lastError: sOrNull(row, 'LastError'),
    nextAttemptAt: sOrNull(row, 'NextAttemptAt'),
    createdAt: s(row, 'CreatedAt'),
    completedAt: sOrNull(row, 'CompletedAt'),
  };
}

function mapMetadata(row: Row): SyncMetadata {
  return {
    cloudAccountId: s(row, 'CloudAccountId'),
    providerType: n(row, 'ProviderType') as ProviderType,
    lastSyncCursor: sOrNull(row, 'LastSyncCursor'),
    lastSyncTimestamp: sOrNull(row, 'LastSyncTimestamp'),
    schemaVersion: n(row, 'SchemaVersion', 1),
    deviceId: s(row, 'DeviceId'),
    manifestRevision: sOrNull(row, 'ManifestRevision'),
    lastFullUploadAt: sOrNull(row, 'LastFullUploadAt'),
  };
}

function mapConflict(row: Row): ConflictRecord {
  return {
    id: s(row, 'Id'),
    entityType: n(row, 'EntityType') as EntityType,
    entityId: s(row, 'EntityId'),
    localPayload: s(row, 'LocalPayload'),
    remotePayload: s(row, 'RemotePayload'),
    localModifiedAt: s(row, 'LocalModifiedAt'),
    remoteModifiedAt: s(row, 'RemoteModifiedAt'),
    remoteRevision: sOrNull(row, 'RemoteRevision'),
    deviceId: sOrNull(row, 'DeviceId'),
    detectedAt: s(row, 'DetectedAt'),
    isResolved: n(row, 'IsResolved'),
  };
}

function mapTombstone(row: Row): DeletionTombstone {
  return {
    id: s(row, 'Id'),
    entityType: n(row, 'EntityType') as EntityType,
    entityId: s(row, 'EntityId'),
    deletedAt: s(row, 'DeletedAt'),
    syncStatus: n(row, 'SyncStatus', 3) as SyncStatus,
  };
}

// --- MealEntry --------------------------------------------------------------

/** All stored entries for one date, ordered by the fixed slot key. */
export async function getMealsForDate(profileId: string, date: string): Promise<MealEntry[]> {
  return queryAll(
    'SELECT * FROM MealEntry WHERE LocalProfileId = ? AND Date = ? ORDER BY MealCategoryKey;',
    [profileId, date],
    mapMealEntry,
  );
}

/** Entries of an inclusive date range, grouped by date (statistics/calendar). */
export async function getMealsInRange(
  profileId: string,
  from: string,
  to: string,
): Promise<MealEntry[]> {
  return queryAll(
    'SELECT * FROM MealEntry WHERE LocalProfileId = ? AND Date >= ? AND Date <= ? ORDER BY Date, MealCategoryKey;',
    [profileId, from, to],
    mapMealEntry,
  );
}

export async function getMealById(id: string): Promise<MealEntry | null> {
  return queryOne('SELECT * FROM MealEntry WHERE Id = ?;', [id], mapMealEntry);
}

/**
 * Inserts or updates one entry. The unique slot index (profile/date/key)
 * makes an upsert of the same slot replace the row, exactly like Windows'
 * ON CONFLICT DO UPDATE.
 *
 * The stored `Id` is NEVER rewritten. It is the value `MealPhoto.MealEntryId`
 * points at, and the schema carries no `ON UPDATE` action, so replacing it threw
 * `FOREIGN KEY constraint failed` for every meal that already had a photograph -
 * which is exactly what made the Save button of a "photo first" card do nothing
 * (the write was rolled back and the editor stayed open). A draft that arrives
 * with a different id simply updates the slot's content; the next read hands the
 * card the stored id back.
 */
export async function upsertMeal(entry: MealEntry): Promise<void> {
  await runInTransaction([
    {
      sql: `INSERT INTO MealEntry
        (Id, LocalProfileId, Date, MealCategoryId, MealCategoryKey, Title, Ingredients,
         PlannedTime, Status, CompletedAt, CreatedAt, UpdatedAt, Revision, SyncStatus,
         CloudRevision, ContentHash)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(LocalProfileId, Date, MealCategoryKey) DO UPDATE SET
          MealCategoryId = excluded.MealCategoryId,
          Title = excluded.Title,
          Ingredients = excluded.Ingredients,
          PlannedTime = excluded.PlannedTime,
          Status = excluded.Status,
          CompletedAt = excluded.CompletedAt,
          UpdatedAt = excluded.UpdatedAt,
          Revision = excluded.Revision,
          SyncStatus = excluded.SyncStatus,
          CloudRevision = excluded.CloudRevision,
          ContentHash = excluded.ContentHash;`,
      params: [
        entry.id,
        entry.localProfileId,
        entry.date,
        entry.mealCategoryId,
        entry.mealCategoryKey,
        entry.title,
        entry.ingredients,
        entry.plannedTime,
        entry.status,
        entry.completedAt,
        entry.createdAt,
        entry.updatedAt,
        entry.revision,
        entry.syncStatus,
        entry.cloudRevision,
        entry.contentHash,
      ],
    },
  ]);
}

/** Hard-deletes an entry - only used by purge/restore, never by the UI. */
export async function deleteMeal(id: string): Promise<void> {
  await execute('DELETE FROM MealEntry WHERE Id = ?;', [id]);
}

/** The entry of one permanent slot (unique per profile/date/key). */
export async function getMealBySlot(
  profileId: string,
  date: string,
  key: MealCategoryKey,
): Promise<MealEntry | null> {
  return queryOne(
    'SELECT * FROM MealEntry WHERE LocalProfileId = ? AND Date = ? AND MealCategoryKey = ?;',
    [profileId, date, key],
    mapMealEntry,
  );
}

/**
 * Replaces a local placeholder row of one slot with the record the cloud
 * published, adopting the cloud identity (the document path IS the meal id).
 *
 * Photographs of the placeholder are re-pointed first: foreign keys are
 * deferred inside the transaction, so the child rows may temporarily refer to a
 * parent that the same transaction inserts a moment later.
 */
export async function adoptRemoteMealEntry(entry: MealEntry, replacedMealId: string): Promise<void> {
  await runInTransaction([
    { sql: 'PRAGMA defer_foreign_keys = ON;' },
    { sql: 'UPDATE MealPhoto SET MealEntryId = ? WHERE MealEntryId = ?;', params: [entry.id, replacedMealId] },
    { sql: 'DELETE FROM MealEntry WHERE Id = ?;', params: [replacedMealId] },
    {
      sql: `INSERT INTO MealEntry
        (Id, LocalProfileId, Date, MealCategoryId, MealCategoryKey, Title, Ingredients,
         PlannedTime, Status, CompletedAt, CreatedAt, UpdatedAt, Revision, SyncStatus,
         CloudRevision, ContentHash)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      params: [
        entry.id,
        entry.localProfileId,
        entry.date,
        entry.mealCategoryId,
        entry.mealCategoryKey,
        entry.title,
        entry.ingredients,
        entry.plannedTime,
        entry.status,
        entry.completedAt,
        entry.createdAt,
        entry.updatedAt,
        entry.revision,
        entry.syncStatus,
        entry.cloudRevision,
        entry.contentHash,
      ],
    },
  ]);
}

/** Number of stored entries (integrity check + statistics empty states). */
export async function countMeals(profileId: string): Promise<number> {
  const row = await queryOne(
    'SELECT COUNT(*) AS c FROM MealEntry WHERE LocalProfileId = ?;',
    [profileId],
    (r) => n(r, 'c'),
  );
  return row ?? 0;
}

// --- MealCategory -----------------------------------------------------------

export async function getCategories(): Promise<MealCategory[]> {
  return queryAll('SELECT * FROM MealCategory ORDER BY DisplayOrder;', [], mapCategory);
}

export async function upsertCategory(category: MealCategory): Promise<void> {
  await runInTransaction([
    {
      sql: `INSERT INTO MealCategory (Id, FixedCategoryKey, Name, Color, Icon, DefaultTime, DisplayOrder)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(FixedCategoryKey) DO UPDATE SET
              Name = excluded.Name, Color = excluded.Color, Icon = excluded.Icon,
              DefaultTime = excluded.DefaultTime, DisplayOrder = excluded.DisplayOrder;`,
      params: [
        category.id,
        category.fixedCategoryKey,
        category.name,
        category.color,
        category.icon,
        category.defaultTime,
        category.displayOrder,
      ],
    },
  ]);
}

export async function getCategoryById(id: string): Promise<MealCategory | null> {
  return queryOne('SELECT * FROM MealCategory WHERE Id = ?;', [id], mapCategory);
}

// --- MealPhoto --------------------------------------------------------------

export async function getPhotosForMeal(mealEntryId: string): Promise<MealPhoto[]> {
  return queryAll(
    'SELECT * FROM MealPhoto WHERE MealEntryId = ? ORDER BY CreatedAt;',
    [mealEntryId],
    mapPhoto,
  );
}

export async function getAllPhotos(): Promise<MealPhoto[]> {
  return queryAll('SELECT * FROM MealPhoto ORDER BY CreatedAt;', [], mapPhoto);
}

/** photo counts per meal id - feeds analytics + calendar mini cards. */
export async function getPhotoCounts(): Promise<Map<string, number>> {
  const rows = await queryAll(
    'SELECT MealEntryId, COUNT(*) AS c FROM MealPhoto GROUP BY MealEntryId;',
    [],
    (r) => ({ id: s(r, 'MealEntryId'), count: n(r, 'c') }),
  );
  return new Map(rows.map((r) => [r.id, r.count]));
}

export async function getPhotoById(id: string): Promise<MealPhoto | null> {
  return queryOne('SELECT * FROM MealPhoto WHERE Id = ?;', [id], mapPhoto);
}

/** First (oldest) photo of a meal - the calendar mini card picture. */
export async function getFirstPhoto(mealEntryId: string): Promise<MealPhoto | null> {
  return queryOne(
    'SELECT * FROM MealPhoto WHERE MealEntryId = ? ORDER BY CreatedAt LIMIT 1;',
    [mealEntryId],
    mapPhoto,
  );
}

/** True when a photo with the same SHA-256 is already attached (dedupe). */
export async function photoExistsWithHash(mealEntryId: string, contentHash: string): Promise<boolean> {
  const row = await queryOne(
    'SELECT 1 AS x FROM MealPhoto WHERE MealEntryId = ? AND ContentHash = ? LIMIT 1;',
    [mealEntryId, contentHash],
    (r) => n(r, 'x'),
  );
  return row !== null;
}

export async function insertPhoto(photo: MealPhoto): Promise<void> {
  await runInTransaction([
    {
      sql: `INSERT INTO MealPhoto
        (Id, MealEntryId, OriginalFileName, LocalFileId, ThumbnailId, MimeType, FileSize,
         ContentHash, CloudObjectId, CloudRevision, CreatedAt, UpdatedAt, SyncStatus)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      params: [
        photo.id,
        photo.mealEntryId,
        photo.originalFileName,
        photo.localFileId,
        photo.thumbnailId,
        photo.mimeType,
        photo.fileSize,
        photo.contentHash,
        photo.cloudObjectId,
        photo.cloudRevision,
        photo.createdAt,
        photo.updatedAt,
        photo.syncStatus,
      ],
    },
  ]);
}

/** Upsert used when applying a remote photo document over an existing row. */
export async function upsertPhotoRow(photo: MealPhoto): Promise<void> {
  await runInTransaction([
    {
      sql: `INSERT INTO MealPhoto
        (Id, MealEntryId, OriginalFileName, LocalFileId, ThumbnailId, MimeType, FileSize,
         ContentHash, CloudObjectId, CloudRevision, CreatedAt, UpdatedAt, SyncStatus)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(Id) DO UPDATE SET
          MealEntryId = excluded.MealEntryId,
          OriginalFileName = excluded.OriginalFileName,
          LocalFileId = excluded.LocalFileId,
          ThumbnailId = excluded.ThumbnailId,
          MimeType = excluded.MimeType,
          FileSize = excluded.FileSize,
          ContentHash = excluded.ContentHash,
          CloudObjectId = excluded.CloudObjectId,
          CloudRevision = excluded.CloudRevision,
          UpdatedAt = excluded.UpdatedAt,
          SyncStatus = excluded.SyncStatus;`,
      params: [
        photo.id,
        photo.mealEntryId,
        photo.originalFileName,
        photo.localFileId,
        photo.thumbnailId,
        photo.mimeType,
        photo.fileSize,
        photo.contentHash,
        photo.cloudObjectId,
        photo.cloudRevision,
        photo.createdAt,
        photo.updatedAt,
        photo.syncStatus,
      ],
    },
  ]);
}

export async function deletePhoto(id: string): Promise<void> {
  await execute('DELETE FROM MealPhoto WHERE Id = ?;', [id]);
}

/** Total bytes of stored originals (Settings storage usage line). */
export async function totalPhotoBytes(): Promise<number> {
  const row = await queryOne('SELECT SUM(FileSize) AS total FROM MealPhoto;', [], (r) =>
    n(r, 'total'),
  );
  return row ?? 0;
}

// --- MealTemplate -----------------------------------------------------------

/** List sorted by UpdatedAt desc (spec 8.7). */
export async function getTemplates(): Promise<MealTemplate[]> {
  return queryAll('SELECT * FROM MealTemplate ORDER BY UpdatedAt DESC;', [], mapTemplate);
}

export async function getTemplateById(id: string): Promise<MealTemplate | null> {
  return queryOne('SELECT * FROM MealTemplate WHERE Id = ?;', [id], mapTemplate);
}

export async function upsertTemplate(template: MealTemplate): Promise<void> {
  const templateData = JSON.stringify({
    single: template.isFullDay ? null : template.templateMeal,
    day: template.templateDay,
  });
  await runInTransaction([
    {
      sql: `INSERT INTO MealTemplate
        (Id, LocalProfileId, Name, IsFullDay, TemplateData, RecurrenceRules, CreatedAt, UpdatedAt, SyncStatus)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(Id) DO UPDATE SET
          Name = excluded.Name, IsFullDay = excluded.IsFullDay,
          TemplateData = excluded.TemplateData, RecurrenceRules = excluded.RecurrenceRules,
          UpdatedAt = excluded.UpdatedAt, SyncStatus = excluded.SyncStatus;`,
      params: [
        template.id,
        template.localProfileId,
        template.name,
        template.isFullDay ? 1 : 0,
        templateData,
        template.recurrenceRules,
        template.createdAt,
        template.updatedAt,
        template.syncStatus,
      ],
    },
  ]);
}

export async function deleteTemplate(id: string): Promise<void> {
  await execute('DELETE FROM MealTemplate WHERE Id = ?;', [id]);
}

// --- ReminderSettings -------------------------------------------------------

export async function getReminders(profileId: string): Promise<ReminderSettings[]> {
  return queryAll(
    'SELECT * FROM ReminderSettings WHERE LocalProfileId = ? ORDER BY MealCategoryKey;',
    [profileId],
    mapReminder,
  );
}

export async function upsertReminder(reminder: ReminderSettings): Promise<void> {
  await runInTransaction([
    {
      sql: `INSERT INTO ReminderSettings
        (Id, LocalProfileId, MealCategoryId, MealCategoryKey, Enabled, Time, Weekdays,
         SnoozeMinutes, UpdatedAt, SyncStatus)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(LocalProfileId, MealCategoryKey) DO UPDATE SET
          MealCategoryId = excluded.MealCategoryId, Enabled = excluded.Enabled,
          Time = excluded.Time, Weekdays = excluded.Weekdays,
          SnoozeMinutes = excluded.SnoozeMinutes, UpdatedAt = excluded.UpdatedAt,
          SyncStatus = excluded.SyncStatus;`,
      params: [
        reminder.id,
        reminder.localProfileId,
        reminder.mealCategoryId,
        reminder.mealCategoryKey,
        reminder.enabled ? 1 : 0,
        reminder.time,
        reminder.weekdays,
        reminder.snoozeMinutes,
        reminder.updatedAt,
        reminder.syncStatus,
      ],
    },
  ]);
}

export async function deleteReminder(id: string): Promise<void> {
  await execute('DELETE FROM ReminderSettings WHERE Id = ?;', [id]);
}

export async function getReminderById(id: string): Promise<ReminderSettings | null> {
  return queryOne('SELECT * FROM ReminderSettings WHERE Id = ?;', [id], mapReminder);
}

/** ReminderFired ledger: true when the reminder already fired for that date. */
export async function reminderAlreadyFired(reminderId: string, date: string): Promise<boolean> {
  const row = await queryOne(
    'SELECT 1 AS x FROM ReminderFired WHERE ReminderId = ? AND Date = ? LIMIT 1;',
    [reminderId, date],
    (r) => n(r, 'x'),
  );
  return row !== null;
}

/** Records a fire in the never-twice ledger (unique (ReminderId, Date)). */
export async function recordReminderFired(
  reminderId: string,
  date: string,
  firedAt: string,
  mealEntryId: string | null,
): Promise<void> {
  await runInTransaction([
    {
      sql: `INSERT INTO ReminderFired (Id, ReminderId, Date, FiredAt, MealEntryId)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(ReminderId, Date) DO NOTHING;`,
      params: [newGuid(), reminderId, date, firedAt, mealEntryId],
    },
  ]);
}

// --- AppPreferences + UserProfile -------------------------------------------

export async function getPreferences(profileId: string): Promise<AppPreferences | null> {
  return queryOne(
    'SELECT * FROM AppPreferences WHERE LocalProfileId = ?;',
    [profileId],
    mapPreferences,
  );
}

export async function upsertPreferences(p: AppPreferences): Promise<void> {
  await runInTransaction([
    {
      sql: `INSERT INTO AppPreferences
        (LocalProfileId, TimeZone, ShowSnackCards, StartWithWindows, MinimizeToTray,
         RemindersEnabled, Use12HourClock, SynchronizationEnabled, SyncFrequency,
         PreferredProvider, CloudUploadConsentGranted, OnboardingCompleted, UpdatedAt, SyncStatus)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(LocalProfileId) DO UPDATE SET
          TimeZone = excluded.TimeZone, ShowSnackCards = excluded.ShowSnackCards,
          StartWithWindows = excluded.StartWithWindows, MinimizeToTray = excluded.MinimizeToTray,
          RemindersEnabled = excluded.RemindersEnabled, Use12HourClock = excluded.Use12HourClock,
          SynchronizationEnabled = excluded.SynchronizationEnabled,
          SyncFrequency = excluded.SyncFrequency, PreferredProvider = excluded.PreferredProvider,
          CloudUploadConsentGranted = excluded.CloudUploadConsentGranted,
          OnboardingCompleted = excluded.OnboardingCompleted,
          UpdatedAt = excluded.UpdatedAt, SyncStatus = excluded.SyncStatus;`,
      params: [
        p.localProfileId,
        p.timeZone,
        p.showSnackCards ? 1 : 0,
        p.startWithWindows ? 1 : 0,
        p.minimizeToTray ? 1 : 0,
        p.remindersEnabled ? 1 : 0,
        p.use12HourClock ? 1 : 0,
        p.synchronizationEnabled ? 1 : 0,
        p.syncFrequency,
        p.preferredProvider,
        p.cloudUploadConsentGranted ? 1 : 0,
        p.onboardingCompleted ? 1 : 0,
        p.updatedAt,
        p.syncStatus,
      ],
    },
  ]);
}

export async function getActiveProfile(): Promise<UserProfile | null> {
  return queryOne('SELECT * FROM UserProfile WHERE IsActive = 1 LIMIT 1;', [], mapProfile);
}

// --- Cloud account + synchronization journal --------------------------------

/** The single active account (partial unique index enforces uniqueness). */
export async function getActiveAccount(): Promise<CloudAccount | null> {
  return queryOne('SELECT * FROM CloudAccount WHERE IsActive = 1 LIMIT 1;', [], mapAccount);
}

export async function upsertAccount(account: CloudAccount): Promise<void> {
  await runInTransaction([
    {
      sql: `INSERT INTO CloudAccount
        (Id, ProviderType, ProviderUserId, DisplayName, Email, RootFolderId,
         LastAuthenticatedAt, LastSynchronizedAt, IsActive, SynchronizationEnabled,
         QuotaTotalBytes, QuotaRemainingBytes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(Id) DO UPDATE SET
          ProviderType = excluded.ProviderType, ProviderUserId = excluded.ProviderUserId,
          DisplayName = excluded.DisplayName, Email = excluded.Email,
          RootFolderId = excluded.RootFolderId,
          LastAuthenticatedAt = excluded.LastAuthenticatedAt,
          LastSynchronizedAt = excluded.LastSynchronizedAt,
          IsActive = excluded.IsActive,
          SynchronizationEnabled = excluded.SynchronizationEnabled,
          QuotaTotalBytes = excluded.QuotaTotalBytes,
          QuotaRemainingBytes = excluded.QuotaRemainingBytes;`,
      params: [
        account.id,
        account.providerType,
        account.providerUserId,
        account.displayName,
        account.email,
        account.rootFolderId,
        account.lastAuthenticatedAt,
        account.lastSynchronizedAt,
        account.isActive,
        account.synchronizationEnabled,
        account.quotaTotalBytes,
        account.quotaRemainingBytes,
      ],
    },
  ]);
}

export async function deleteAllAccounts(): Promise<void> {
  // Cascade removes SyncOperation/SyncMetadata with the account row.
  await execute('DELETE FROM CloudAccount;');
}

/**
 * Journals one durable outbox entry. Supersedes older pending operations for
 * the same entity (the newest revision wins - spec 7.3).
 */
export async function journalOperation(op: SyncOperation): Promise<void> {
  await runInTransaction([
    {
      sql: `INSERT INTO SyncOperation
        (Id, CloudAccountId, EntityType, EntityId, OperationType, Status, EntityRevision,
         RetryCount, LastError, NextAttemptAt, CreatedAt, CompletedAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      params: [
        op.id,
        op.cloudAccountId,
        op.entityType,
        op.entityId,
        op.operationType,
        op.status,
        op.entityRevision,
        op.retryCount,
        op.lastError,
        op.nextAttemptAt,
        op.createdAt,
        op.completedAt,
      ],
    },
    {
      // An earlier pending entry for the same entity is superseded.
      sql: `UPDATE SyncOperation SET Status = 4
            WHERE CloudAccountId = ? AND EntityType = ? AND EntityId = ?
              AND Status IN (0, 1, 3) AND Id <> ?;`,
      params: [op.cloudAccountId, op.entityType, op.entityId, op.id],
    },
  ]);
}

/** Pending operations (Pending + Failed awaiting retry) in journal order. */
export async function getPendingOperations(accountId: string): Promise<SyncOperation[]> {
  return queryAll(
    `SELECT * FROM SyncOperation
     WHERE CloudAccountId = ? AND Status IN (0, 3)
     ORDER BY CreatedAt;`,
    [accountId],
    mapOperation,
  );
}

/** How many changes still wait for the cloud (sign-out refusal, badges). */
export async function countPendingOperations(accountId: string): Promise<number> {
  const row = await queryOne(
    'SELECT COUNT(*) AS c FROM SyncOperation WHERE CloudAccountId = ? AND Status IN (0, 3);',
    [accountId],
    (r) => n(r, 'c'),
  );
  return row ?? 0;
}

export async function completeOperation(id: string, at: string): Promise<void> {
  await execute('UPDATE SyncOperation SET Status = 2, CompletedAt = ? WHERE Id = ?;', [at, id]);
}

/** Marks a failure and schedules the exponential backoff retry. */
export async function failOperation(
  id: string,
  error: string,
  retryCount: number,
  nextAttemptAt: string | null,
): Promise<void> {
  await execute(
    `UPDATE SyncOperation
     SET Status = 3, RetryCount = ?, LastError = ?, NextAttemptAt = ?
     WHERE Id = ?;`,
    [retryCount, error, nextAttemptAt, id],
  );
}

export async function getMetadata(accountId: string): Promise<SyncMetadata | null> {
  return queryOne('SELECT * FROM SyncMetadata WHERE CloudAccountId = ?;', [accountId], mapMetadata);
}

export async function upsertMetadata(meta: SyncMetadata): Promise<void> {
  await runInTransaction([
    {
      sql: `INSERT INTO SyncMetadata
        (CloudAccountId, ProviderType, LastSyncCursor, LastSyncTimestamp, SchemaVersion,
         DeviceId, ManifestRevision, LastFullUploadAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(CloudAccountId) DO UPDATE SET
          ProviderType = excluded.ProviderType,
          LastSyncCursor = excluded.LastSyncCursor,
          LastSyncTimestamp = excluded.LastSyncTimestamp,
          SchemaVersion = excluded.SchemaVersion,
          DeviceId = excluded.DeviceId,
          ManifestRevision = excluded.ManifestRevision,
          LastFullUploadAt = excluded.LastFullUploadAt;`,
      params: [
        meta.cloudAccountId,
        meta.providerType,
        meta.lastSyncCursor,
        meta.lastSyncTimestamp,
        meta.schemaVersion,
        meta.deviceId,
        meta.manifestRevision,
        meta.lastFullUploadAt,
      ],
    },
  ]);
}

// --- Conflicts + tombstones --------------------------------------------------

/** Open conflicts awaiting the user's decision (spec 7.7 / 2.4). */
/** True when this exact remote revision is already waiting for the user. */
export async function hasOpenConflict(
  entityType: EntityType,
  entityId: string,
  remoteRevision: string,
): Promise<boolean> {
  const row = await queryOne(
    `SELECT 1 AS x FROM ConflictRecord
      WHERE EntityType = ? AND EntityId = ? AND RemoteRevision = ? AND IsResolved = 0 LIMIT 1;`,
    [entityType, entityId, remoteRevision],
    (r) => n(r, 'x'),
  );
  return row !== null;
}

export async function getOpenConflicts(): Promise<ConflictRecord[]> {
  return queryAll(
    'SELECT * FROM ConflictRecord WHERE IsResolved = 0 ORDER BY DetectedAt;',
    [],
    mapConflict,
  );
}

export async function insertConflict(record: ConflictRecord): Promise<void> {
  await runInTransaction([
    {
      sql: `INSERT INTO ConflictRecord
        (Id, EntityType, EntityId, LocalPayload, RemotePayload, LocalModifiedAt,
         RemoteModifiedAt, RemoteRevision, DeviceId, DetectedAt, IsResolved)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      params: [
        record.id,
        record.entityType,
        record.entityId,
        record.localPayload,
        record.remotePayload,
        record.localModifiedAt,
        record.remoteModifiedAt,
        record.remoteRevision,
        record.deviceId,
        record.detectedAt,
        record.isResolved,
      ],
    },
  ]);
}

export async function resolveConflict(id: string): Promise<void> {
  await execute('UPDATE ConflictRecord SET IsResolved = 1 WHERE Id = ?;', [id]);
}

export async function getTombstones(): Promise<DeletionTombstone[]> {
  return queryAll('SELECT * FROM DeletionTombstone ORDER BY DeletedAt;', [], mapTombstone);
}

export async function upsertTombstone(tombstone: DeletionTombstone): Promise<void> {
  await runInTransaction([
    {
      sql: `INSERT INTO DeletionTombstone (Id, EntityType, EntityId, DeletedAt, SyncStatus)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(EntityType, EntityId) DO UPDATE SET
              DeletedAt = excluded.DeletedAt, SyncStatus = excluded.SyncStatus;`,
      params: [
        tombstone.id,
        tombstone.entityType,
        tombstone.entityId,
        tombstone.deletedAt,
        tombstone.syncStatus,
      ],
    },
  ]);
}

export async function deleteTombstone(entityType: EntityType, entityId: string): Promise<void> {
  await execute('DELETE FROM DeletionTombstone WHERE EntityType = ? AND EntityId = ?;', [
    entityType,
    entityId,
  ]);
}

/**
 * Empties the local cache of records - only called by the sign-out flow AFTER
 * the provider confirmed the upload (spec 1.2). Photographs on disk are
 * removed by the caller (photo store), never here.
 */
export async function purgeLocalRecords(): Promise<void> {
  await runInTransaction([
    { sql: 'DELETE FROM MealPhoto;' },
    { sql: 'DELETE FROM MealEntry;' },
    { sql: 'DELETE FROM MealTemplate;' },
    { sql: 'DELETE FROM ReminderFired;' },
    { sql: 'DELETE FROM ReminderSettings;' },
    { sql: 'DELETE FROM MealCategory;' },
    { sql: 'DELETE FROM ConflictRecord;' },
    { sql: 'DELETE FROM DeletionTombstone;' },
    { sql: 'DELETE FROM SyncOperation;' },
    { sql: 'DELETE FROM SyncMetadata;' },
  ]);
}

export async function upsertProfile(profile: UserProfile): Promise<void> {
  await runInTransaction([
    {
      sql: `INSERT INTO UserProfile
        (Id, ProviderType, ProviderUserId, DisplayName, Email, TimeZone, IsActive,
         CreatedAt, UpdatedAt, SyncStatus, CloudRevision)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(Id) DO UPDATE SET
          ProviderType = excluded.ProviderType, ProviderUserId = excluded.ProviderUserId,
          DisplayName = excluded.DisplayName, Email = excluded.Email,
          TimeZone = excluded.TimeZone, IsActive = excluded.IsActive,
          UpdatedAt = excluded.UpdatedAt, SyncStatus = excluded.SyncStatus,
          CloudRevision = excluded.CloudRevision;`,
      params: [
        profile.id,
        profile.providerType,
        profile.providerUserId,
        profile.displayName,
        profile.email,
        profile.timeZone,
        profile.isActive,
        profile.createdAt,
        profile.updatedAt,
        profile.syncStatus,
        profile.cloudRevision,
      ],
    },
  ]);
}