// Cross-device identity mapping (spec 7.4/7.5).
//
// Every installation generates its own local profile id and its own five
// category ids, while the cloud documents carry the ids of the device that
// produced them. A cloud document must therefore never be written with its
// foreign ids: the receiving device maps them onto its own rows, or SQLite
// rejects the import (UNIQUE UserProfile identity / FOREIGN KEY MealEntry).
//
// The mapping rules are shared with the Windows import path:
//  - the signed-in profile is the one local profile; remote profile documents
//    only update its descriptive fields, never its id or its provider identity;
//  - categories are identified by their permanent FixedCategoryKey, never by a
//    local id, so a remote meal/reminder points at the local category row;
//  - meal entries keep their cloud identity (the document path is the meal id);
//    a local placeholder occupying the same slot is replaced by it, while a
//    local row with real content is preserved as a conflict;
//  - shared settings are a fixed list of fields; device-specific settings
//    (synchronization toggle, frequency, start with Windows, ...) stay local.

import { MealCategoryKey, MealStatus, ProviderType, SyncStatus } from '../domain/enums';
import { AppPreferences, MealCategory, MealEntry, UserProfile } from '../domain/models';
import {
  mealEntryFromPayload,
  mealEntryToPayload,
  mealPhotoFromPayload,
  mealPhotoToPayload,
  reminderFromPayload,
  reminderToPayload,
} from '../domain/payloads';

/** The receiving device's ids plus the two lookups the mapping needs. */
export interface LocalIdentity {
  /** Active local profile id. */
  profileId: string;
  /** Local category id for every permanent category key. */
  categoryIdByKey: Map<MealCategoryKey, string>;
}

/** Builds the identity out of the local rows. */
export function localIdentity(profileId: string, categories: MealCategory[]): LocalIdentity {
  const categoryIdByKey = new Map<MealCategoryKey, string>();
  for (const category of categories) {
    categoryIdByKey.set(category.fixedCategoryKey, category.id);
  }
  return { profileId, categoryIdByKey };
}

/** Local category id for a permanent key (falls back to the first category). */
export function categoryIdForKey(
  identity: LocalIdentity,
  key: MealCategoryKey,
): string {
  const mapped = identity.categoryIdByKey.get(key);
  if (mapped !== undefined) {
    return mapped;
  }
  const first = identity.categoryIdByKey.values().next();
  return first.done === true ? '' : first.value;
}

/** Rewrites the profile and category references of a remote meal document. */
export function remapMealEntryPayload(
  payload: Record<string, unknown>,
  identity: LocalIdentity,
): Record<string, unknown> {
  const entry = mealEntryFromPayload(payload);
  return {
    ...mealEntryToPayload(entry),
    localProfileId: identity.profileId,
    mealCategoryId: categoryIdForKey(identity, entry.mealCategoryKey),
  };
}

/** Rewrites the profile reference of a remote template document. */
export function remapTemplatePayload(
  payload: Record<string, unknown>,
  identity: LocalIdentity,
): Record<string, unknown> {
  return { ...payload, localProfileId: identity.profileId };
}

/** Rewrites the profile and category references of a remote reminder document. */
export function remapReminderPayload(
  payload: Record<string, unknown>,
  identity: LocalIdentity,
): Record<string, unknown> {
  const reminder = reminderFromPayload(payload);
  return {
    ...reminderToPayload(reminder),
    localProfileId: identity.profileId,
    mealCategoryId: categoryIdForKey(identity, reminder.mealCategoryKey),
  };
}

/** Rewrites the profile reference of a remote preferences document. */
export function remapPreferencesPayload(
  payload: Record<string, unknown>,
  identity: LocalIdentity,
): Record<string, unknown> {
  return { ...payload, localProfileId: identity.profileId };
}

/** Rewrites the parent meal reference of a remote photograph document. */
export function remapPhotoPayload(
  payload: Record<string, unknown>,
  mealEntryId: string,
): Record<string, unknown> {
  return { ...mealPhotoToPayload(mealPhotoFromPayload(payload)), mealEntryId };
}


/** Shared (account-wide) preference fields; everything else is device specific. */
export const SHARED_PREFERENCE_FIELDS = [
  'timeZone',
  'showSnackCards',
  'remindersEnabled',
  'use12HourClock',
] as const;

/**
 * Applies the shared fields of a remote preferences document to the local row.
 * The synchronization switch, the schedule, the consent flag and the
 * onboarding state belong to this installation and are never overwritten.
 */
export function mergeSharedPreferences(
  local: AppPreferences,
  remote: AppPreferences,
): AppPreferences {
  return {
    ...local,
    timeZone: remote.timeZone,
    showSnackCards: remote.showSnackCards,
    remindersEnabled: remote.remindersEnabled,
    use12HourClock: remote.use12HourClock,
    updatedAt: remote.updatedAt,
    syncStatus: SyncStatus.Synced,
  };
}

/**
 * Merges a remote profile document into the local profile row without touching
 * the local id: the provider identity is unique per SQLite schema, so inserting
 * a second row for the same Google account would fail.
 */
export function mergeProfileFromRemote(local: UserProfile, remote: UserProfile): UserProfile {
  return {
    ...local,
    providerType:
      local.providerType === ProviderType.None ? remote.providerType : local.providerType,
    providerUserId: local.providerUserId === '' ? remote.providerUserId : local.providerUserId,
    displayName: remote.displayName === '' ? local.displayName : remote.displayName,
    email: remote.email === '' ? local.email : remote.email,
    timeZone: remote.timeZone === '' ? local.timeZone : remote.timeZone,
    updatedAt: remote.updatedAt === '' ? local.updatedAt : remote.updatedAt,
    syncStatus: SyncStatus.Synced,
  };
}

/**
 * True when a meal slot row holds something the user entered. Such a row is
 * never replaced by a remote record under another id: both versions are kept in
 * ConflictRecord instead.
 */
export function hasMealUserContent(entry: MealEntry): boolean {
  return (
    entry.title.trim() !== '' ||
    entry.ingredients.trim() !== '' ||
    entry.status !== MealStatus.Pending ||
    entry.completedAt !== null
  );
}
