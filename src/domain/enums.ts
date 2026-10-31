// Port of DietTracker.Core.Enums - numeric values are persisted in SQLite and in
// the cloud payload; NEVER renumber (spec 4.5).

/** The five permanent daily meal slots (persisted contract). */
export enum MealCategoryKey {
  Breakfast = 1,
  MorningSnack = 2,
  Lunch = 3,
  AfternoonSnack = 4,
  Dinner = 5,
}

/**
 * State of a meal slot on a specific date. Exactly three states: PENDING is the
 * default, DONE = user confirmed eaten, MISSED = user explicitly marked not eaten.
 * Time never changes a state on its own (spec 5.3).
 */
export enum MealStatus {
  Pending = 0,
  Done = 1,
  Missed = 2,
}

/** Per-record synchronization state stored alongside every synced entity. */
export enum SyncStatus {
  PendingUpload = 0,
  Synced = 1,
  PendingUpdate = 2,
  PendingDelete = 3,
  Failed = 4,
  Conflict = 5,
}

/**
 * Identity / cloud provider. Value 1 (Microsoft/OneDrive) is reserved forever
 * and must never be reused (spec 2.1).
 */
export enum ProviderType {
  None = 0,
  // 1 reserved (removed OneDrive provider)
  Google = 2,
}

/** Types of entities that participate in cloud synchronization. */
export enum EntityType {
  UserProfile = 0,
  MealEntry = 1,
  MealPhoto = 2,
  MealTemplate = 3,
  ReminderSettings = 4,
  AppPreferences = 5,
  MealCategory = 6,
}

/** Operation recorded in the durable outbox journal. */
export enum SyncOperationType {
  Upsert = 0,
  Delete = 1,
}

/** Lifecycle of a single journaled synchronization operation. */
export enum SyncOperationStatus {
  Pending = 0,
  InProgress = 1,
  Completed = 2,
  Failed = 3,
  Abandoned = 4,
}

/** How often the application checks the cloud on its own (spec 8.8). */
export enum SyncFrequency {
  Manual = 0,
  Weekly = 1,
  Monthly = 2,
}

/** User-visible synchronization state (never Synced before provider confirmed). */
export enum SyncState {
  NotConfigured = 0,
  Synced = 1,
  Syncing = 2,
  PendingChanges = 3,
  Offline = 4,
  AuthenticationRequired = 5,
  Error = 6,
  Paused = 7,
}

/** What caused a synchronization cycle to run. */
export enum SyncTrigger {
  Startup = 0,
  PostSignIn = 1,
  LocalChange = 2,
  ConnectivityRestored = 3,
  Periodic = 4,
  Manual = 5,
  PostRestore = 6,
  /**
   * The frequent, silent download that keeps the open app in step with the other
   * devices. It never pushes (a local edit runs its own cycle) and it is throttled
   * by the engine, so a foregrounded app costs one small change-feed call per
   * interval instead of a full cycle.
   */
  AutoPull = 8,
}

/** Cloud payload schema version (CloudSchema.CurrentVersion on Windows). */
export const CLOUD_SCHEMA_VERSION = 1;
/** Documents below this version are skipped (CloudSchema.MinimumSupportedVersion). */
export const CLOUD_SCHEMA_MIN_SUPPORTED = 1;