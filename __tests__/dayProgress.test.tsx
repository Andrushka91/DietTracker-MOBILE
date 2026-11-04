// The dashboard's day header, drawn the way the r3 reference draws it:
//
//    ╭────────╮   ┌───────────────────────────────────────┐
//    │  1/5   │   │ ✓ 1  │ ✕ 1  │ ◷ 3                  │
//    │  Done  │   │ Done  │Missed│ Pending              │
//    ╰────────╯   └───────────────────────────────────────┘
//
// The ring is REAL vector geometry: one dashed `Circle` per state with a round
// line cap, so the arcs are smooth, equally thick and rounded at both ends - not
// a chain of dots or short strokes. These tests pin the geometry (each state's
// exact share, equal gaps, one arc per state), the degenerate days (no slots, one
// state), the three-column metrics strip with its rules, and the responsive
// switch: one row on a phone, stacked rows on a narrow screen or at very large
// text.

import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { StyleSheet, Text } from 'react-native';
import { Circle } from 'react-native-svg';

import { DayProgress, DAY_RING_SIZE, DAY_RING_THICKNESS } from '../src/ui/components/DayProgress';
import { RING_GAP_RATIO, ringArcs } from '../src/ui/components/ProgressRing';
import { t } from '../src/ui/strings';
import { darkColors, fonts, lightColors, typeScale, type ThemeColors } from '../src/ui/theme';

/**
 * The strip's responsive thresholds are read from the window. RN's jest window
 * reports fontScale 2, so a phone-sized window is set explicitly here.
 */
const mockWindow = { width: 390, height: 844, scale: 3, fontScale: 1 };
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => mockWindow,
}));

/** Every test starts on a phone; the responsive cases move the window themselves. */
beforeEach(() => {
  mockWindow.width = 390;
  mockWindow.fontScale = 1;
});

type Renderer = TestRenderer.ReactTestRenderer;

/** The header's ring, as `DayProgress` draws it. */
const SIZE = DAY_RING_SIZE;
const THICKNESS = DAY_RING_THICKNESS;
const RADIUS = (SIZE - THICKNESS) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
/** Dash gap: the visible air plus the two round caps (half a stroke each). */
const DASH_GAP = THICKNESS * RING_GAP_RATIO + THICKNESS;

const SEGMENTS = [
  { value: 1, color: 'done' },
  { value: 1, color: 'missed' },
  { value: 3, color: 'pending' },
];

function render(
  counts = { completed: 1, missed: 1, pending: 3, totalSlots: 5 },
  colors: ThemeColors = lightColors,
): Renderer {
  let renderer: Renderer | undefined;
  act(() => {
    renderer = TestRenderer.create(<DayProgress {...counts} colors={colors} />);
  });
  if (renderer === undefined) {
    throw new Error('the day progress did not render');
  }
  return renderer;
}

function styleOf(node: { props: { style?: unknown } }): Record<string, unknown> {
  return (StyleSheet.flatten(node.props.style as never) ?? {}) as Record<string, unknown>;
}

/** The arcs actually handed to the renderer. */
function arcsOf(renderer: Renderer): TestRenderer.ReactTestInstance[] {
  return renderer.root.findAllByType(Circle);
}

