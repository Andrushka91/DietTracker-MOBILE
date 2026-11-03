// The month grid the Calendar page draws (spec 8.5) - pure date arithmetic, so
// the page and its regression tests can share one definition.
//
// The grid is ALWAYS whole weeks starting on Monday: the days of the neighbouring
// months fill the first and last row, exactly like the Windows month view. That
// matters for more than layout - the reload and the cells must cover the SAME
// range, or the leading/trailing days would be the only cells on the board
// without their five marks (a month boundary looked like a gap in the diary).
//
// November 2026 is the honest example: the 1st is a Sunday, so the grid opens on
// Monday 26 October and runs six whole weeks to Sunday 6 December.

import { addDays, parseDate } from '../domain/analytics';

export interface MonthGrid {
  /** First cell of the grid ('yyyy-MM-dd') - the start of the query range. */
  from: string;
  /** Last cell of the grid - the end of the query range. */
  to: string;
  /** Every cell, Monday-first, in reading order (always a multiple of seven). */
  dates: string[];
}

/**
 * Lights up the whole visible grid of a `yyyy-MM` month. Pure: no clock, no
 * locale - the month key alone decides, so the same month always yields the same
 * cells.
 */
export function monthGrid(month: string): MonthGrid {
  const first = parseDate(`${month}-01`);
  const daysInMonth = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  const leading = (first.getDay() + 6) % 7; // Monday first
  const from = addDays(`${month}-01`, -leading);
  const totalCells = Math.ceil((leading + daysInMonth) / 7) * 7;
  const dates: string[] = [];
  for (let index = 0; index < totalCells; index += 1) {
    dates.push(addDays(from, index));
  }
  return { from, to: dates[dates.length - 1], dates };
}
