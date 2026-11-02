// Statistics rows and counts (round-3 review design) - the maths behind the
// page, kept free of React Native so it can be tested directly.
//
// Everything here is derived from the stored slot states, never from the clock,
// with ONE exception: `upcoming` counts the slots that lie after today, purely so
// the page can disclose them instead of dressing future meals up as misses.

import {
  DayProgress,
  addDays,
  endOfMonth,
  startOfMonth,
  startOfWeek,
} from '../domain/analytics';
import { MealStatus } from '../domain/enums';
import {
  formatCompactDate,
  formatLongDate,
  formatMonthLabel,
  formatMonthShort,
  formatShortDayMonth,
  formatWeekdayDay,
  t,
} from './strings';

/** Ordered period list of the segmented control (index == selection). */
export type Mode = 'daily' | 'weekly' | 'monthly' | 'yearly';

/** Done / Missed / Pending / planned slots of one row (or of the period). */
export interface Counts {
  done: number;
  missed: number;
  pending: number;
  total: number;
  /** Slots that lie after today - disclosed, never counted as missed. */
  upcoming: number;
}

/** One interactive row of the breakdown. */
export interface BreakdownRow {
  key: string;
  label: string;
  /** Inclusive range the row covers (equal for a single day). */
  from: string;
  to: string;
  /** Accessible description of the row's range. */
  context: string;
  counts: Counts;
}

export function emptyCounts(): Counts {
  return { done: 0, missed: 0, pending: 0, total: 0, upcoming: 0 };
}

/**
 * Counts one meal slot (or all five) across a set of days. Everything is read
 * from the stored slot states, so an untouched slot is Pending, never guessed
 * from the clock - only `upcoming` looks at the calendar, and it exists purely so
 * the page can disclose future slots instead of dressing them up as misses.
 */
export function countSlots(days: DayProgress[], today: string, mealKey?: number): Counts {
  const counts = emptyCounts();
  for (const day of days) {
    const slots =
      mealKey === undefined
        ? day.slots
        : day.slots.filter((slot) => slot.mealCategoryKey === mealKey);
    for (const slot of slots) {
      counts.total += 1;
      if (slot.status === MealStatus.Done) {
        counts.done += 1;
      } else if (slot.status === MealStatus.Missed) {
        counts.missed += 1;
      } else {
        counts.pending += 1;
      }
      if (day.date > today) {
        counts.upcoming += 1;
      }
    }
  }
  return counts;
}

/** Inclusive bounds of the selected period (Monday-based week, calendar month). */
export function periodRange(mode: Mode, anchor: string): { from: string; to: string } {
  if (mode === 'daily') {
    return { from: anchor, to: anchor };
  }
  if (mode === 'weekly') {
    const from = startOfWeek(anchor);
    return { from, to: addDays(from, 6) };
  }
  if (mode === 'monthly') {
    return { from: startOfMonth(anchor), to: endOfMonth(anchor) };
  }
  const year = anchor.slice(0, 4);
  return { from: `${year}-01-01`, to: `${year}-12-31` };
}

/** The exact range, always printed: a period the user cannot identify is useless. */
export function periodLabel(mode: Mode, from: string, to: string): string {
  if (mode === 'daily') {
    // The year belongs in the label: "Sun 1 Nov" alone is ambiguous as soon as
    // the user steps into another year.
    const compact = formatCompactDate(from);
    return compact.year === '' ? compact.primary : `${compact.primary} ${compact.year}`;
  }
  if (mode === 'monthly') {
    return formatMonthLabel(from.slice(0, 7));
  }
  if (mode === 'yearly') {
    return from.slice(0, 4);
  }
  return `${formatShortDayMonth(from)} – ${formatShortDayMonth(to)} ${to.slice(0, 4)}`;
}

/** Lower-case period word for the context sentence ("... in this week."). */
export function periodWord(mode: Mode): string {
  if (mode === 'daily') {
    return t('Rn_PeriodWordDay');
  }
  if (mode === 'weekly') {
    return t('Rn_PeriodWordWeek');
  }
  return mode === 'monthly' ? t('Rn_PeriodWordMonth') : t('Rn_PeriodWordYear');
}

/** Short meal name for a day-mode row (a full "Afternoon snack" would clip). */
function shortMealName(mealCategoryKey: number): string {
  switch (mealCategoryKey) {
    case 1:
      return t('Rn_MealShortBreakfast');
    case 2:
      return t('Rn_MealShortMorningSnack');
    case 3:
      return t('Rn_MealShortLunch');
    case 4:
      return t('Rn_MealShortAfternoonSnack');
    default:
      return t('Rn_MealShortDinner');
  }
}

/**
 * The breakdown rows of the period: meals for a day, days for a week, partial
 * calendar weeks for a month and months for a year. Every row carries its own
 * counts, so selecting one can state exactly what it holds.
 */
export function buildRows(
  mode: Mode,
  from: string,
  to: string,
  days: DayProgress[],
  today: string,
): BreakdownRow[] {
  const rows: BreakdownRow[] = [];
  if (mode === 'daily') {
    for (const slot of days[0]?.slots ?? []) {
      const name = shortMealName(slot.mealCategoryKey);
      rows.push({
        key: `meal|${slot.mealCategoryKey}`,
        label: name,
        from,
        to,
        context: `${name} · ${formatLongDate(from)}`,
        counts: countSlots(days, today, slot.mealCategoryKey),
      });
    }
    return rows;
  }
  const push = (start: string, end: string, label: string): void => {
    const subset = days.filter((day) => day.date >= start && day.date <= end);
    rows.push({
      key: `${start}|${end}`,
      label,
      from: start,
      to: end,
      context:
        start === end
          ? formatLongDate(start)
          : `${formatShortDayMonth(start)} – ${formatShortDayMonth(end)} ${end.slice(0, 4)}`,
      counts: countSlots(subset, today),
    });
  };
  if (mode === 'weekly') {
    for (const day of days) {
      push(day.date, day.date, formatWeekdayDay(day.date));
    }
    return rows;
  }
  if (mode === 'monthly') {
    // Partial calendar weeks: the first row starts on the 1st and ends on that
    // week's Sunday, the last row is clipped to the end of the month.
    let cursor = from;
    while (cursor <= to) {
      const sunday = addDays(startOfWeek(cursor), 6);
      const end = sunday < to ? sunday : to;
      push(
        cursor,
        end,
        cursor === end
          ? formatShortDayMonth(cursor)
          : `${formatShortDayMonth(cursor)} – ${formatShortDayMonth(end)}`,
      );
      cursor = addDays(end, 1);
    }
    return rows;
  }
  for (let month = 1; month <= 12; month += 1) {
    const start = `${from.slice(0, 4)}-${String(month).padStart(2, '0')}-01`;
    push(start, endOfMonth(start), formatMonthShort(month));
  }
  return rows;
}


