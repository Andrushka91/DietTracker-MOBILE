// .dtbackup export/restore (spec 12.3) - a ZIP containing backup.json
// (manifest: schemaVersion, createdAt, non-identifying deviceId, arrays meals,
// templates, reminders, photos in the SAME versioned record format as the
// cloud payload) plus the photo files. Restore MERGES (never destructive),
// refuses a newer schema clearly, and missing photo bytes never corrupt meals.

import JSZip from 'jszip';
import RNFS from '../platform/fs';

import { CLOUD_SCHEMA_VERSION, EntityType } from '../domain/enums';
import { sha256OfBase64 } from '../domain/hashing';
import {
  encodePayload,
  mealEntryFromPayload,
  mealPhotoFromPayload,
  mealTemplateFromPayload,
  reminderFromPayload,
} from '../domain/payloads';
import { newGuid } from '../domain/rules/mealSlotRules';
import { dataRoot } from './database';
import {
  getAllPhotos,
  getActiveProfile,
  getMealsInRange,
  getPreferences,
  getReminders,
  getTemplates,
  insertPhoto,
  upsertMeal,
  upsertPreferences,
  upsertProfile,
  upsertReminder,
  upsertTemplate,
} from './repositories';
import { originalPath, photosDir } from './photoStore';

export interface BackupManifest {
  schemaVersion: number;
  createdAt: string;
  /** Non-identifying installation id (never the e-mail or account id). */
  deviceId: string;
  meals: Array<Record<string, unknown>>;
  templates: Array<Record<string, unknown>>;
  reminders: Array<Record<string, unknown>>;
  photos: Array<Record<string, unknown>>;
}

export interface BackupCounts {
  meals: number;
  templates: number;
  reminders: number;
  photos: number;
}

export interface RestoreResult extends BackupCounts {
  /** Photos whose bytes were missing from the archive (meals stay intact). */
  missingPhotoFiles: number;
}

export function backupsDir(): string {
  return `${dataRoot()}/backups`;
}

/** Suggested file name: diettracker-yyyyMMdd.dtbackup (spec 12.1). */
export function backupFileName(now: Date): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `diettracker-${y}${m}${d}.dtbackup`;
}

/**
 * Writes a .dtbackup archive and returns its absolute path. Works with no
 * account (Guest Mode) - spec 7.6.
 */
export async function createBackup(deviceId: string): Promise<{ path: string; counts: BackupCounts }> {
  const profile = await getActiveProfile();
  const profileId = profile?.id ?? '';
  const allMeals = profileId === '' ? [] : await allMealsOf(profileId);
  const templates = await getTemplates();
  const reminders = profileId === '' ? [] : await getReminders(profileId);
  const photos = await getAllPhotos();

  const manifest: BackupManifest = {
    schemaVersion: CLOUD_SCHEMA_VERSION,
    createdAt: new Date().toISOString(),
    deviceId,
    meals: allMeals.map((m) => encodePayload(EntityType.MealEntry, m)),
    templates: templates.map((t) => encodePayload(EntityType.MealTemplate, t)),
    reminders: reminders.map((r) => encodePayload(EntityType.ReminderSettings, r)),
    photos: photos.map((p) => encodePayload(EntityType.MealPhoto, p)),
  };

  const zip = new JSZip();
  zip.file('backup.json', JSON.stringify(manifest, null, 2));
  for (const photo of photos) {
    try {
      const path = originalPath(photo.localFileId);
      if (await RNFS.exists(path)) {
        const base64 = await RNFS.readFile(path, 'base64');
        zip.file(`photos/${photo.localFileId}`, base64, { base64: true });
      }
    } catch (error) {
      console.warn('[backup] photo skipped', photo.id, error);
    }
  }

  const archiveBase64 = await zip.generateAsync({ type: 'base64' });
  const dir = backupsDir();
  if (!(await RNFS.exists(dir))) {
    await RNFS.mkdir(dir);
  }
  const target = `${dir}/${backupFileName(new Date())}`;
  await RNFS.writeFile(target, archiveBase64, 'base64');

  return {
    path: target,
    counts: {
      meals: manifest.meals.length,
      templates: manifest.templates.length,
      reminders: manifest.reminders.length,
      photos: manifest.photos.length,
    },
  };
}

