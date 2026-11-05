// Width adaptation for the MONTH chart - presentation only, no counts, dates or
// domain rules.
//
// A month is drawn as its clipped calendar weeks, and a month can have four,
// five or six of them (November 2026 has six: 1, 2–8, 9–15, 16–22, 23–29, 30).
// One fixed column width meant the sixth group sat behind the right edge with no
// cue, so the columns are now DISTRIBUTED across the measured viewport:
//
//   * every column keeps a real minimum TARGET (48 dp, growing with the text);
//   * columns are separated by one small gap;
//   * when all of them fit, the available width is shared EQUALLY: the first
//     target starts at the plot's left edge and the last one ends exactly at the
//     plot's right edge, so the chart is symmetrical with no extra spacer;
//   * when they do not fit, the targets keep their minimum width and the chart
//     scrolls with a real 8 dp gutter at BOTH ends of the SCROLL CONTENT - not a
//     padding on the viewport, which would not extend the scrollable area - so
//     the last border and its label can be brought fully into view.
//
// The value/date labels stay centred inside their own equal cell, which gives the
// matching half-cell clearance at both ends when the columns fit.

import { statisticsVerticalTokens as TPL } from './statisticsVertical';

export interface MonthColumnLayout {
  /** Width of one column target in dp (fractional when spread evenly). */
  columnWidth: number;
  /** Gap between two neighbouring column targets in dp. */
  columnGap: number;
  /** Real scroll-content padding at both ends: 8 dp only while overflowing. */
  edgePadding: number;
  /** Full width of the scrollable content, including both end gutters. */
  contentWidth: number;
  /** True when the columns need horizontal scrolling. */
  overflowing: boolean;
}

/**
 * Lays a month's columns out inside `viewportWidth` (the space left of the fixed
 * y-axis). `viewportWidth` of 0 means "not measured yet": fall back to the
 * minimum targets so nothing collapses on the first frame.
 */
export function monthColumnLayout(
  viewportWidth: number,
  columnCount: number,
  fontScale: number,
): MonthColumnLayout {
  const scale = Math.max(1, fontScale);
  const minimumTarget = Math.ceil(TPL.monthColumnMinWidth * scale);
  const columnGap = TPL.monthColumnGap;
  if (columnCount <= 0) {
    return { columnWidth: minimumTarget, columnGap, edgePadding: 0, contentWidth: 0, overflowing: false };
  }
  const between = columnGap * (columnCount - 1);
  const minimumTargets = between + minimumTarget * columnCount;
  const canFit = viewportWidth >= minimumTargets;
  // Fitted: no end spacer at all - the targets fill the plot edge to edge.
  // Overflowing: a real gutter at both ends of the scroll content.
  const edgePadding = canFit ? 0 : TPL.monthEdgePadding;
  const contentWidth = canFit ? viewportWidth : edgePadding * 2 + minimumTargets;
  // Fractional dp is intentional: the whole width is shared, not rounded away.
  const columnWidth = canFit
    ? (viewportWidth - edgePadding * 2 - between) / columnCount
    : minimumTarget;
  return {
    columnWidth,
    columnGap,
    edgePadding,
    contentWidth,
    overflowing: viewportWidth > 0 && !canFit,
  };
}

/**
 * Year layout: twelve WHOLE months in order, but the column width is chosen so
 * that an integer number of COMPLETE columns fills the viewport at rest - no
 * half month (e.g. July) is ever clipped at the right edge of the initial view.
 *
 * It reuses the month tokens and the same fit/overflow shape, so nothing else
 * changes:
 *
 *   * everything fits: distribute edge to edge, first column at the plot's left
 *     edge, last at its right edge, NO end gutter - identical to the month fit;
 *   * otherwise: keep a real 8 dp gutter at BOTH ends of the scroll content and
 *     size the columns WIDER than the 48 dp minimum so that exactly `fitCount`
 *     whole columns fill the viewport at rest (leading gutter + the columns'
 *     widths + their gaps == viewportWidth). The remaining months scroll, and at
 *     maximum scroll December ends 8 dp short of the content's right edge, so its
 *     value, label and selection border are fully clear of the edge.
 *
 * The touch target never drops below `ceil(48 * fontScale)` because `fitCount`
 * is the largest integer that keeps every column at or above that minimum.
 */
export function yearColumnLayout(
  viewportWidth: number,
  columnCount: number,
  fontScale: number,
): MonthColumnLayout {
  const scale = Math.max(1, fontScale);
  const minimumTarget = Math.ceil(TPL.monthColumnMinWidth * scale);
  const columnGap = TPL.monthColumnGap;
  const edge = TPL.monthEdgePadding;
  if (columnCount <= 0) {
    return { columnWidth: minimumTarget, columnGap, edgePadding: 0, contentWidth: 0, overflowing: false };
  }
  if (viewportWidth <= 0) {
    // Not measured yet: minimum targets so nothing collapses on the first frame.
    const contentWidth = edge * 2 + minimumTarget * columnCount + columnGap * (columnCount - 1);
    return { columnWidth: minimumTarget, columnGap, edgePadding: edge, contentWidth, overflowing: false };
  }
  const minimumTargets = minimumTarget * columnCount + columnGap * (columnCount - 1);
  if (viewportWidth >= minimumTargets) {
    // Fitted: no end spacer - the targets fill the plot edge to edge.
    const columnWidth = (viewportWidth - columnGap * (columnCount - 1)) / columnCount;
    return { columnWidth, columnGap, edgePadding: 0, contentWidth: viewportWidth, overflowing: false };
  }
  // Overflowing: the largest integer number of COMPLETE columns that fit beside
  // the leading 8 dp gutter without dropping below the minimum target.
  const fitCount = Math.max(
    1,
    Math.floor((viewportWidth - edge + columnGap) / (minimumTarget + columnGap)),
  );
  // Widen the columns so those whole columns fill the viewport exactly at rest.
  const columnWidth = Math.max(
    minimumTarget,
    (viewportWidth - edge - columnGap * (fitCount - 1)) / fitCount,
  );
  // The scroll content carries BOTH end gutters plus every width and gap, so the
  // width used for the overflow hint is the width actually rendered and scrolled.
  const contentWidth = edge * 2 + columnWidth * columnCount + columnGap * (columnCount - 1);
  return { columnWidth, columnGap, edgePadding: edge, contentWidth, overflowing: true };
}

/**
 * The month column's two-line label: "1\nNov", "2–8\nNov", ... built from the
 * row's own from/to and the app's EXISTING short-month name. A bucket that
 * crosses a month boundary keeps the full row label instead of inventing a
 * misleading one. The full context (with the year) stays in the column's
 * accessibility label and in the selection detail.
 */
export function compactMonthBucketLabel(
  from: string,
  to: string,
  shortMonth: string,
  fullLabel: string,
): string {
  if (from.slice(0, 7) !== to.slice(0, 7)) {
    return fullLabel;
  }
  const first = Number(from.slice(8, 10));
  const last = Number(to.slice(8, 10));
  return `${first === last ? first : `${first}\u2013${last}`}\n${shortMonth}`;
}