describe('the ring geometry', () => {
  const arcs = ringArcs(SEGMENTS, SIZE, THICKNESS);

  test('one arc per state, in the order the day is read', () => {
    expect(arcs).toHaveLength(3);
    expect(arcs.map((arc) => arc.color)).toEqual(['done', 'missed', 'pending']);
  });

  test('each state covers its own share of the circle (20 / 20 / 60)', () => {
    const shares = arcs.map((arc) => ((arc.dash?.[0] ?? CIRCUMFERENCE) + DASH_GAP) / CIRCUMFERENCE);
    expect(shares[0]).toBeCloseTo(0.2, 6);
    expect(shares[1]).toBeCloseTo(0.2, 6);
    expect(shares[2]).toBeCloseTo(0.6, 6);
    expect(shares.reduce((sum, share) => sum + share, 0)).toBeCloseTo(1, 6);
  });

  test('the gaps are equal, and leave a real break between the arcs', () => {
    const shares = [0.2, 0.2, 0.6].map((share) => share * CIRCUMFERENCE);
    arcs.forEach((arc, index) => {
      const drawn = arc.dash?.[0] ?? CIRCUMFERENCE;
      const rest = arc.dash?.[1] ?? 0;
      // The dash pattern always adds up to the whole circumference...
      expect(drawn + rest).toBeCloseTo(CIRCUMFERENCE, 6);
      // ...and every arc is inset by exactly the same dash gap.
      expect(shares[index] - drawn).toBeCloseTo(DASH_GAP, 6);
    });
    // The AIR the eye sees: the dash gap minus the two round caps.
    expect(DASH_GAP - THICKNESS).toBeCloseTo(THICKNESS * RING_GAP_RATIO, 6);
  });

  test('the arcs follow each other clockwise, starting at 12 o\u2019clock', () => {
    const starts = arcs.map((arc) => -arc.offset);
    expect(starts[0]).toBeCloseTo(DASH_GAP / 2, 6);
    expect(starts[1]).toBeGreaterThan(starts[0]);
    expect(starts[2]).toBeGreaterThan(starts[1]);
    // Each start is one share further round than the last.
    expect(starts[1] - starts[0]).toBeCloseTo(CIRCUMFERENCE * 0.2, 6);
    expect(starts[2] - starts[1]).toBeCloseTo(CIRCUMFERENCE * 0.2, 6);
  });

  test('a day with no slots draws no arcs at all', () => {
    expect(ringArcs([], SIZE, THICKNESS)).toEqual([]);
    expect(ringArcs([{ value: 0, color: 'done' }], SIZE, THICKNESS)).toEqual([]);
  });

  test('a day in ONE state is one closed circle - no seam', () => {
    const closed = ringArcs([{ value: 5, color: 'pending' }], SIZE, THICKNESS);
    expect(closed).toHaveLength(1);
    expect(closed[0].dash).toBeNull();
    expect(closed[0].offset).toBe(0);
  });

  test('a zero value between two real ones is simply not drawn', () => {
    const arcsWithGap = ringArcs(
      [
        { value: 2, color: 'done' },
        { value: 0, color: 'missed' },
        { value: 2, color: 'pending' },
      ],
      SIZE,
      THICKNESS,
    );
    expect(arcsWithGap.map((arc) => arc.color)).toEqual(['done', 'pending']);
    // Two arcs, so both get a real gap (a lone state would close the ring).
    expect(arcsWithGap[0].dash?.[0]).toBeLessThan(CIRCUMFERENCE / 2);
  });
});


