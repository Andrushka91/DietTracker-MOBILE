// Port of DietTracker.Core.Analytics - ProgressCalculator + PeriodAnalytics.
//
// Percentages: day = completed / 5 * 100 (every slot counts toward the total);
// period ratios use the DECIDED denominator (completed + missed) so an untouched
// period reports no ratio instead of being dragged to 0 % (spec 5.8 / 8.6).

import { MealCategoryKey, MealStatus } from './enums';
import { MealEntry } from './models';
import { ALL_SLOTS, SLOT_COUNT } from './rules/mealSlotRules';

/** Status of one meal slot, used by dashboard grids and calendar mini cards. */
export interface MealSlotStatus {
  mealCategoryKey: MealCategoryKey;
  status: MealStatus;
  title: string;
  /** 'HH:mm:ss' or null. */
  plannedTime: string | null;
  completedAt: string | null;
  ingredients: string;
  photoCount: number;
  /** Thumbnail file name of the first photograph, '' when none. */
  firstPhotoThumbnailId: string;
}

/** Progress for a single calendar date. */
export interface DayProgress {
  /** 'yyyy-MM-dd'. */
  date: string;
  /** Always five: the number of permanent meal slots. */
  totalSlots: number;
  completed: number;
  missed: number;
  pending: number;
  /** Completed + missed - the denominator of every period ratio. */
  decided: number;
  hasDecided: boolean;
  /** completed / totalSlots * 100 (0..100, rounded to 2 decimals). */
  percentage: number;
  /** True when all five slots were confirmed. */
  isFullyCompleted: boolean;
  slots: MealSlotStatus[];
}

/** Aggregated progress for a period (week/month) plus trend information. */
export interface PeriodProgress {
  /** 'yyyy-MM-dd' inclusive range. */
  from: string;
  to: string;
  totalSlots: number;
  completed: number;
  missed: number;
  pending: number;
  decided: number;
  hasDecided: boolean;
  /** completed / decided * 100, or 0 when nothing was decided. */
  percentage: number;
  fullyCompletedDays: number;
  days: DayProgress[];
}

/** One point of a trend chart. */
export interface TrendPoint {
  date: string;
  /** Day completion percentage (completed / 5 * 100). */
  percentage: number;
  completed: number;
  missed: number;
  decided: number;
}
/** 'yyyy-MM-dd' helpers - string dates compare lexicographically. */
export function parseDate(value: string): Date {
  const [y, m, d] = value.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function formatDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function addDays(date: string, days: number): string {
  const d = parseDate(date);
  d.setDate(d.getDate() + days);
  return formatDate(d);
}

/** Monday based start of week (ISO 8601) - same as the calendar screen. */
export function startOfWeek(date: string): string {
  const d = parseDate(date);
  const delta = (d.getDay() + 6) % 7; // Monday = 0
  d.setDate(d.getDate() - delta);
  return formatDate(d);
}

export function startOfMonth(date: string): string {
  return date.slice(0, 7) + '-01';
}

export function endOfMonth(date: string): string {
  const d = parseDate(date);
  return formatDate(new Date(d.getFullYear(), d.getMonth() + 1, 0));
}

/**
 * Builds the progress of one date from the entries of that date. Missing slots
 * count as untouched (PENDING) - states are read from stored rows, never
 * inferred from the clock.
 */
export function forDay(
  date: string,
  entries: MealEntry[],
  photoCounts: Map<string, number> = new Map(),
): DayProgress {
  const slots: MealSlotStatus[] = [];
  let completed = 0;
  let missed = 0;
  let pending = 0;

  for (const key of ALL_SLOTS) {
    const entry = entries.find((e) => e.mealCategoryKey === key) ?? null;
    const status = entry?.status ?? MealStatus.Pending;
    if (status === MealStatus.Done) {
      completed += 1;
    } else if (status === MealStatus.Missed) {
      missed += 1;
    } else {
      pending += 1;
    }
    slots.push({
      mealCategoryKey: key,
      status,
      title: entry?.title ?? '',
      plannedTime: entry?.plannedTime ?? null,
      completedAt: entry?.completedAt ?? null,
      ingredients: entry?.ingredients ?? '',
      photoCount: entry ? (photoCounts.get(entry.id) ?? 0) : 0,
      firstPhotoThumbnailId: '',
    });
  }

  const decided = completed + missed;
  return {
    date,
    totalSlots: SLOT_COUNT,
    completed,
    missed,
    pending,
    decided,
    hasDecided: decided > 0,
    percentage: Math.round(((completed * 100) / SLOT_COUNT) * 100) / 100,
    isFullyCompleted: completed === SLOT_COUNT,
    slots,
  };
}

/**
 * Aggregates a date range (inclusive). Days without stored entries still count
 * with five pending slots, keeping raw slot totals honest while ratios stay
 * untouched.
 */
export function forRange(
  from: string,
  to: string,
  entriesByDate: Map<string, MealEntry[]>,
  photoCounts: Map<string, number> = new Map(),
): PeriodProgress {
  if (to < from) {
    throw new Error('The end date must not precede the start date.');
  }
  const days: DayProgress[] = [];
  let completed = 0;
  let missed = 0;
  let pending = 0;
  let fullyCompletedDays = 0;

  let cursor = from;
  while (cursor <= to) {
    const day = forDay(cursor, entriesByDate.get(cursor) ?? [], photoCounts);
    days.push(day);
    completed += day.completed;
    missed += day.missed;
    pending += day.pending;
    if (day.isFullyCompleted) {
      fullyCompletedDays += 1;
    }
    cursor = addDays(cursor, 1);
  }

  const decided = completed + missed;
  return {
    from,
    to,
    totalSlots: days.length * SLOT_COUNT,
    completed,
    missed,
    pending,
    decided,
    hasDecided: decided > 0,
    percentage: decided === 0 ? 0 : Math.round(((completed * 100) / decided) * 100) / 100,
    fullyCompletedDays,
    days,
  };
}

/** Weekly aggregate starting on Monday, matching the statistics screen. */
export function forWeek(
  anyDayOfWeek: string,
  entriesByDate: Map<string, MealEntry[]>,
): PeriodProgress {
  const from = startOfWeek(anyDayOfWeek);
  return forRange(from, addDays(from, 6), entriesByDate);
}

/** Monthly aggregate for the month containing anyDayOfMonth. */
export function forMonth(
  anyDayOfMonth: string,
  entriesByDate: Map<string, MealEntry[]>,
): PeriodProgress {
  return forRange(startOfMonth(anyDayOfMonth), endOfMonth(anyDayOfMonth), entriesByDate);
}

/**
 * Trend series: one point per day with the confirmed share of that day's five
 * permanent slots (zero while nothing was confirmed).
 */
export function trend(
  from: string,
  to: string,
  entriesByDate: Map<string, MealEntry[]>,
): TrendPoint[] {
  const result: TrendPoint[] = [];
  let cursor = from;
  while (cursor <= to) {
    const day = forDay(cursor, entriesByDate.get(cursor) ?? []);
    result.push({
      date: cursor,
      percentage: day.percentage,
      completed: day.completed,
      missed: day.missed,
      decided: day.decided,
    });
    cursor = addDays(cursor, 1);
  }
  return result;
}

/** Arithmetic mean of daily percentages, rounded to 2 decimals. */
export function averagePercentage(days: DayProgress[]): number {
  if (days.length === 0) {
    return 0;
  }
  const sum = days.reduce((acc, d) => acc + d.percentage, 0);
  return Math.round((sum / days.length) * 100) / 100;
}