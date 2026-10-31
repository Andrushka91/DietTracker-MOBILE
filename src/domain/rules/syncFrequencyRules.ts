// Port of DietTracker.Core.BusinessRules.SyncFrequencyRules (spec 8.8).

import { SyncFrequency } from '../enums';

/** Distance between two weekly cycles. */
export const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
/** Distance between two monthly cycles. */
export const MONTH_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * How long the app waits between automatic cycles, or null when the frequency
 * means "never automatically" (only the explicit button synchronizes).
 */
export function cadence(frequency: SyncFrequency): number | null {
  switch (frequency) {
    case SyncFrequency.Weekly:
      return WEEK_MS;
    case SyncFrequency.Monthly:
      return MONTH_MS;
    default:
      return null;
  }
}

/**
 * True when an automatic cycle may run once 'ageMs' has gone by. Never
 * synchronized before: the first cycle is always due (sign-in, first launch).
 */
export function isDue(frequency: SyncFrequency, lastSuccessfulSyncAgeMs: number | null): boolean {
  const period = cadence(frequency);
  if (period === null) {
    return false;
  }
  if (lastSuccessfulSyncAgeMs === null) {
    return true;
  }
  return lastSuccessfulSyncAgeMs >= period;
}

/**
 * True when the passive download of an open app may contact the cloud.
 *
 * The passive download exists so that the other device's changes appear within
 * a minute instead of within a week, so it deliberately ignores the schedule of
 * Settings. "Only with the button below" is the one choice it honours: there the
 * user asked for no automatic cloud traffic at all.
 */
export function isPassivePullAllowed(frequency: SyncFrequency): boolean {
  return frequency !== SyncFrequency.Manual;
}