async function allMealsOf(profileId: string) {
  // Whole history: a range wide enough for any realistic data set.
  return getMealsInRange(profileId, '0001-01-01', '9999-12-31');
}

/** Reads a manifest without restoring (used by the confirm dialog). */
export async function previewBackup(path: string): Promise<BackupManifest> {
  const archive = await JSZip.loadAsync(await RNFS.readFile(path, 'base64'), { base64: true });
  const entry = archive.file('backup.json');
  if (entry === null) {
    throw new Error('backup.missing.manifest');
  }
  return JSON.parse(await entry.async('string')) as BackupManifest;
}

/**
 * Merges a .dtbackup archive into the device. Records are merged by
 * identifier - nothing is ever deleted. A manifest with a newer schema than
 * understood is refused ('backup.schema.newer'); photos whose bytes are
 * missing must not corrupt meals (they are counted and skipped).
 */
export async function restoreBackup(path: string): Promise<RestoreResult> {
  const archive = await JSZip.loadAsync(await RNFS.readFile(path, 'base64'), { base64: true });
  const manifestEntry = archive.file('backup.json');
  if (manifestEntry === null) {
    throw new Error('backup.missing.manifest');
  }
  const manifest = JSON.parse(await manifestEntry.async('string')) as BackupManifest;
  if (manifest.schemaVersion > CLOUD_SCHEMA_VERSION) {
    throw new Error('backup.schema.newer');
  }

  const profile = await getActiveProfile();
  const profileId = profile?.id ?? '';

  const counts: RestoreResult = {
    meals: 0,
    templates: 0,
    reminders: 0,
    photos: 0,
    missingPhotoFiles: 0,
  };

  for (const raw of manifest.meals ?? []) {
    const meal = mealEntryFromPayload(raw);
    if (meal.id !== '') {
      // Merge by identifier: rows the device already has are replaced with the
      // backup copy, unknown rows are added - nothing is deleted.
      await upsertMeal(meal);
      counts.meals += 1;
    }
  }
  for (const raw of manifest.templates ?? []) {
    const template = mealTemplateFromPayload(raw);
    if (template.id !== '') {
      await upsertTemplate(template);
      counts.templates += 1;
    }
  }
  if (profileId !== '') {
    for (const raw of manifest.reminders ?? []) {
      const reminder = reminderFromPayload(raw);
      if (reminder.id !== '') {
        await upsertReminder({ ...reminder, localProfileId: profileId });
        counts.reminders += 1;
      }
    }
  }

  // Photos: metadata rows first, then best-effort bytes (spec 12.3).
  const existing = new Set((await getAllPhotos()).map((p) => p.id));
  for (const raw of manifest.photos ?? []) {
    const photo = mealPhotoFromPayload(raw);
    if (photo.id === '' || existing.has(photo.id)) {
      continue;
    }
    const entry = archive.file(`photos/${photo.localFileId}`);
    if (entry !== null) {
      try {
        const base64 = await entry.async('base64');
        if (!(await RNFS.exists(photosDir()))) {
          await RNFS.mkdir(photosDir());
        }
        await RNFS.writeFile(originalPath(photo.localFileId), base64, 'base64');
        if (photo.contentHash === '') {
          photo.contentHash = sha256OfBase64(base64);
        }
      } catch (error) {
        console.warn('[backup] photo bytes skipped', photo.id, error);
        counts.missingPhotoFiles += 1;
      }
    } else {
      counts.missingPhotoFiles += 1;
    }
    await insertPhoto(photo);
    counts.photos += 1;
  }

  return counts;
}

/** Exports the active preferences + profile rows (kept outside the arrays). */
export async function exportProfileData(): Promise<void> {
  const profile = await getActiveProfile();
  if (profile !== null) {
    await upsertProfile(profile);
    const prefs = await getPreferences(profile.id);
    if (prefs !== null) {
      await upsertPreferences(prefs);
    }
  }
}

/** Convenience for the restore flow: new ids are never regenerated. */
export function stableId(id: string): string {
  return id === '' ? newGuid() : id;
}