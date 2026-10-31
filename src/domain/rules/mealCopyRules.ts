// Port of DietTracker.Core.BusinessRules.MealCopyRules (spec 5.7).
//
// Copied content always starts as PENDING: completion state, completion
// timestamps and photographic evidence are deliberately not copied.

import { MealStatus, SyncStatus } from '../enums';
import {
  MealEntry,
  MealTemplate,
  MealTemplateContent,
} from '../models';
import { newGuid } from './mealSlotRules';

/** Creates a new PENDING entry for targetDate from source. Never mutates source. */
export function copyMealToDate(
  source: MealEntry,
  targetDate: string,
  targetProfileId: string,
  now: Date,
): MealEntry {
  return {
    id: newGuid(),
    localProfileId: targetProfileId,
    date: targetDate,
    mealCategoryId: source.mealCategoryId,
    mealCategoryKey: source.mealCategoryKey,
    title: source.title,
    ingredients: source.ingredients,
    plannedTime: source.plannedTime,
    status: MealStatus.Pending,
    completedAt: null,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    revision: 0,
    syncStatus: SyncStatus.PendingUpload,
    cloudRevision: null,
    contentHash: null,
  };
}

/**
 * Copies a whole day onto another date. Only slots present in sourceMeals are
 * produced; missing slots stay untouched so callers can merge with existing
 * content.
 */
export function copyDayToDate(
  sourceMeals: MealEntry[],
  targetDate: string,
  targetProfileId: string,
  now: Date,
): MealEntry[] {
  return sourceMeals.map((m) => copyMealToDate(m, targetDate, targetProfileId, now));
}

/** Projects an entry onto template content, dropping all consumption evidence. */
export function toTemplateContent(entry: MealEntry): MealTemplateContent {
  return {
    mealCategoryKey: entry.mealCategoryKey,
    title: entry.title,
    ingredients: entry.ingredients,
    plannedTime: entry.plannedTime,
  };
}

/** Creates a reusable single-meal template from a daily entry. */
export function createTemplate(source: MealEntry, name: string, now: Date): MealTemplate {
  return {
    id: newGuid(),
    localProfileId: source.localProfileId,
    name,
    isFullDay: false,
    templateMealSlot: source.mealCategoryKey,
    templateMeal: toTemplateContent(source),
    templateDay: [],
    recurrenceRules: null,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    syncStatus: SyncStatus.PendingUpload,
  };
}

/** Creates a reusable full-day template from up to five daily entries. */
export function createDayTemplate(
  sourceMeals: MealEntry[],
  profileId: string,
  name: string,
  now: Date,
): MealTemplate {
  const ordered = [...sourceMeals].sort((a, b) => a.mealCategoryKey - b.mealCategoryKey);
  return {
    id: newGuid(),
    localProfileId: profileId,
    name,
    isFullDay: true,
    templateMealSlot: null,
    templateMeal: null,
    templateDay: ordered.map(toTemplateContent),
    recurrenceRules: null,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    syncStatus: SyncStatus.PendingUpload,
  };
}

/**
 * Materializes template content into a concrete PENDING meal entry for a date
 * (applying a template merges: only slots present in the template are produced).
 */
export function applyTemplateContent(
  content: MealTemplateContent,
  categoryId: string,
  targetDate: string,
  profileId: string,
  now: Date,
): MealEntry {
  return {
    id: newGuid(),
    localProfileId: profileId,
    date: targetDate,
    mealCategoryId: categoryId,
    mealCategoryKey: content.mealCategoryKey,
    title: content.title,
    ingredients: content.ingredients,
    plannedTime: content.plannedTime,
    status: MealStatus.Pending,
    completedAt: null,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    revision: 0,
    syncStatus: SyncStatus.PendingUpload,
    cloudRevision: null,
    contentHash: null,
  };
}