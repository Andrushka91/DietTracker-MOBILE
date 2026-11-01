// Meal tracking service - port of the Windows MealTrackingService: the one
// facade the UI talks to. It materializes the five permanent slots, applies
// the completion rules, validates writes, persists immediately (offline-first)
// and journals the change for the active account (spec 5, 7.2, 8.2).

import { EntityType, MealStatus, SyncStatus } from '../domain/enums';
import { MealEntry, MealTemplate } from '../domain/models';
import {
  CompletionOutcome,
  isFutureMeal,
  markDone as markDoneRule,
  markMissed as markMissedRule,
} from '../domain/rules/completionRules';
import { applyTemplateContent, createDayTemplate, createTemplate, newGuid } from '../domain';
import { hasUserContent } from '../domain/rules/mealContentRules';
import { ALL_SLOTS, normalize } from '../domain/rules/mealSlotRules';
import { ValidationResult, validateMealEntry, validateTemplate } from '../domain/validation';
import { journalEntity } from '../cloud/journal';
import {
  getCategories,
  getMealsForDate,
  getTemplates,
  upsertCategory,
  upsertMeal,
  upsertTemplate,
} from '../data/repositories';

/** The five slots with any stored rows, materialized to exactly five cards. */
export interface DayModel {
  date: string;
  meals: MealEntry[];
}

/**
 * Ensures the five permanent category rows exist (heals a database that lost
 * a row - spec 5.1) and returns them ordered by display key.
 */
export async function ensureCategories(): Promise<Awaited<ReturnType<typeof getCategories>>> {
  const persisted = await getCategories();
  const healed = normalize(persisted);
  for (const category of healed) {
    const existing = persisted.find((c) => c.fixedCategoryKey === category.fixedCategoryKey);
    if (existing === undefined) {
      await upsertCategory(category);
    }
  }
  return getCategories();
}

/**
 * Loads one date: stored rows merged with the five defaults so exactly five
 * cards are always shown, in canonical slot order (spec 5.1/8.2).
 * Empty slots are materialized as placeholders on first edit, not on read.
 */
export async function loadDay(profileId: string, date: string): Promise<DayModel> {
  const stored = await getMealsForDate(profileId, date);
  const categories = await ensureCategories();
  const meals: MealEntry[] = ALL_SLOTS.map((key) => {
    const existing = stored.find((m) => m.mealCategoryKey === key);
    if (existing !== undefined) {
      return existing;
    }
    const category = categories.find((c) => c.fixedCategoryKey === key);
    const now = new Date().toISOString();
    return {
      id: newGuid(),
      localProfileId: profileId,
      date,
      mealCategoryId: category?.id ?? '',
      mealCategoryKey: key,
      title: '',
      ingredients: '',
      plannedTime: null,
      status: MealStatus.Pending,
      completedAt: null,
      createdAt: now,
      updatedAt: now,
      revision: 0,
      syncStatus: SyncStatus.PendingUpload,
      cloudRevision: null,
      contentHash: null,
    };
  });
  return { date, meals };
}

export interface SaveResult {
  ok: boolean;
  validation?: ValidationResult;
}

/**
 * Validates + persists one meal. The card keeps its editor open on failure
 * (validation returned to the caller, spec 8.3).
 */
export async function saveMeal(
  entry: MealEntry,
  accountId: string | null,
  requireContent = true,
): Promise<SaveResult> {
  const validation = validateMealEntry(entry, requireContent);
  if (!validation.isValid) {
    return { ok: false, validation };
  }
  const now = new Date().toISOString();
  const toStore: MealEntry = {
    ...entry,
    updatedAt: now,
    syncStatus: SyncStatus.PendingUpload,
  };
  await upsertMeal(toStore);
  if (accountId !== null) {
    await journalEntity(accountId, EntityType.MealEntry, toStore.id, now);
  }
  return { ok: true };
}

/**
 * Makes sure a slot has a real row before something is attached to it.
 *
 * An untouched day slot is materialized on read with a fresh GUID (loadDay), so
 * anything pointing at that id - a photograph first of all - would be orphaned
 * by the next reload. Persisting the placeholder keeps the id stable, which is
 * what lets a photograph be added BEFORE the title or the description is
 * written ("photo first" editing, spec 8.4).
 */
export async function ensureMealStored(
  entry: MealEntry,
  accountId: string | null,
): Promise<MealEntry> {
  const stored = await getMealsForDate(entry.localProfileId, entry.date);
  if (stored.some((meal) => meal.id === entry.id)) {
    return entry;
  }
  const now = new Date().toISOString();
  const toStore: MealEntry = {
    ...entry,
    updatedAt: now,
    syncStatus: SyncStatus.PendingUpload,
  };
  await upsertMeal(toStore);
  if (accountId !== null) {
    await journalEntity(accountId, EntityType.MealEntry, toStore.id, now);
  }
  return toStore;
}

export interface CompletionResult extends CompletionOutcome {
  /** Entry refreshed from the write (timestamp etc.), when changed. */
  entry?: MealEntry;
}

/** Applies the DONE rule and persists (idempotent, future-locked, empty-check). */
export async function completeMeal(
  entry: MealEntry,
  accountId: string | null,
  now: Date,
): Promise<CompletionResult> {
  const outcome = markDoneRule(entry, now);
  if (!outcome.changed) {
    return outcome;
  }
  await saveMeal(entry, accountId, false);
  return { ...outcome, entry };
}

/** Applies the MISSED rule and persists (sticky, future-locked). */
export async function missMeal(
  entry: MealEntry,
  accountId: string | null,
  now: Date,
): Promise<CompletionResult> {
  const outcome = markMissedRule(entry, now);
  if (!outcome.changed) {
    return outcome;
  }
  await saveMeal(entry, accountId, false);
  return { ...outcome, entry };
}

