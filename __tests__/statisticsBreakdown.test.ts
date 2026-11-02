// Statistics breakdown regressions (round-3 review design).
//
// The page reports Done / all planned slots, and every breakdown row has to add
// up to that same denominator. These tests pin the row shapes (meals for a day,
// days for a week, partial calendar weeks for a month, months for a year), the
// upcoming disclosure and the "Later" case.

import { forRange } from '../src/domain/analytics';
import { MealStatus } from '../src/domain/enums';
import type { MealEntry } from '../src/domain/models';
import { buildRows, countSlots, periodRange } from '../src/ui/statisticsBreakdown';

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

const TODAY = '2026-11-02';

function weekProgress() {
  const byDate = new Map<string, MealEntry[]>([
    ['2026-10-26', [entry('2026-10-26', 1, MealStatus.Done)]],
    ['2026-10-29', [entry('2026-10-29', 3, MealStatus.Missed)]],
    ['2026-11-01', [entry('2026-11-01', 1, MealStatus.Done), entry('2026-11-01', 2, MealStatus.Done)]],
  ]);
  return forRange('2026-10-26', '2026-11-01', byDate);
}

describe('statistics period ranges', () => {
  it('uses Monday-based weeks and calendar months', () => {
    expect(periodRange('weekly', '2026-11-01')).toEqual({ from: '2026-10-26', to: '2026-11-01' });
    expect(periodRange('monthly', '2026-11-15')).toEqual({ from: '2026-11-01', to: '2026-11-30' });
    expect(periodRange('yearly', '2026-11-02')).toEqual({ from: '2026-01-01', to: '2026-12-31' });
    expect(periodRange('daily', '2026-11-02')).toEqual({ from: '2026-11-02', to: '2026-11-02' });
  });
});

describe('statistics counts', () => {
  it('counts all five slots per day and flags the days after today as upcoming', () => {
    const week = weekProgress();
    const counts = countSlots(week.days, TODAY);
    expect(counts.total).toBe(35);
    expect(counts.done).toBe(3);
    expect(counts.missed).toBe(1);
    expect(counts.pending).toBe(31);
    // Every slot of 2..8 Nov lies after today; this week ends on 1 Nov.
    expect(counts.upcoming).toBe(0);

    // Today's own slots are not "upcoming": only the days AFTER today are.
    const nextWeek = forRange('2026-11-02', '2026-11-08', new Map());
    expect(countSlots(nextWeek.days, TODAY).upcoming).toBe(30);
  });

  it('counts one meal slot across the period for the by-meal table', () => {
    const week = weekProgress();
    const breakfast = countSlots(week.days, TODAY, 1);
    expect(breakfast.total).toBe(7);
    expect(breakfast.done).toBe(2);
  });
});

describe('statistics breakdown rows', () => {
  it('lists the five meals for a single day', () => {
    const day = forRange('2026-11-01', '2026-11-01', new Map());
    const rows = buildRows('daily', '2026-11-01', '2026-11-01', day.days, TODAY);
    expect(rows).toHaveLength(5);
    expect(rows[0].label).toBe('Breakfast');
    expect(rows[0].counts.total).toBe(1);
  });

  it('lists seven days for a week, each with five planned slots', () => {
    const week = weekProgress();
    const rows = buildRows('weekly', week.from, week.to, week.days, TODAY);
    expect(rows).toHaveLength(7);
    expect(rows[0].label).toBe('Mon 26');
    expect(rows[0].counts.done).toBe(1);
    expect(rows[6].counts.done).toBe(2);
    // The rows add up to the period's own denominator.
    expect(rows.reduce((sum: number, row) => sum + row.counts.total, 0)).toBe(35);
  });

  it('splits a month into partial calendar weeks', () => {
    const month = forRange('2026-11-01', '2026-11-30', new Map());
    const rows = buildRows('monthly', month.from, month.to, month.days, TODAY);
    // 1 Nov (Sunday) is its own row, then four full weeks, then 30 Nov.
    expect(rows[0].from).toBe('2026-11-01');
    expect(rows[0].to).toBe('2026-11-01');
    expect(rows[1].from).toBe('2026-11-02');
    expect(rows[1].to).toBe('2026-11-08');
    expect(rows[rows.length - 1].to).toBe('2026-11-30');
    expect(rows.reduce((sum: number, row) => sum + row.counts.total, 0)).toBe(150);
  });

  it('lists twelve months for a year with the right denominators', () => {
    const year = forRange('2026-01-01', '2026-12-31', new Map());
    const rows = buildRows('yearly', year.from, year.to, year.days, TODAY);
    expect(rows).toHaveLength(12);
    expect(rows[0].label).toBe('Jan');
    expect(rows[0].counts.total).toBe(155);
    expect(rows[1].counts.total).toBe(140);
    expect(rows.reduce((sum: number, row) => sum + row.counts.total, 0)).toBe(1825);
  });
});