describe('the day progress block', () => {
  test('draws one smooth arc per state, equally thick, with round ends', () => {
    for (const colors of [lightColors, darkColors]) {
      const renderer = render(undefined, colors);
      const arcs = arcsOf(renderer);
      expect(arcs).toHaveLength(3);
      // The colours are the app's state colours, in the order done / missed / pending.
      expect(arcs.map((arc) => arc.props.stroke)).toEqual([
        colors.done,
        colors.missed,
        colors.barPending,
      ]);
      for (const arc of arcs) {
        // Vector geometry: one circle of the ring's radius, stroked evenly and
        // capped round at both ends - never a fill, never a dot.
        expect(arc.props.r).toBeCloseTo(RADIUS, 6);
        expect(arc.props.strokeWidth).toBe(THICKNESS);
        expect(arc.props.strokeLinecap).toBe('round');
        expect(arc.props.fill).toBe('none');
        expect(arc.props.strokeDasharray).toHaveLength(2);
      }
    }
  });

  test('the arc lengths follow the REAL counts', () => {
    // 1 of 5 done, 3 of 5 missed, 1 of 5 pending - a different day, different arcs.
    const renderer = render({ completed: 1, missed: 3, pending: 1, totalSlots: 5 });
    const [done, missed] = arcsOf(renderer);
    const drawn = (arc: TestRenderer.ReactTestInstance): number =>
      (arc.props.strokeDasharray as number[])[0];
    expect(drawn(missed)).toBeGreaterThan(drawn(done) * 2.5);
    // And the fraction inside the ring is the day's own.
    expect(
      renderer.root.findAllByType(Text).some((node) => node.props.children === '1/5'),
    ).toBe(true);
  });

  test('puts the fraction and its caption INSIDE the ring', () => {
    const renderer = render();
    const texts = renderer.root.findAllByType(Text);
    const fraction = texts.find((node) => node.props.children === '1/5');
    expect(fraction).toBeDefined();
    const fractionStyle = styleOf(fraction!);
    expect(fractionStyle.fontFamily).toBe(fonts.bold);
    // 22 pt bold: the reference's fraction, tabular so days do not jiggle.
    expect(fractionStyle.fontSize).toBe(typeScale.title2);
    expect(fractionStyle.fontVariant).toEqual(['tabular-nums']);
    // Chart text is the ONLY text capped, because it lives inside the circle.
    expect(fraction!.props.maxFontSizeMultiplier).toBe(1.4);

    const caption = texts.find(
      (node) => node.props.children === t('Dashboard_CountDone') && styleOf(node).fontSize === 11,
    );
    expect(caption).toBeDefined();
    expect(styleOf(caption!).color).toBe(lightColors.textMuted);
    expect(caption!.props.maxFontSizeMultiplier).toBe(1.4);
  });

  test('lists the three counts in the strip: glyph, bold number, label', () => {
    const renderer = render();
    const glyph = (label: string): unknown =>
      renderer.root.findAll((node) => node.props?.accessibilityLabel === label)[0]?.props.color;
    expect(glyph('icon:checkmark')).toBe(lightColors.done);
    expect(glyph('icon:close')).toBe(lightColors.missed);
    expect(glyph('icon:time-outline')).toBe(lightColors.pending);

    const texts = renderer.root.findAllByType(Text);
    const numbers = texts.filter((node) => typeof node.props.children === 'number');
    expect(numbers.map((node) => node.props.children)).toEqual([1, 1, 3]);
    for (const number of numbers) {
      expect(styleOf(number).fontFamily).toBe(fonts.bold);
      // 22 pt, the same weight as the fraction: full size, never capped.
      expect(styleOf(number).fontSize).toBe(typeScale.title2);
      expect(styleOf(number).color).toBe(lightColors.text);
      expect(number.props.maxFontSizeMultiplier).toBeUndefined();
    }

    const labels = texts.filter(
      (node) => typeof node.props.children === 'string' && styleOf(node).fontSize === 12,
    );
    expect(labels.map((node) => node.props.children)).toEqual([
      t('Dashboard_CountDone'),
      t('Dashboard_CountMissed'),
      t('Dashboard_CountPending'),
    ]);
    for (const label of labels) {
      expect(styleOf(label).color).toBe(lightColors.textMuted);
    }
  });

  test('a fresh day is one grey circle: nothing done, nothing missed', () => {
    const renderer = render({ completed: 0, missed: 0, pending: 5, totalSlots: 5 });
    const arcs = arcsOf(renderer);
    expect(arcs).toHaveLength(1);
    expect(arcs[0].props.stroke).toBe(lightColors.barPending);
    // Closed: no dash, so the ring has no seam at 12 o'clock.
    expect(arcs[0].props.strokeDasharray).toBeUndefined();
    expect(
      renderer.root.findAllByType(Text).some((node) => node.props.children === '0/5'),
    ).toBe(true);
  });
});

/**
 * The r3 strip: an 80 pt ring at the LEFT and, at its right, ONE tinted panel
 * with Done | Missed | Pending as three equal columns (icon + 22 pt value above a
 * 12 pt label, 1 pt rules between them). Narrow screens and very large text turn
 * the columns into full-width rows under a centred ring instead of shrinking.
 */
