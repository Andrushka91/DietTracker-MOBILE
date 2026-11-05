// The Statistics chart: display geometry, every period, and row selection.
//
// The chart is PRESENTATION. It must never draw a two-slot day as tall as a
// five-slot day, it must draw VERTICAL columns for every period (never rows),
// and pressing a column must select the EXACT row it belongs to (and only that
// row) - the open action stays in the card's selection footer. These tests pin
// those behaviours plus the empty/zero-count safety net and the "Later" columns,
// and nothing about colours, spacing or snapshots.

import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';

import {
  chartScaleMax,
  outcomeSegments,
  outcomeTotal,
  weeklyChartFits,
} from '../src/ui/statisticsChart';
import {
  CHART,
  VerticalOutcomeChart,
  type OutcomeColumn,
} from '../src/ui/components/VerticalOutcomeChart';
import {
  compactMonthBucketLabel,
  monthColumnLayout,
} from '../src/ui/statisticsMonthLayout';
import { statisticsVerticalTokens as TPL } from '../src/ui/statisticsVertical';
import type { Mode } from '../src/ui/statisticsBreakdown';
import { t } from '../src/ui/strings';
import { lightColors } from '../src/ui/theme';

/** A phone-sized window: the chart's value line follows the text scale. */
const mockWindow = { width: 412, height: 915, scale: 2.6, fontScale: 1 };
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => mockWindow,
}));

type Renderer = TestRenderer.ReactTestRenderer;

/** One real week: five planned slots a day, unequally decided. */
function row(
  date: string,
  label: string,
  done: number,
  missed: number,
  pending: number,
  allLater = false,
): OutcomeColumn {
  const total = done + missed + pending;
  return {
    key: `${date}|${date}`,
    label,
    // The value above a column is ALWAYS the real done / total.
    valueLabel: `${done} / ${total}`,
    accessibilityLabel: `${label}: ${done} / ${total} done`,
    counts: { done, missed, pending, total, upcoming: allLater ? total : 0 },
    allLater,
  };
}

const WEEK: OutcomeColumn[] = [
  row('2026-10-26', 'Mon 26', 2, 0, 3),
  row('2026-10-27', 'Tue 27', 0, 3, 2),
  row('2026-10-28', 'Wed 28', 1, 0, 4),
  row('2026-10-29', 'Thu 29', 3, 0, 2),
  row('2026-10-30', 'Fri 30', 0, 0, 5, true),
  row('2026-10-31', 'Sat 31', 0, 0, 5, true),
  row('2026-11-01', 'Sun 1', 0, 0, 5, true),
];

function render(props: {
  rows?: OutcomeColumn[];
  mode?: Mode;
  selectedKey?: string | null;
  onToggleRow?: (key: string) => void;
}): Renderer {
  let renderer: Renderer | undefined;
  act(() => {
    renderer = TestRenderer.create(
      <VerticalOutcomeChart
        rows={props.rows ?? WEEK}
        mode={props.mode ?? 'weekly'}
        selectedKey={props.selectedKey ?? null}
        onToggleRow={props.onToggleRow ?? (() => undefined)}
        colors={lightColors}
      />,
    );
  });
  if (renderer === undefined) {
    throw new Error('the chart did not render');
  }
  return renderer;
}

/** Pressables only: the legend keys are decoration, not controls. */
function columns(renderer: Renderer): TestRenderer.ReactTestInstance[] {
  return renderer.root.findAll(
    (node) =>
      node.props?.accessibilityRole === 'button' && typeof node.props.onPress === 'function',
  );
}

