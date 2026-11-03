// The "meal-slot completion" counts, drawn exactly as the round-3 mockup draws
// them:
//
//      ✓ 19            ✕ 7            ◷ 9
//      Done            Missed         Pending
//
//      All 35 planned slots in this week.
//
// The defect these tests pin: all three counts shared ONE line
// ("✓ 19 Done   ✕ 7 Missed   ◷ 9 Pending") in 14 pt semibold, centred in their
// third of the row. The numbers - the only reason the block exists - were the
// smallest text in it, and each label drifted with the width of the number above
// it instead of forming a column.

import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { StyleSheet, Text, View } from 'react-native';

import { SlotCounts } from '../src/ui/components/SlotCounts';
import { darkColors, fonts, lightColors, type ThemeColors } from '../src/ui/theme';

type Renderer = TestRenderer.ReactTestRenderer;

const COUNTS = { done: 19, missed: 7, pending: 9, total: 35, upcoming: 0 };

function render(
  counts: typeof COUNTS = COUNTS,
  colors: ThemeColors = lightColors,
  period = 'week',
): Renderer {
  let renderer: Renderer | undefined;
  act(() => {
    renderer = TestRenderer.create(<SlotCounts counts={counts} period={period} colors={colors} />);
  });
  if (renderer === undefined) {
    throw new Error('the counts did not render');
  }
  return renderer;
}

function styleOf(node: { props: { style?: unknown } }): Record<string, unknown> {
  return (StyleSheet.flatten(node.props.style as never) ?? {}) as Record<string, unknown>;
}

function viewsWhere(
  renderer: Renderer,
  predicate: (style: Record<string, unknown>) => boolean,
): TestRenderer.ReactTestInstance[] {
  return renderer.root.findAllByType(View).filter((node) => predicate(styleOf(node)));
}

/** The three cells (each `flex: 1` with its own row gap). */
function cells(renderer: Renderer): TestRenderer.ReactTestInstance[] {
  return viewsWhere(renderer, (style) => style.flex === 1 && typeof style.rowGap === 'number');
}

/** The closing sentence: the only Text made of several children. */
function sentence(renderer: Renderer): TestRenderer.ReactTestInstance {
  const found = renderer.root
    .findAllByType(Text)
    .find((node) => Array.isArray(node.props.children));
  if (found === undefined) {
    throw new Error('the closing sentence was not rendered');
  }
  return found;
}


describe('the meal-slot completion counts', () => {
  test('stacks a glyph and a BOLD number over the label, one cell per state', () => {
    for (const colors of [lightColors, darkColors]) {
      const renderer = render(COUNTS, colors);
      const found = cells(renderer);
      expect(found).toHaveLength(3);

      const expected = [
        ['icon:checkmark', 19, 'Done'],
        ['icon:close', 7, 'Missed'],
        ['icon:time-outline', 9, 'Pending'],
      ] as const;

      found.forEach((cell, index) => {
        const [glyph, number, label] = cell.findAllByType(Text);
        const [expectedGlyph, expectedNumber, expectedLabel] = expected[index];

        // Line 1: the state mark and the number it counts, on ONE row...
        expect(glyph.props.accessibilityLabel).toBe(expectedGlyph);
        const head = cell
          .findAllByType(View)
          .find((node) => styleOf(node).flexDirection === 'row');
        expect(head).toBeDefined();
        expect(head?.findAllByType(Text)).toHaveLength(2);
        expect(number.props.children).toBe(expectedNumber);

        // ...and line 2: the state's name, under the GLYPH (left aligned), so the
        // three labels form columns instead of following their numbers.
        expect(label.props.children).toBe(expectedLabel);
        expect(styleOf(cell).alignItems).toBeUndefined();

        // The number is the loudest text of the block: 22 pt bold ink with
        // tabular figures, so two- and three-digit counts stay aligned.
        const numberStyle = styleOf(number);
        expect(numberStyle.fontSize).toBe(22);
        expect(numberStyle.fontFamily).toBe(fonts.bold);
        expect(numberStyle.fontVariant).toEqual(['tabular-nums']);
        expect(numberStyle.color).toBe(colors.text);

        // The label is a quiet second line, not another number.
        const labelStyle = styleOf(label);
        expect(labelStyle.fontSize).toBe(14);
        expect(labelStyle.fontFamily).toBe(fonts.regular);
        expect(labelStyle.color).toBe(colors.textSecondary);
      });
    }
  });

  test('keeps each count in the state colour the whole app uses', () => {
    const colors = lightColors;
    const renderer = render(COUNTS, colors);
    const glyphs = renderer.root.findAll(
      (node) =>
        typeof node.props?.accessibilityLabel === 'string' &&
        node.props.accessibilityLabel.startsWith('icon:'),
    );
    const colourOf = (glyph: string): unknown =>
      glyphs.find((node) => node.props.accessibilityLabel === glyph)?.props.color;
    expect(colourOf('icon:checkmark')).toBe(colors.done);
    expect(colourOf('icon:close')).toBe(colors.missed);
    expect(colourOf('icon:time-outline')).toBe(colors.pending);
  });

  test('closes with "All <total> planned slots in this <period>", total set apart', () => {
    for (const colors of [lightColors, darkColors]) {
      const caption = sentence(render(COUNTS, colors));
      const [before, total, after] = caption.props.children as [
        string,
        React.ReactElement<{ children: number; style?: unknown }>,
        string,
      ];
      expect(before).toBe('All ');
      expect(total.props.children).toBe(35);
      // The total is the one bold run in the sentence, in the theme's ink...
      expect(styleOf(total).fontFamily).toBe(fonts.bold);
      expect(styleOf(total).color).toBe(colors.text);
      expect(after).toBe(' planned slots in this week.');
      // ...and everything around it stays the muted caption tone.
      expect(styleOf(caption).color).toBe(colors.textMuted);
      expect(styleOf(caption).fontSize).toBe(12);
    }
  });

  test('names the upcoming slots only when the period has any', () => {
    const quiet = sentence(render(COUNTS)).props.children as unknown[];
    expect(quiet.join('')).not.toContain('upcoming');

    const busy = sentence(render({ ...COUNTS, upcoming: 2 })).props.children as unknown[];
    expect(busy.join('')).toContain('Includes 2 upcoming slots.');
    // The total keeps its place and its weight; the extra sentence follows it.
    expect(busy[0]).toBe('All ');
    expect((busy[1] as React.ReactElement<{ children: number }>).props.children).toBe(35);
  });

  test('names the period it was given (day / month / year)', () => {
    const month = sentence(render(COUNTS, lightColors, 'month')).props.children as string[];
    expect(month[2]).toBe(' planned slots in this month.');
  });
});