describe('the metrics strip layout', () => {
  /** Host views only: composite wrappers would count every node twice. */
  function hosts(renderer: Renderer): TestRenderer.ReactTestInstance[] {
    return renderer.root.findAll((node) => typeof node.type === 'string');
  }

  /** The OUTLINED panel: 64 pt floor, 12 pt corners, the card's own surface. */
  function stripOf(renderer: Renderer): TestRenderer.ReactTestInstance {
    const strip = hosts(renderer)
      .filter(
        (node) =>
          styleOf(node).minHeight === 64 && styleOf(node).borderRadius === 12,
      )
      .pop();
    if (strip === undefined) {
      throw new Error('no metrics strip');
    }
    return strip;
  }

  test('is an 80 pt ring with an 8 pt stroke, and the strip fills the rest', () => {
    expect(DAY_RING_SIZE).toBe(80);
    expect(DAY_RING_THICKNESS).toBe(8);
    for (const arc of arcsOf(render(undefined, lightColors))) {
      expect(arc.props.strokeWidth).toBe(8);
      expect(arc.props.r).toBeCloseTo((80 - 8) / 2, 6);
    }
    const strip = styleOf(stripOf(render(undefined, lightColors)));
    expect(strip.flex).toBe(1);
    // The SAME surface as the card it sits on: not a grey/blue inner panel.
    expect(strip.backgroundColor).toBe(lightColors.cardFill);
    // ...and the thin neutral frame the day's bulk buttons wear.
    expect(strip.borderWidth).toBe(1);
    expect(strip.borderColor).toBe(lightColors.cardDivider);
  });

  test('holds THREE equal columns in ONE row, split by two 1 pt rules', () => {
    const renderer = render();
    const strip = stripOf(renderer);
    expect(styleOf(strip).flexDirection).toBe('row');

    // Three columns, each flexing equally, so the numbers share the width. (The
    // strip itself is the fourth flexed node, hence the 4 pt column padding.)
    const columns = strip.findAll(
      (node) =>
        typeof node.type === 'string' &&
        styleOf(node).flex === 1 &&
        styleOf(node).minWidth === 0 &&
        styleOf(node).paddingHorizontal === 4,
    );
    expect(columns).toHaveLength(3);

    // Two rules, 1 pt wide and 32 pt tall, in the card's border tone.
    const rules = strip.findAll(
      (node) =>
        typeof node.type === 'string' &&
        styleOf(node).width === 1 &&
        styleOf(node).height === 32,
    );
    expect(rules).toHaveLength(2);
    for (const rule of rules) {
      expect(styleOf(rule).backgroundColor).toBe(lightColors.border);
    }
  });

  test('keeps icon + value on one line above each label', () => {
    const renderer = render();
    const strip = stripOf(renderer);
    // The three icon/value rows: a row, 4 pt apart, centred.
    const tops = strip.findAll(
      (node) => typeof node.type === 'string' && styleOf(node).columnGap === 4,
    );
    expect(tops).toHaveLength(3);
    for (const top of tops) {
      expect(styleOf(top).flexDirection).toBe('row');
      expect(styleOf(top).justifyContent).toBe('center');
    }
    // ...and each label sits beneath, centred in its column.
    const labels = renderer.root.findAllByType(Text).filter(
      (node) => typeof node.props.children === 'string' && styleOf(node).fontSize === 12,
    );
    for (const label of labels) {
      expect(styleOf(label).textAlign).toBe('center');
      expect(styleOf(label).marginTop).toBe(3);
    }
  });

  test('stacks into full-width rows below 340 dp, under a centred ring', () => {
    mockWindow.width = 320;
    const renderer = render();
    // The block itself stacks: ring above, strip below.
    const block = hosts(renderer).find(
      (node) => styleOf(node).columnGap === 12 && styleOf(node).marginTop === 8,
    );
    expect(block).toBeDefined();
    expect(styleOf(block!).flexDirection).toBe('column');

    const strip = stripOf(renderer);
    expect(styleOf(strip).flexDirection).toBe('column');

    // One 44 pt row per state: value and glyph lead, the label follows.
    const rows = strip.findAll(
      (node) =>
        typeof node.type === 'string' &&
        styleOf(node).minHeight === 44 &&
        styleOf(node).flexDirection === 'row',
    );
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(styleOf(row).justifyContent).toBe('flex-start');
    }
    // The rules turn horizontal: 1 pt tall, stretched across the strip.
    const rules = strip.findAll(
      (node) => typeof node.type === 'string' && styleOf(node).height === 1,
    );
    expect(rules).toHaveLength(2);
    for (const rule of rules) {
      expect(styleOf(rule).alignSelf).toBe('stretch');
    }
  });

  test('stacks above a 1.4 font scale, and stays side by side at 1.2', () => {
    mockWindow.fontScale = 1.2;
    expect(styleOf(stripOf(render())).flexDirection).toBe('row');

    mockWindow.fontScale = 1.5;
    expect(styleOf(stripOf(render())).flexDirection).toBe('column');
  });

  test('keeps the app state colours in both themes', () => {
    for (const colors of [lightColors, darkColors]) {
      const strip = styleOf(stripOf(render(undefined, colors)));
      // The panel is an OUTLINE on the card's own surface in both themes - no
      // wash, no hardcoded white, and the frame matches the bulk buttons.
      expect(strip.backgroundColor).toBe(colors.cardFill);
      expect(strip.borderWidth).toBe(1);
      expect(strip.borderColor).toBe(colors.cardDivider);
      const rules = render(undefined, colors).root.findAll(
        (node) =>
          typeof node.type === 'string' &&
          styleOf(node).width === 1 &&
          styleOf(node).height === 32,
      );
      expect(rules.length).toBe(2);
      for (const rule of rules) {
        expect(styleOf(rule).backgroundColor).toBe(colors.border);
      }
    }
  });
});