export interface MarkAllResult {
  /** Meals whose state actually changed. */
  changed: number;
  /** Meals skipped because they have no content (empty placeholders). */
  skippedEmpty: number;
  /** True when the date is in the future (buttons disabled there). */
  futureLocked: boolean;
}

/**
 * Mark all DONE for a date. Empty cards are skipped and reported so the UI
 * can show the "some meals were skipped" dialog once (spec 8.2).
 */
export async function markAllDone(
  profileId: string,
  date: string,
  accountId: string | null,
  now: Date,
): Promise<MarkAllResult> {
  const day = await loadDay(profileId, date);
  let changed = 0;
  let skippedEmpty = 0;
  for (const meal of day.meals) {
    if (meal.status === MealStatus.Done) {
      continue;
    }
    if (!hasUserContent(meal)) {
      skippedEmpty += 1;
      continue;
    }
    const outcome = await completeMeal(meal, accountId, now);
    if (outcome.changed) {
      changed += 1;
    } else if (outcome.reason === 'empty-content') {
      skippedEmpty += 1;
    }
  }
  return {
    changed,
    skippedEmpty,
    futureLocked: isFutureMeal({ ...day.meals[0], date }, now),
  };
}

/** Mark all MISSED for a date (disabled on future days by the caller). */
export async function markAllMissed(
  profileId: string,
  date: string,
  accountId: string | null,
  now: Date,
): Promise<MarkAllResult> {
  const day = await loadDay(profileId, date);
  let changed = 0;
  for (const meal of day.meals) {
    if (meal.status === MealStatus.Missed) {
      continue;
    }
    const outcome = await missMeal(meal, accountId, now);
    if (outcome.changed) {
      changed += 1;
    }
  }
  return { changed, skippedEmpty: 0, futureLocked: isFutureMeal({ ...day.meals[0], date }, now) };
}

/**
 * Clear wipes text, planned time, state and photos of one meal (spec 8.3).
 * Photos are removed from the store by the caller; this writes the empty
 * placeholder row back and journals it.
 */
export async function clearMeal(
  entry: MealEntry,
  accountId: string | null,
  now: Date,
): Promise<void> {
  const cleared: MealEntry = {
    ...entry,
    title: '',
    ingredients: '',
    plannedTime: null,
    status: MealStatus.Pending,
    completedAt: null,
    updatedAt: now.toISOString(),
    revision: entry.revision + 1,
    syncStatus: SyncStatus.PendingUpload,
  };
  await upsertMeal(cleared);
  if (accountId !== null) {
    await journalEntity(accountId, EntityType.MealEntry, cleared.id, cleared.updatedAt);
  }
}

/** Saves the whole visible day as a full-day template (spec 8.2/8.7). */
export async function saveDayAsTemplate(
  profileId: string,
  date: string,
  name: string,
  accountId: string | null,
): Promise<{ ok: boolean; validation?: ValidationResult; template?: MealTemplate }> {
  const day = await loadDay(profileId, date);
  const filled = day.meals.filter((m) => hasUserContent(m));
  const template = createDayTemplate(filled, profileId, name, new Date());
  const validation = validateTemplate(template);
  if (!validation.isValid) {
    return { ok: false, validation };
  }
  const now = new Date().toISOString();
  await upsertTemplate(template);
  if (accountId !== null) {
    await journalEntity(accountId, EntityType.MealTemplate, template.id, now);
  }
  return { ok: true, template };
}

/** Saves a single meal as a template (parity with SaveTemplateAsync). */
export async function saveMealAsTemplate(
  entry: MealEntry,
  name: string,
  accountId: string | null,
): Promise<{ ok: boolean; validation?: ValidationResult; template?: MealTemplate }> {
  const template = createTemplate(entry, name, new Date());
  const validation = validateTemplate(template);
  if (!validation.isValid) {
    return { ok: false, validation };
  }
  const now = new Date().toISOString();
  await upsertTemplate(template);
  if (accountId !== null) {
    await journalEntity(accountId, EntityType.MealTemplate, template.id, now);
  }
  return { ok: true, template };
}

/**
 * Applies a template to a date: only slots present in the template are
 * produced, missing slots stay untouched (merge - spec 5.7/8.7).
 */
export async function applyTemplate(
  template: MealTemplate,
  date: string,
  accountId: string | null,
): Promise<number> {
  const categories = await ensureCategories();
  const day = await loadDay(template.localProfileId, date);
  const contents = template.isFullDay
    ? template.templateDay
    : template.templateMeal !== null
      ? [template.templateMeal]
      : [];
  const now = new Date();
  let applied = 0;
  for (const content of contents) {
    const existing = day.meals.find((m) => m.mealCategoryKey === content.mealCategoryKey);
    const category = categories.find((c) => c.fixedCategoryKey === content.mealCategoryKey);
    const entry =
      existing !== undefined && existing !== null && !hasUserContent(existing)
        ? existing
        : null;
    const target =
      entry ??
      applyTemplateContent(
        content,
        category?.id ?? '',
        date,
        template.localProfileId,
        now,
      );
    const merged: MealEntry = {
      ...target,
      title: content.title,
      ingredients: content.ingredients,
      plannedTime: content.plannedTime,
      mealCategoryId: category?.id ?? target.mealCategoryId,
      updatedAt: now.toISOString(),
      syncStatus: SyncStatus.PendingUpload,
    };
    await upsertMeal(merged);
    if (accountId !== null) {
      await journalEntity(accountId, EntityType.MealEntry, merged.id, merged.updatedAt);
    }
    applied += 1;
  }
  return applied;
}

/** Loads the template list (newest first, spec 8.7). */
export async function listTemplates(): Promise<MealTemplate[]> {
  return getTemplates();
}