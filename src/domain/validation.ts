// Port of DietTracker.Core.Validation - stable localizable failure codes are
// part of the UI contract (the resw keys Error_* map to them).

import { MealStatus } from './enums';
import { MealEntry, MealTemplate } from './models';
import { isPermanent } from './rules/mealSlotRules';
import {
  MAX_PHOTO_BYTES,
  hasValidSignature,
  mimeTypeFromExtension,
} from './rules/photoRules';

/** A single validation failure; code is stable and localizable. */
export interface ValidationFailure {
  /** Stable reason code, for example 'meal.title.required'. */
  code: string;
  /** Name of the offending field. */
  field: string;
  /** Developer friendly message (English), used in logs and tests. */
  message: string;
}

/** Result of validating a domain object before it is persisted. */
export class ValidationResult {
  readonly failures: ValidationFailure[];

  private constructor(failures: ValidationFailure[]) {
    this.failures = failures;
  }

  get isValid(): boolean {
    return this.failures.length === 0;
  }

  static success(): ValidationResult {
    return new ValidationResult([]);
  }

  static failure(failures: ValidationFailure[]): ValidationResult {
    return new ValidationResult(failures);
  }

  /** Combines several results, keeping every failure. */
  static combine(...results: ValidationResult[]): ValidationResult {
    return new ValidationResult(results.flatMap((r) => r.failures));
  }

  toLogString(): string {
    return this.failures.map((f) => `${f.code} (${f.field})`).join('; ');
  }
}

export const MAX_TITLE_LENGTH = 120;
export const MAX_INGREDIENTS_LENGTH = 2000;

/**
 * Validates a daily meal entry before it is written to SQLite.
 * 'requireContent' mirrors Windows: editors require title + description; the
 * clear action passes false because it deliberately writes the empty placeholder.
 */
export function validateMealEntry(entry: MealEntry, requireContent = true): ValidationResult {
  const failures: ValidationFailure[] = [];

  if (!isPermanent(entry.mealCategoryKey)) {
    failures.push({
      code: 'meal.category.invalid',
      field: 'mealCategoryKey',
      message: 'Meal category is not one of the five permanent slots.',
    });
  }
  if (entry.mealCategoryId === '') {
    failures.push({
      code: 'meal.category.missing',
      field: 'mealCategoryId',
      message: 'Meal entry is not linked to a permanent category.',
    });
  }
  if (entry.localProfileId === '') {
    failures.push({
      code: 'meal.profile.missing',
      field: 'localProfileId',
      message: 'Meal entry is not linked to a local profile.',
    });
  }

  if (requireContent) {
    if (entry.title.trim() === '') {
      failures.push({ code: 'meal.title.required', field: 'title', message: 'A meal needs a title.' });
    }
    if (entry.ingredients.trim() === '') {
      failures.push({
        code: 'meal.ingredients.required',
        field: 'ingredients',
        message: 'A meal needs a description.',
      });
    }
  }

  if (entry.title.length > MAX_TITLE_LENGTH) {
    failures.push({
      code: 'meal.title.tooLong',
      field: 'title',
      message: `Title must not exceed ${MAX_TITLE_LENGTH} characters.`,
    });
  }
  if (entry.ingredients.length > MAX_INGREDIENTS_LENGTH) {
    failures.push({
      code: 'meal.ingredients.tooLong',
      field: 'ingredients',
      message: `Description must not exceed ${MAX_INGREDIENTS_LENGTH} characters.`,
    });
  }

  if (entry.status === MealStatus.Done && entry.completedAt === null) {
    failures.push({
      code: 'meal.completedAt.missing',
      field: 'completedAt',
      message: 'A completed meal must carry a completion timestamp.',
    });
  }
  if (entry.status !== MealStatus.Done && entry.completedAt !== null) {
    failures.push({
      code: 'meal.completedAt.unexpected',
      field: 'completedAt',
      message: 'Only completed meals may carry a completion timestamp.',
    });
  }

  return failures.length === 0 ? ValidationResult.success() : ValidationResult.failure(failures);
}

/**
 * Validates extension, declared size and the file signature before a photo is
 * copied into the local photo store (spec 5.6).
 */
