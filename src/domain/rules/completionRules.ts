// Port of DietTracker.Core.BusinessRules.CompletionRules.
//
// The three states are always set by the user, never inferred: DONE when the
// green check is pressed, MISSED when the red cross is pressed. Time alone never
// reclassifies a meal - a skipped day stays pending forever. The date decides
// whether a change is allowed: today and past are fully editable, a future meal
// is locked in PENDING (spec 5.3).

import { MealStatus } from '../enums';
import { MealEntry } from '../models';

/** Outcome of a state transition. */
export interface CompletionOutcome {
  /** True when the entry was actually modified (false for repeated no-op calls). */
  changed: boolean;
  /** Stable reason code for the caller to localize if needed. */
  reason:
    | 'completed'
    | 'marked-missed'
    | 'future-locked'
    | 'already-done'
    | 'already-missed'
    | 'empty-content';
}

function noChange(reason: CompletionOutcome['reason']): CompletionOutcome {
  return { changed: false, reason };
}

/**
 * True when the meal's calendar date lies beyond today (local wall clock),
 * which locks the meal in PENDING.
 */
export function isFutureMeal(entry: MealEntry, now: Date): boolean {
  return entry.date > toLocalDateString(now);
}

/** Local date as 'yyyy-MM-dd' (the storage convention for dates). */
export function toLocalDateString(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Marks the meal as DONE and records the completion timestamp. Allowed for today
 * and past dates only. A meal with neither title nor description is refused
 * ("empty-content") - the card shows the "edit the meal first" dialog. Repeated
 * calls are idempotent: the original timestamp is preserved (spec 5.3).
 */
export function markDone(entry: MealEntry, now: Date): CompletionOutcome {
  if (isFutureMeal(entry, now)) {
    return noChange('future-locked');
  }
  if (entry.status === MealStatus.Done) {
    return noChange('already-done');
  }
  if (entry.title.trim() === '' && entry.ingredients.trim() === '') {
    return noChange('empty-content');
  }
  entry.status = MealStatus.Done;
  entry.completedAt = now.toISOString();
  entry.updatedAt = now.toISOString();
  entry.revision += 1;
  return { changed: true, reason: 'completed' };
}

/**
 * Marks the meal as MISSED and clears the completion timestamp. Allowed for
 * today and past dates only. MISSED is sticky: pressing the cross again does
 * nothing, it never cycles back to pending.
 */
export function markMissed(entry: MealEntry, now: Date): CompletionOutcome {
  if (isFutureMeal(entry, now)) {
    return noChange('future-locked');
  }
  if (entry.status === MealStatus.Missed) {
    return noChange('already-missed');
  }
  entry.status = MealStatus.Missed;
  entry.completedAt = null;
  entry.updatedAt = now.toISOString();
  entry.revision += 1;
  return { changed: true, reason: 'marked-missed' };
}