describe('the week chart geometry', () => {
  test('measures a column by its planned slots', () => {
    expect(outcomeTotal({ done: 2, missed: 1, pending: 2 })).toBe(5);
    expect(outcomeTotal({ done: 0, missed: 0, pending: 0 })).toBe(0);
  });

  test('scales every column against the busiest day, not against itself', () => {
    // If each column were scaled to itself, both days below would fill the plot
    // and the comparison the chart exists for would disappear.
    const scaleMax = chartScaleMax([
      { counts: { done: 2, missed: 0, pending: 3 } },
      { counts: { done: 2, missed: 0, pending: 0 } },
    ]);
    expect(scaleMax).toBe(5);

    const heightOf = (counts: { done: number; missed: number; pending: number }): number =>
      outcomeSegments(counts, scaleMax, 100).reduce((sum, part) => sum + part.height, 0);

    expect(heightOf({ done: 2, missed: 0, pending: 3 })).toBe(100);
    expect(heightOf({ done: 2, missed: 0, pending: 0 })).toBe(40);
  });

  test('stacks Done, Missed, Pending bottom-up without gaps or overlap', () => {
    const [done, missed, pending] = outcomeSegments({ done: 2, missed: 1, pending: 2 }, 5, 100);
    expect(done).toEqual({ status: 'done', bottom: 0, height: 40 });
    expect(missed).toEqual({ status: 'missed', bottom: 40, height: 20 });
    expect(pending).toEqual({ status: 'pending', bottom: 60, height: 40 });
    // The three bands add up to the column's own share of the plot: upcoming
    // slots live INSIDE Pending, never in a fourth band.
    expect(done.height + missed.height + pending.height).toBe(100);
  });

  test('is safe on an empty or future-only week', () => {
    expect(chartScaleMax([{ counts: { done: 0, missed: 0, pending: 0 } }])).toBe(1);
    expect(chartScaleMax([])).toBe(1);
    for (const part of outcomeSegments({ done: 0, missed: 0, pending: 0 }, 0, 96)) {
      expect(part.height).toBe(0);
      expect(part.bottom).toBeGreaterThanOrEqual(0);
    }
    // An all-pending day draws one full pending band and no invented outcome.
    const [done, missed, pending] = outcomeSegments({ done: 0, missed: 0, pending: 5 }, 5, 96);
    expect(done.height).toBe(0);
    expect(missed.height).toBe(0);
    expect(pending.height).toBe(96);
  });

  test('only claims a fit when seven REAL targets fit beside the axis', () => {
    const needed = CHART.axisWidth + 7 * CHART.columnWidth;
    expect(weeklyChartFits(needed, 7, CHART.axisWidth, CHART.columnWidth)).toBe(true);
    expect(weeklyChartFits(needed - 1, 7, CHART.axisWidth, CHART.columnWidth)).toBe(false);
    expect(weeklyChartFits(needed, 0, CHART.axisWidth, CHART.columnWidth)).toBe(false);
    // A column is never shrunk below a platform touch target to make it fit.
    expect(CHART.columnWidth).toBeGreaterThanOrEqual(44);
  });
});

describe('the week chart selection', () => {
  test('draws one column per real day, with its exact value and named legend keys', () => {
    const renderer = render({});
    const found = columns(renderer);
    expect(found).toHaveLength(WEEK.length);
    expect(found.map((node) => node.props.accessibilityLabel)).toEqual(
      WEEK.map((item) => item.accessibilityLabel),
    );
    const texts = renderer.root.findAllByType(Text).map((node) => node.props.children);
    // Nothing depends on colour alone: the three states are named...
    expect(texts).toEqual(expect.arrayContaining(['Done', 'Missed', 'Pending']));
    // ...and every day prints its own done / total above its column.
    expect(texts).toEqual(expect.arrayContaining(['2 / 5', '0 / 5']));
  });

  test('emits the EXACT row key once and marks only the handed key selected', () => {
    const onToggleRow = jest.fn();
    const renderer = render({ onToggleRow });
    const target = WEEK[3];
    const column = columns(renderer).find(
      (node) => node.props.accessibilityLabel === target.accessibilityLabel,
    );
    expect(column).toBeDefined();
    act(() => column?.props.onPress());
    expect(onToggleRow).toHaveBeenCalledTimes(1);
    expect(onToggleRow).toHaveBeenCalledWith(target.key);
    // Seven distinct keys, so a column can never toggle a neighbouring day.
    expect(new Set(WEEK.map((item) => item.key)).size).toBe(WEEK.length);

    // The screen owns the selection; the chart only draws the state it is handed.
    act(() => {
      renderer.update(
        <VerticalOutcomeChart
          rows={WEEK}
          mode="weekly"
          selectedKey={target.key}
          onToggleRow={onToggleRow}
          colors={lightColors}
        />,
      );
    });
    const selected = columns(renderer).filter((node) => node.props.accessibilityState?.selected);
    expect(selected).toHaveLength(1);
    expect(selected[0].props.accessibilityLabel).toBe(target.accessibilityLabel);
  });

  test('says a column selects rather than opens, and keeps one scale for all', () => {
    const onToggleRow = jest.fn();
    const renderer = render({ onToggleRow });
    // The instruction is on screen, so a tap is never mistaken for navigation...
    const texts = renderer.root.findAllByType(Text).map((node) => node.props.children);
    expect(texts).toEqual(expect.arrayContaining([t('Rn_StatChartSelectHint')]));
    expect(texts).toEqual(expect.arrayContaining([t('Rn_StatAxisLabel')]));
    // ...and the axis prints the SHARED maximum, not a per-column 100 %.
    expect(texts).toEqual(expect.arrayContaining([outcomeTotal(WEEK[0].counts)]));
    // A second press on the same column is the screen's deselection: the chart
    // simply emits the same exact key again.
    const column = columns(renderer)[0];
    act(() => column.props.onPress());
    act(() => column.props.onPress());
    expect(onToggleRow.mock.calls).toEqual([[WEEK[0].key], [WEEK[0].key]]);
  });
});

