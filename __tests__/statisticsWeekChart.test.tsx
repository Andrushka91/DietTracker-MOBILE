// The Week chart: display geometry and row selection.
//
// The chart is PRESENTATION. It must never draw a two-slot day as tall as a
// five-slot day, and pressing a column must select the EXACT row it belongs to
// (and only that row) - the open action stays in the selection panel. These
// tests pin those two behaviours plus the empty/zero-count safety net, and
// nothing about colours, spacing or snapshots.

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
  WeeklyOutcomeChart,
  type WeeklyChartRow,
} from '../src/ui/components/WeeklyOutcomeChart';
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
): WeeklyChartRow {
  const total = done + missed + pending;
  return {
    key: `${date}|${date}`,
    label,
    valueLabel: `${done} / ${total}`,
    accessibilityLabel: `${label}: ${done} / ${total} done`,
    counts: { done, missed, pending, total, upcoming: allLater ? total : 0 },
    allLater,
  };
}

const WEEK: WeeklyChartRow[] = [
  row('2026-10-26', 'Mon 26', 2, 0, 3),
  row('2026-10-27', 'Tue 27', 0, 3, 2),
  row('2026-10-28', 'Wed 28', 1, 0, 4),
  row('2026-10-29', 'Thu 29', 3, 0, 2),
  row('2026-10-30', 'Fri 30', 0, 0, 5, true),
  row('2026-10-31', 'Sat 31', 0, 0, 5, true),
  row('2026-11-01', 'Sun 1', 0, 0, 5, true),
];

function render(props: {
  rows?: WeeklyChartRow[];
  selectedKey?: string | null;
  onToggleRow?: (key: string) => void;
}): Renderer {
  let renderer: Renderer | undefined;
  act(() => {
    renderer = TestRenderer.create(
      <WeeklyOutcomeChart
        rows={props.rows ?? WEEK}
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
        <WeeklyOutcomeChart
          rows={WEEK}
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
});
