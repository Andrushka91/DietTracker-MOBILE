// Formatting and pill-colour regressions for the round-3 review design.
//
// Three things here were actually wrong during the redesign and are pinned now:
//   1. the compact date ("Sun 1 Nov") and the statistics range labels,
//   2. `withAlpha()` double-converting an already-converted theme colour (green
//      became purple), which is why `tintAlpha()` exists,
//   3. the soft status pill keeping the state colour as its ink.

import { forRange } from '../src/domain/analytics';
import { MealStatus } from '../src/domain/enums';
import type { MealEntry } from '../src/domain/models';
import {
  formatCompactDate,
  formatShortDayMonth,
  formatWeekdayDay,
} from '../src/ui/strings';
import { softPillColors, themeColors, tintAlpha } from '../src/ui/theme';

describe('round-3 date formatting', () => {
  it('prints the compact diary date as weekday, day and short month', () => {
    expect(formatCompactDate('2026-11-01')).toEqual({ primary: 'Sun 1 Nov', year: '2026' });
    expect(formatCompactDate('2026-01-05')).toEqual({ primary: 'Mon 5 Jan', year: '2026' });
  });

  it('keeps the raw value when the date cannot be parsed', () => {
    expect(formatCompactDate('not-a-date')).toEqual({ primary: 'not-a-date', year: '' });
  });

  it('prints the statistics labels the way the rows read them', () => {
    // The day and the month are joined by a NON-BREAKING space, so a range that
    // wraps at large text sizes breaks at the dash ("2 Nov –" / "8 Nov") instead
    // of splitting "8" from "Nov".
    expect(formatShortDayMonth('2026-10-26')).toBe('26\u00A0Oct');
    expect(formatShortDayMonth('2026-11-01')).toBe('1\u00A0Nov');
    expect(formatWeekdayDay('2026-10-26')).toBe('Mon 26');
    expect(formatWeekdayDay('2026-11-01')).toBe('Sun 1');
  });
});

describe('tintAlpha', () => {
  it('only replaces the alpha byte of an already-converted colour', () => {
    // Theme colours arrive as #RRGGBBAA; `withAlpha` would have read this as
    // #AARRGGBB and turned the green into purple.
    expect(tintAlpha('#157A4CFF', '1A')).toBe('#157A4C1A');
    expect(tintAlpha('#157A4C', '2E')).toBe('#157A4C2E');
  });

  it('leaves an unexpected value alone', () => {
    expect(tintAlpha('rgb(1,2,3)', '1A')).toBe('rgb(1,2,3)');
  });
});

describe('softPillColors', () => {
  const light = themeColors(false);
  const dark = themeColors(true);

  it('keeps the state colour as ink and washes the fill', () => {
    const done = softPillColors(light, MealStatus.Done);
    expect(done.ink).toBe(light.done);
    expect(done.fill).toBe(tintAlpha(light.done, '1A'));

    const missed = softPillColors(light, MealStatus.Missed);
    expect(missed.ink).toBe(light.missed);
    expect(missed.fill).toBe(tintAlpha(light.missed, '1A'));
  });

  it('uses the neutral control wash for a pending meal', () => {
    const pending = softPillColors(dark, MealStatus.Pending);
    expect(pending.fill).toBe(dark.surfaceVariant);
    expect(pending.ink).toBe(dark.textSecondary);
  });
});

describe('period aggregation used by the primary percentage', () => {
  function entry(date: string, mealCategoryKey: number, status: MealStatus): MealEntry {
    return {
      id: `${date}-${mealCategoryKey}`,
      profileId: 'profile',
      date,
      mealCategoryKey,
      title: 'Meal',
      ingredients: '',
      plannedTime: null,
      status,
      completedAt: null,
      notes: '',
      createdAt: '',
      updatedAt: '',
      syncStatus: 0,
      cloudRevision: null,
    } as unknown as MealEntry;
  }

  it('counts every planned slot, not only the recorded ones', () => {
    const byDate = new Map<string, MealEntry[]>([
      ['2026-11-01', [entry('2026-11-01', 1, MealStatus.Done)]],
    ]);
    const week = forRange('2026-10-26', '2026-11-01', byDate);
    expect(week.totalSlots).toBe(35);
    expect(week.completed).toBe(1);
    expect(week.pending).toBe(34);
    // Done / planned = 1/35, while the domain's own ratio stays 1/1 decided.
    expect(Math.round((week.completed * 100) / week.totalSlots)).toBe(3);
    expect(week.percentage).toBe(100);
  });
});
