// Display geometry of the statistics week chart - PRESENTATION ONLY.
//
// Nothing here counts a meal, decides a status or looks at the clock: the row
// counts arrive already settled from `statisticsBreakdown`, and these functions
// only turn them into pixel heights. They live outside React so the shared
// absolute scale can be tested directly instead of inferred from a screenshot.
//
// The ONE rule that matters: all seven daily columns share a single scale. A
// column's height is its own planned slots against the busiest day of the same
// week, so a 2-slot Sunday is visibly shorter than a 5-slot Tuesday. Scaling
// each column to itself would draw every day full height and hide exactly the
// comparison the chart exists for.

/** The three decided states of a slot - the same meanings the whole app uses. */
export interface ChartCounts {
  done: number;
  missed: number;
  pending: number;
}

/** One stacked band of a column: where it starts and how tall the display is. */
export interface ChartSegment {
  status: 'done' | 'missed' | 'pending';
  /** Offset from the column's baseline (0 = the axis line). */
  bottom: number;
  height: number;
}

/** Planned slots of one row - what the column's height is measured against. */
export function outcomeTotal(counts: ChartCounts): number {
  return Math.max(0, counts.done) + Math.max(0, counts.missed) + Math.max(0, counts.pending);
}

/**
 * The common scale maximum of a whole week: the busiest column's slot count.
 * Never 0, so an empty or future-only week cannot divide by zero or draw a
 * bar taller than the plot.
 */
export function chartScaleMax(rows: ReadonlyArray<{ counts: ChartCounts }>): number {
  let busiest = 0;
  for (const row of rows) {
    const total = outcomeTotal(row.counts);
    if (total > busiest) {
      busiest = total;
    }
  }
  return busiest < 1 ? 1 : busiest;
}

/**
 * The three bands of one column, bottom-up: Done on the baseline, Missed above
 * it, Pending last. Heights are absolute slot counts divided by the SHARED
 * maximum, so equal counts draw equal heights in every column.
 */
export function outcomeSegments(
  counts: ChartCounts,
  scaleMax: number,
  plotHeight: number,
): ChartSegment[] {
  const scale = Math.max(1, scaleMax);
  const height = Math.max(0, plotHeight);
  const done = (height * Math.max(0, counts.done)) / scale;
  const missed = (height * Math.max(0, counts.missed)) / scale;
  const pending = (height * Math.max(0, counts.pending)) / scale;
  return [
    { status: 'done', bottom: 0, height: done },
    { status: 'missed', bottom: done, height: missed },
    { status: 'pending', bottom: done + missed, height: pending },
  ];
}

/**
 * Whether the week still fits seven real touch targets beside the axis WITHOUT
 * horizontal scrolling. Narrower windows and enlarged text fall back to the
 * existing readable row breakdown instead of shrinking the columns.
 */
export function weeklyChartFits(
  availableWidth: number,
  columnCount: number,
  axisWidth: number,
  columnWidth: number,
): boolean {
  if (columnCount <= 0) {
    return false;
  }
  return availableWidth >= axisWidth + columnCount * columnWidth;
}