export function validatePhoto(
  fileName: string,
  sizeBytes: number,
  header: Uint8Array,
): ValidationResult {
  const failures: ValidationFailure[] = [];
  const dot = fileName.lastIndexOf('.');
  const extension = dot >= 0 ? fileName.slice(dot) : '';
  const mime = mimeTypeFromExtension(extension);

  if (mime === null) {
    return ValidationResult.failure([
      {
        code: 'photo.format.unsupported',
        field: 'fileName',
        message: 'Only JPEG, PNG and WEBP images are supported.',
      },
    ]);
  }
  if (sizeBytes <= 0) {
    failures.push({ code: 'photo.empty', field: 'sizeBytes', message: 'The selected file is empty.' });
  } else if (sizeBytes > MAX_PHOTO_BYTES) {
    failures.push({
      code: 'photo.tooLarge',
      field: 'sizeBytes',
      message: 'The selected file exceeds the 10 MB limit.',
    });
  }
  if (!hasValidSignature(mime, header)) {
    failures.push({
      code: 'photo.content.invalid',
      field: 'header',
      message: 'The file content does not match its image format.',
    });
  }
  return failures.length === 0 ? ValidationResult.success() : ValidationResult.failure(failures);
}

/** Validates that another photograph may be attached to a meal. */
export function validatePhotoSlot(currentPhotoCount: number, maxPhotos: number): ValidationResult {
  if (currentPhotoCount < maxPhotos) {
    return ValidationResult.success();
  }
  return ValidationResult.failure([
    {
      code: 'photo.limit.reached',
      field: 'currentPhotoCount',
      message: `A meal can hold at most ${maxPhotos} photographs.`,
    },
  ]);
}

/**
 * Identical photographs are never stored twice per meal: the second upload is
 * refused so the user can be told the photo is already there.
 */
export function validatePhotoDuplicate(alreadyAttached: boolean): ValidationResult {
  if (alreadyAttached) {
    return ValidationResult.failure([
      {
        code: 'photo.duplicate',
        field: 'alreadyAttached',
        message: 'The same photograph is already attached to this meal.',
      },
    ]);
  }
  return ValidationResult.success();
}

export const MIN_SNOOZE_MINUTES = 1;
export const MAX_SNOOZE_MINUTES = 120;
export const MAX_TEMPLATE_NAME_LENGTH = 100;

/** Validates reminder configuration (spec 10.1). */
export function validateReminder(settings: {
  weekdays: number;
  snoozeMinutes: number | null;
  mealCategoryId: string;
}): ValidationResult {
  const failures: ValidationFailure[] = [];
  if (settings.weekdays === 0) {
    failures.push({
      code: 'reminder.weekdays.empty',
      field: 'weekdays',
      message: 'Select at least one weekday or disable the reminder.',
    });
  }
  if ((settings.weekdays & ~0b1111111) !== 0) {
    failures.push({
      code: 'reminder.weekdays.invalid',
      field: 'weekdays',
      message: 'Weekday mask contains undefined bits.',
    });
  }
  if (
    settings.snoozeMinutes !== null &&
    (settings.snoozeMinutes < MIN_SNOOZE_MINUTES || settings.snoozeMinutes > MAX_SNOOZE_MINUTES)
  ) {
    failures.push({
      code: 'reminder.snooze.outOfRange',
      field: 'snoozeMinutes',
      message: `Snooze must be between ${MIN_SNOOZE_MINUTES} and ${MAX_SNOOZE_MINUTES} minutes.`,
    });
  }
  if (settings.mealCategoryId === '') {
    failures.push({
      code: 'reminder.category.missing',
      field: 'mealCategoryId',
      message: 'Reminder is not linked to a permanent meal category.',
    });
  }
  return failures.length === 0 ? ValidationResult.success() : ValidationResult.failure(failures);
}

/** Validates templates before they are stored. */
export function validateTemplate(template: MealTemplate): ValidationResult {
  const failures: ValidationFailure[] = [];
  if (template.name.trim() === '') {
    failures.push({
      code: 'template.name.required',
      field: 'name',
      message: 'Template name is required.',
    });
  } else if (template.name.length > MAX_TEMPLATE_NAME_LENGTH) {
    failures.push({
      code: 'template.name.tooLong',
      field: 'name',
      message: `Template name must not exceed ${MAX_TEMPLATE_NAME_LENGTH} characters.`,
    });
  }
  if (template.isFullDay && template.templateDay.length === 0) {
    failures.push({
      code: 'template.day.empty',
      field: 'templateDay',
      message: 'A full-day template must contain at least one meal.',
    });
  }
  if (!template.isFullDay && (template.templateMeal === null || template.templateMealSlot === null)) {
    failures.push({
      code: 'template.meal.empty',
      field: 'templateMeal',
      message: 'A single-meal template must carry meal content.',
    });
  }
  return failures.length === 0 ? ValidationResult.success() : ValidationResult.failure(failures);
}