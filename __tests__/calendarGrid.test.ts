// Regression tests for the Calendar page's visible grid.
//
// The defect they pin: the page QUERIED the displayed month only but DREW whole
// weeks, so the neighbouring months' cells (the first and last row of every
// month) were the only cells on the board without their five meal marks - a
// month boundary looked like a gap in the diary, and the days were faded out.
// One helper now decides the range for both the query and the cells.

import { monthGrid } from '../src/ui/calendarGrid';

/** Local weekday of a 'yyyy-MM-dd' date; 0 = Sunday, 1 = Monday. */
function weekdayOf(date: string): number {
  return new Date(`${date}T00:00:00`).getDay();
}

describe('the calendar month grid', () => {
  test('November 2026 opens on Monday 26 October and closes on Sunday 6 December', () => {
    const grid = monthGrid('2026-11');
    expect(grid.from).toBe('2026-10-26');
    expect(grid.to).toBe('2026-12-06');
    expect(grid.dates).toHaveLength(42);
    expect(grid.dates[0]).toBe('2026-10-26');
    expect(grid.dates[grid.dates.length - 1]).toBe(grid.to);
  });

  test('the neighbouring days that fill the first and last row are in the range', () => {
    // Exactly the days the board shows with their five marks, in both directions.
    const grid = monthGrid('2026-11');
    for (const date of ['2026-10-26', '2026-10-31', '2026-12-01', '2026-12-06']) {
      expect(grid.dates).toContain(date);
    }
    // ...which is why the query must start before the month does.
    expect(grid.from < '2026-11-01').toBe(true);
    expect(grid.to > '2026-11-30').toBe(true);
  });

  test('every cell sits in a whole week that starts on Monday', () => {
    const grid = monthGrid('2026-11');
    expect(grid.dates.length % 7).toBe(0);
    grid.dates.forEach((date, index) => {
      // Monday-first columns: 0 = Monday (1) ... 5 = Saturday (6), 6 = Sunday (0).
      expect(weekdayOf(date)).toBe(((index % 7) + 1) % 7);
    });
  });

  test('a month that starts on a Monday needs only five weeks', () => {
    // June 2026 opens on a Monday: 30 days plus the two trailing days of the
    // fifth week, so the grid closes on Sunday 5 July.
    const grid = monthGrid('2026-06');
    expect(grid.from).toBe('2026-06-01');
    expect(grid.to).toBe('2026-07-05');
    expect(grid.dates).toHaveLength(35);
  });

  test('the month never loses a day, in a short month or a leap February', () => {
    for (const month of ['2026-02', '2028-02', '2026-04', '2026-12']) {
      const grid = monthGrid(month);
      const inMonth = grid.dates.filter((date) => date.slice(0, 7) === month);
      const days = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate();
      expect(inMonth).toHaveLength(days);
      expect(new Set(grid.dates).size).toBe(grid.dates.length);
    }
  });

  test('a day-by-day step survives a DST change', () => {
    // 29 March 2026 is a European DST switch day: "now + 24 h" would repeat a
    // date and stall the loop that builds the grid (`addDays` steps by calendar
    // date instead).
    const grid = monthGrid('2026-03');
    expect(grid.dates).toContain('2026-03-29');
    expect(grid.dates).toContain('2026-03-30');
    expect(new Set(grid.dates).size).toBe(grid.dates.length);
    expect(grid.dates[grid.dates.length - 1]).toBe(grid.to);
  });

  test('a month with six weeks keeps all 42 cells', () => {
    // August 2026 starts on a Saturday and has 31 days, so the board needs six
    // whole weeks - the layout must not clip the last row.
    const grid = monthGrid('2026-08');
    expect(grid.dates).toHaveLength(42);
    expect(grid.from).toBe('2026-07-27');
    expect(grid.to).toBe('2026-09-06');
  });

  test('the grid crosses the year without losing a cell', () => {
    // December 2026 ends on a Thursday, so its last week belongs to January 2027.
    const december = monthGrid('2026-12');
    expect(december.from).toBe('2026-11-30');
    expect(december.to).toBe('2027-01-03');
    expect(december.dates).toContain('2027-01-01');
    expect(december.dates).toContain('2027-01-03');

    // ...and January 2027 opens on the Friday of that same week.
    const january = monthGrid('2027-01');
    expect(january.from).toBe('2026-12-28');
    expect(january.dates[0]).toBe('2026-12-28');
    expect(january.dates).toContain('2027-01-31');
  });
});
