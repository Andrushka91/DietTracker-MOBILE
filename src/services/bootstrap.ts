// Application bootstrap - the mobile equivalent of the Windows start-up path:
// open/migrate the database, heal the five permanent categories, ensure the
// local guest profile + preferences exist, then start connectivity watching
// and the sync triggers (spec 1.2, 5.1, 6.1).

import { ProviderType, SyncFrequency, SyncStatus } from '../domain/enums';
import { AppPreferences, UserProfile } from '../domain/models';
import { newGuid } from '../domain/rules/mealSlotRules';
import { getDb } from '../data/database';
import {
  getActiveProfile,
  getCategories,
  getPreferences,
  upsertPreferences,
  upsertProfile,
} from '../data/repositories';
import { ensureCategories } from './mealTracking';
import { startConnectivityWatch } from './connectivity';

export interface BootResult {
  profile: UserProfile;
  preferences: AppPreferences;
}

/**
 * Prepares the local database for use. Safe to call multiple times; runs
 * before the first screen renders (spinner while busy, spec 8.1).
 */
export async function bootstrapApp(): Promise<BootResult> {
  await getDb();
  await ensureCategories();

  let profile = await getActiveProfile();
  if (profile === null) {
    const now = new Date().toISOString();
    profile = {
      id: newGuid(),
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
    };
    await upsertProfile(profile);
  }

  let preferences = await getPreferences(profile.id);
  if (preferences === null) {
    preferences = defaultPreferences(profile.id);
    await upsertPreferences(preferences);
  }

  // First launch opens the app itself (spec change): the onboarding wall asked
  // for a Google account before the first meal, which is a sign-in prompt
  // nobody wants. Guest mode is the default, the account is connected later
  // from Settings - the one place where synchronization is needed - and any
  // records created before that are adopted by the account on sign-in.
  if (!preferences.onboardingCompleted) {
    preferences = { ...preferences, onboardingCompleted: true, updatedAt: new Date().toISOString() };
    await upsertPreferences(preferences);
  }

  // Categories may exist but be incomplete (partial restore) - heal again.
  const categories = await getCategories();
  if (categories.length < 5) {
    await ensureCategories();
  }

  startConnectivityWatch();
  return { profile, preferences };
}

/** Windows default preferences (spec 8.8 / AppPreferences model). */
export function defaultPreferences(profileId: string): AppPreferences {
  return {
    localProfileId: profileId,
    timeZone: '',
    showSnackCards: true,
    startWithWindows: false,
    minimizeToTray: false,
    remindersEnabled: true,
    use12HourClock: false,
    synchronizationEnabled: false,
    syncFrequency: SyncFrequency.Weekly,
    preferredProvider: ProviderType.None,
    cloudUploadConsentGranted: false,
    onboardingCompleted: false,
    updatedAt: new Date().toISOString(),
    syncStatus: SyncStatus.PendingUpload,
  };
}