describe('every period draws vertical columns', () => {
  /** Five meals of one day - keyed like the app's `meal|<category>` rows. */
  const DAY: OutcomeColumn[] = [
    row('2026-11-05', 'Breakfast', 1, 0, 0),
    row('2026-11-05', 'Morning snack', 0, 0, 1),
    row('2026-11-05', 'Lunch', 0, 1, 0),
    row('2026-11-05', 'Afternoon snack', 0, 0, 1),
    row('2026-11-05', 'Dinner', 0, 0, 1),
  ].map((item, index) => ({ ...item, key: `meal|${index + 1}` }));
  /** The clipped calendar weeks of one month, of unequal length. */
  const MONTH: OutcomeColumn[] = [
    row('2026-11-01', '1 Nov', 0, 0, 5),
    row('2026-11-02', '2 – 8 Nov', 3, 1, 31),
    row('2026-11-09', '9 – 15 Nov', 1, 0, 34),
    row('2026-11-16', '16 – 22 Nov', 0, 0, 35),
  ];
  /** Twelve months of one year. */
  const YEAR: OutcomeColumn[] = Array.from({ length: 12 }, (_unused, index) =>
    row(`2026-${String(index + 1).padStart(2, '0')}-01`, `M${index + 1}`, 0, 0, 35, true),
  );

  test('Day, Month and Year use the same vertical chart as Week', () => {
    for (const [mode, rows] of [
      ['daily', DAY],
      ['monthly', MONTH],
      ['yearly', YEAR],
    ] as const) {
      const renderer = render({ rows, mode });
      // One pressable column per settled row, in the order the rows arrive.
      expect(columns(renderer)).toHaveLength(rows.length);
      expect(columns(renderer).map((node) => node.props.accessibilityLabel)).toEqual(
        rows.map((item) => item.accessibilityLabel),
      );
      // Every column prints its own label and value - never a bare mark.
      const texts = renderer.root.findAllByType(Text).map((node) => node.props.children);
      expect(texts).toEqual(expect.arrayContaining(rows.map((item) => item.label)));
      expect(texts).toEqual(expect.arrayContaining(rows.map((item) => item.valueLabel)));
    }
  });

  test('a future-only column keeps its real value and adds Later as metadata', () => {
    const renderer = render({ rows: WEEK, mode: 'weekly' });
    const texts = renderer.root.findAllByType(Text).map((node) => node.props.children);
    // Both the real 0 / 5 AND the separate "Later" word are printed.
    expect(texts).toEqual(expect.arrayContaining(['0 / 5', t('Rn_StatLater')]));
    // Upcoming is not a fourth band: exactly three status bands are drawn for an
    // all-pending column, and its pending band fills the whole plot.
    const segments = outcomeSegments(WEEK[4].counts, chartScaleMax(WEEK), 100);
    expect(segments).toHaveLength(3);
    expect(segments[2]).toMatchObject({ status: 'pending', bottom: 0, height: 100 });
  });

  test('draws columns even when the window is narrow and the text is large', () => {
    // A 320 dp window at a 2x text scale is exactly where the old chart gave up
    // and fell back to rows; the columns are still there, they just scroll.
    mockWindow.width = 320;
    mockWindow.fontScale = 2;
    try {
      for (const mode of ['daily', 'weekly', 'monthly', 'yearly'] as const) {
        const rows = mode === 'daily' ? DAY : mode === 'monthly' ? MONTH : mode === 'yearly' ? YEAR : WEEK;
        const renderer = render({ rows, mode });
        expect(columns(renderer)).toHaveLength(rows.length);
        // Every column keeps at least a 48 dp target at the default scale.
        expect(CHART.columnWidth).toBeGreaterThanOrEqual(48);
      }
    } finally {
      mockWindow.width = 412;
      mockWindow.fontScale = 1;
    }
  });
});

