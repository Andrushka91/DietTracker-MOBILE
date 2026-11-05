// A NARROW wrapper around the existing single-day `applyTemplate`.
//
// "Apply template" now takes an INCLUSIVE range of local days. The day applier
// itself is NOT reimplemented here: this module only walks the range and calls
// that one primitive once per date, sequentially (never Promise.all), so the
// existing merge/slot/journal/sync behaviour stays the single source of truth.
//
// What it deliberately does NOT do:
//
//   * no transaction over the whole range - each day writes its own meals, so a
//     day that rejects may already have written some of them. A failure is
//     reported as a PARTIAL result (completed days, the date that failed, how
//     many days were never attempted), never as a clean rollback;
//   * no automatic retry of the failed day or of the remaining days;
//   * no maximum range and no silent truncation - the walk ends at the END date
//     the user chose, and nothing else.
//
// Day keys stay LOCAL 'yyyy-MM-dd' strings from the app's own `addDays`. UTC
// ordinals are used for ONE thing only - counting the inclusive day span - so a
// DST change can never make a day disappear from (or duplicate in) that count.

import { addDays } from '../domain/analytics';
import { isCalendarDate } from '../ui/dates';

/** The inclusive range the user chose, both endpoints included. */
export interface TemplateDateRange {
  startDate: string;
  endDate: string;
}

/** Why a range cannot be applied at all, or null when it can. */
export type TemplateRangeProblem = 'invalid-start' | 'invalid-end' | 'end-before-start';

/**
 * A calendar ordinal (days since the epoch) used ONLY for arithmetic on the
 * count. It never converts a selected day into a different date key.
 */
function ordinal(iso: string): number {
  const [year, month, day] = iso.split('-').map(Number);
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day);
  return date.getTime() / 86400000;
}

/**
 * Both endpoints must be real calendar days and the end must not precede the
 * start. Nothing is swapped or extended silently - a reversed range is an error
 * the user corrects.
 */
export function validateTemplateRange(range: TemplateDateRange): TemplateRangeProblem | null {
  if (!isCalendarDate(range.startDate)) {
    return 'invalid-start';
  }
  if (!isCalendarDate(range.endDate)) {
    return 'invalid-end';
  }
  if (range.endDate < range.startDate) {
    return 'end-before-start';
  }
  return null;
}

/**
 * How many days the range covers, BOTH ends included: the same start and end is
 * one day, not zero. Only call this for a range that passed validation.
 */
export function templateRangeDays(range: TemplateDateRange): number {
  return ordinal(range.endDate) - ordinal(range.startDate) + 1;
}

/**
 * The outcome of a range run.
 *
 * `partial` means: the days before `failedDate` were applied, `failedDate`
 * itself MAY be partly written (the single-day applier can fail between meals),
 * and every day after it was never attempted. There is no rollback claim here,
 * and no retry is scheduled.
 */
export type TemplateRangeResult =
  | {
      kind: 'complete';
      totalDays: number;
      completedDays: number;
      lastCompletedDate: string;
    }
  | {
      kind: 'partial';
      totalDays: number;
      completedDays: number;
      lastCompletedDate: string | null;
      failedDate: string;
      failedDayMayBePartial: true;
      unattemptedDays: number;
      cause: unknown;
    };

/**
 * Applies one template to every day from `startDate` THROUGH `endDate`.
 *
 * The caller owns the synchronous "already running" guard: this function never
 * runs two days at once, and it stops at the first rejection.
 */
export async function applyTemplateRange(
  range: TemplateDateRange,
  deps: {
    /** The EXISTING single-day applier, bound to template/account/profile. */
    applyDay: (iso: string) => Promise<unknown>;
    /** Completed days so far (not meals, not syncs). */
    onProgress?: (completedDays: number, totalDays: number) => void;
  },
): Promise<TemplateRangeResult> {
  const snapshot: TemplateDateRange = { startDate: range.startDate, endDate: range.endDate };
  const problem = validateTemplateRange(snapshot);
  if (problem !== null) {
    // Nothing has been written: this is the one case that IS clean.
    throw new RangeError(problem);
  }
  const totalDays = templateRangeDays(snapshot);
  let completedDays = 0;
  let lastCompletedDate: string | null = null;
  let date = snapshot.startDate;
  deps.onProgress?.(completedDays, totalDays);
  for (;;) {
    try {
      await deps.applyDay(date);
    } catch (cause) {
      return {
        kind: 'partial',
        totalDays,
        completedDays,
        lastCompletedDate,
        failedDate: date,
        failedDayMayBePartial: true,
        unattemptedDays: totalDays - completedDays - 1,
        cause,
      };
    }
    completedDays += 1;
    lastCompletedDate = date;
    deps.onProgress?.(completedDays, totalDays);
    if (date === snapshot.endDate) {
      break;
    }
    date = addDays(date, 1);
  }
  return { kind: 'complete', totalDays, completedDays, lastCompletedDate: snapshot.endDate };
}
