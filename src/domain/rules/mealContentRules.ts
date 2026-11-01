// Port of DietTracker.Core.BusinessRules.MealContentRules.
//
// Placeholder rows (materialized empty cards) carry no user content and are
// skipped during synchronization, which keeps cloud traffic and the journal
// small (spec 7.3).

import { MealStatus } from '../enums';
import { MealEntry } from '../models';

/** True when the slot holds anything the user typed, attached or confirmed. */
export function hasUserContent(
  entry: MealEntry | null | undefined,
  photoCount = 0,
): boolean {
  if (entry === null || entry === undefined) {
    return false;
  }
  return (
    entry.status !== MealStatus.Pending ||
    entry.completedAt !== null ||
    entry.title.trim() !== '' ||
    entry.ingredients.trim() !== '' ||
    photoCount > 0 ||
    entry.plannedTime !== null
  );
}

/**
 * True when the slot holds what the DONE / MISSED rules actually require: a
 * title or a description.
 *
 * A photograph, a planned time or an already-set state are NOT enough - the meal
 * was never described, so the user cannot have eaten "it". Every bulk action
 * ("Mark all DONE" / "Mark all MISSED") and the card's ✓ / ✕ buttons use this,
 * so an untouched card can never be turned green (or red) by accident.
 */
export function hasMealText(entry: MealEntry | null | undefined): boolean {
  if (entry === null || entry === undefined) {
    return false;
  }
  return entry.title.trim() !== '' || entry.ingredients.trim() !== '';
}

/** True when the slot is a pure placeholder and may be skipped during sync. */
export function isPlaceholder(
  entry: MealEntry | null | undefined,
  photoCount = 0,
): boolean {
  return !hasUserContent(entry, photoCount);
}