/**
 * The month's clipped calendar weeks: SIX buckets for November 2026, of which the
 * first and last hold a single day. `displayLabel` is what the column prints.
 */
const NOVEMBER: OutcomeColumn[] = [
  { ...row('2026-11-01', '1 Nov', 0, 0, 5), displayLabel: '1\nNov' },
  { ...row('2026-11-02', '2 – 8 Nov', 3, 1, 31), displayLabel: '2–8\nNov' },
  { ...row('2026-11-09', '9 – 15 Nov', 3, 0, 32), displayLabel: '9–15\nNov' },
  { ...row('2026-11-16', '16 – 22 Nov', 3, 0, 32), displayLabel: '16–22\nNov' },
  { ...row('2026-11-23', '23 – 29 Nov', 2, 0, 33), displayLabel: '23–29\nNov' },
  { ...row('2026-11-30', '30 Nov', 0, 0, 5), displayLabel: '30\nNov' },
];

describe('the month column layout', () => {
  test('spreads four, five and six buckets across the plot when they fit', () => {
    const viewport = 360;
    for (const count of [4, 5, 6]) {
      const layout = monthColumnLayout(viewport, count, 1);
      // Everything fits, so there is NO end spacer: the first target starts at 0
      // and the last one ends exactly at the viewport edge.
      expect(layout.overflowing).toBe(false);
      expect(layout.edgePadding).toBe(0);
      expect(layout.contentWidth).toBe(viewport);
      expect(layout.columnWidth * count + TPL.monthColumnGap * (count - 1)).toBeCloseTo(
        viewport,
        6,
      );
      // ...and a cell is never squeezed below a real touch target.
      expect(layout.columnWidth).toBeGreaterThanOrEqual(TPL.monthColumnMinWidth);
    }
  });

  test('overflows with a REAL gutter at both ends of the scroll content', () => {
    const viewport = 200;
    const count = 6;
    const layout = monthColumnLayout(viewport, count, 2);
    expect(layout.overflowing).toBe(true);
    // The target keeps its scaled minimum instead of shrinking to fit...
    expect(layout.columnWidth).toBe(96);
    expect(layout.edgePadding).toBe(TPL.monthEdgePadding);
    // ...and BOTH 8 dp gutters are inside the scrollable content, so the last
    // column and its label can be brought fully clear of the edge.
    expect(layout.contentWidth).toBe(
      TPL.monthEdgePadding * 2 +
        layout.columnWidth * count +
        TPL.monthColumnGap * (count - 1),
    );
    expect(layout.contentWidth).toBeGreaterThan(viewport);
  });

  test('builds the two-line bucket from the row dates, not from its label', () => {
    expect(compactMonthBucketLabel('2026-11-01', '2026-11-01', 'Nov', '1 Nov')).toBe('1\nNov');
    expect(compactMonthBucketLabel('2026-11-02', '2026-11-08', 'Nov', '2 – 8 Nov')).toBe(
      '2–8\nNov',
    );
    // A bucket that crosses into another month keeps the full row label.
    expect(compactMonthBucketLabel('2026-11-30', '2026-12-06', 'Nov', '30 Nov – 6 Dec')).toBe(
      '30 Nov – 6 Dec',
    );
  });

  test('draws all six November buckets with two-line labels', () => {
    const renderer = render({ rows: NOVEMBER, mode: 'monthly' });
    expect(columns(renderer)).toHaveLength(6);
    const printed = renderer.root.findAllByType(Text).map((node) => node.props.children);
    // Every bucket keeps its exact date range, just on two lines.
    for (const bucket of NOVEMBER) {
      expect(printed).toContain(bucket.displayLabel);
    }
    // The full context (with the year) stays on the accessible label.
    expect(columns(renderer)[1].props.accessibilityLabel).toBe(NOVEMBER[1].accessibilityLabel);
  });

  test('the single-day ends stay at their real share of the shared scale', () => {
    // November holds 150 planned slots: 5 + 35 + 35 + 35 + 35 + 5.
    expect(NOVEMBER.reduce((sum, bucket) => sum + bucket.counts.total, 0)).toBe(150);
    const scale = chartScaleMax(NOVEMBER);
    expect(scale).toBe(35);
    // A five-slot bucket is 1/7 of the plot, never a full-height bar.
    const [, , pending] = outcomeSegments(NOVEMBER[0].counts, scale, CHART.plotHeight);
    expect(pending.height).toBeCloseTo((CHART.plotHeight * 5) / 35, 6);
    expect(pending.height).toBeLessThan(CHART.plotHeight / 2);
  });
});
