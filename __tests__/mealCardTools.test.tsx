// The meal card's ACTION TOOLBAR, drawn the way the r3 reference card draws it:
//
//   meal (category / time / status badge, title, description, photos)
//   ────────────────────────────────────────────────────────────────
//   ░ [camera] [edit] [clear]              │        [✕ missed] [✓ done] ░
//   ░                  nearly-white toolbar                         ░
//
// The five tools are the card's WHOLE affordance, and every one of them can go
// missing silently: a renamed glyph renders as nothing, a tile below 44 pt of
// touch is unusable with a thumb, a line in `hairline` disappears on the dark
// card. These tests pin the glyph names (header, clock, pencil, bin), their ink,
// the two groups and their short separator, the real 44 pt targets around the
// 36 pt visible tiles, the toolbar's near-white tint and the single inset rule in
// BOTH themes, and that the meal's CURRENT state stays visible on its mark.

import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { StyleSheet, View } from 'react-native';

import { MealCategoryKey, MealStatus, SyncStatus } from '../src/domain/enums';
import { MealCategory, MealEntry } from '../src/domain/models';
import {
  CARD_STRIP_PADDING,
  CARD_TOOLBAR_GAP,
  CARD_TOOLBAR_SEPARATOR_HEIGHT,
  CARD_TOOL_GAP,
  CARD_TOOL_GLYPH,
  CARD_TOOL_RADIUS,
  CARD_TOOL_SIZE,
  CARD_TOOL_TOUCH,
  MealCard,
} from '../src/ui/components/MealCard';
import { t } from '../src/ui/strings';
import { darkColors, lightColors, metrics, tintAlpha } from '../src/ui/theme';

/**
 * The card's responsive branch is read from the window. RN's jest window reports
 * fontScale 2, so a phone-sized window is set explicitly here; the large-text
 * fallback gets its own test in `mealCardRead.test.tsx`.
 */
const mockWindow = { width: 390, height: 844, scale: 3, fontScale: 1 };
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => mockWindow,
}));

const NOW = new Date('2026-11-01T18:00:00.000Z');

const CATEGORY: MealCategory = {
  id: 'cat-breakfast',
  fixedCategoryKey: MealCategoryKey.Breakfast,
  name: 'Breakfast',
  color: '#FF0F6CBD',
  icon: '🥐',
  defaultTime: '07:30:00',
  displayOrder: 0,
};

/** Pending: the badge draws its clock glyph, next to the five tools. */
const MEAL: MealEntry = {
  id: 'meal-breakfast',
  localProfileId: 'profile',
  date: '2026-11-01',
  mealCategoryId: CATEGORY.id,
  mealCategoryKey: MealCategoryKey.Breakfast,
  title: 'Mic dejun',
  ingredients: 'Gem cu paine si lapte',
  plannedTime: '07:30:00',
  status: MealStatus.Pending,
  completedAt: null,
  createdAt: NOW.toISOString(),
  updatedAt: NOW.toISOString(),
  revision: 1,
  syncStatus: SyncStatus.PendingUpload,
  cloudRevision: null,
  contentHash: null,
};

type Renderer = TestRenderer.ReactTestRenderer;

function render(isDark: boolean, meal: MealEntry = MEAL): Renderer {
  let renderer: Renderer | undefined;
  act(() => {
    renderer = TestRenderer.create(
      <MealCard
        meal={meal}
        category={CATEGORY}
        photos={[]}
        use12HourClock={false}
        now={NOW}
        isDark={isDark}
        onSave={async () => null}
        onComplete={async () => undefined}
        onMissed={async () => undefined}
        onClear={() => undefined}
        onAddPhoto={() => undefined}
        onRemovePhoto={() => undefined}
        onOpenPhoto={() => undefined}
      />,
    );
  });
  if (renderer === undefined) {
    throw new Error('the meal card did not render');
  }
  return renderer;
}


/** The Pressable behind a tool, found by the accessibility label it carries. */
function tool(renderer: Renderer, label: string): TestRenderer.ReactTestInstance {
  const found = renderer.root
    .findAll(
      (node) =>
        node.props?.accessibilityLabel === label && typeof node.props.onPress === 'function',
    )
    .pop();
  if (found === undefined) {
    throw new Error(`no tool labelled "${label}"`);
  }
  return found;
}

/** The visible 36 pt chip inside a tool's 44 pt pressable. */
function tileOf(renderer: Renderer, label: string): TestRenderer.ReactTestInstance {
  const found = tool(renderer, label)
    .findAllByType(View)
    .find((node) => styleOf(node).width === CARD_TOOL_SIZE);
  if (found === undefined) {
    throw new Error(`no visible tile inside "${label}"`);
  }
  return found;
}

/** A node's style, whether it is still a pressable function or already an array. */
function styleOf(node: TestRenderer.ReactTestInstance): Record<string, unknown> {
  const style = node.props.style;
  const resolved = typeof style === 'function' ? style({ pressed: false }) : style;
  return (StyleSheet.flatten(resolved) ?? {}) as Record<string, unknown>;
}

/** Every host View carrying a style that matches the predicate. */
function viewsWhere(
  renderer: Renderer,
  predicate: (style: Record<string, unknown>) => boolean,
): TestRenderer.ReactTestInstance[] {
  return renderer.root.findAllByType(View).filter((node) => predicate(styleOf(node)));
}

describe('the meal card tools', () => {
  test('draws all five glyphs, in the reference order', () => {
    const renderer = render(true);
    const labels = renderer.root
      .findAll(
        (node) =>
          typeof node.props?.accessibilityLabel === 'string' &&
          // All three icon faces carry a prefix - Edit is Feather's pencil and
          // the Clear bin is the Material one.
          (node.props.accessibilityLabel.startsWith('icon:') ||
            node.props.accessibilityLabel.startsWith('feather:') ||
            node.props.accessibilityLabel.startsWith('material:')),
      )
      .map((node) => node.props.accessibilityLabel as string);
    // Each mocked glyph reports itself twice (the Text and its host view).
    const glyphs = [...new Set(labels)];

    expect(glyphs).toEqual([
      // The header's category glyph comes first (Breakfast's bowl and spoon).
      'material:bowl-mix-outline',
      // The PENDING badge repeats its word with a clock - not a bare dot.
      'icon:time-outline',
      'icon:camera-outline',
      // The mockup's pencil: a square open at the top-right with a plain pencil
      // through it - Feather `edit`, not Ionicons' nibbed `create-outline`.
      'feather:edit',
      // The mockup's bin: a thin lid line overhanging the body, an arched handle
      // and TWO short bars inside - Feather `trash-2`. Neither Ionicons' tapered
      // three-bar can nor Material's filled-lid can is this shape.
      'feather:trash-2',
      'icon:close',
      'icon:checkmark',
    ]);
  });

  test('draws the Clear bin in the card ink, never the missed red', () => {
    for (const colors of [lightColors, darkColors]) {
      const renderer = render(colors.dark);
      const bin = renderer.root.findAll(
        (node) => node.props?.accessibilityLabel === 'feather:trash-2',
      );
      expect(bin.length).toBeGreaterThan(0);
      for (const node of bin) {
        // Near-black on the light card, near-white on the dark one: the theme's
        // ink, exactly like Edit and X beside it. A literal #000 would vanish
        // in dark mode, and the old `missed` red made Clear shout louder than
        // the meal it belongs to.
        expect(node.props.color).toBe(colors.text);
      }
      expect(colors.text).not.toBe(colors.missed);
    }
  });

  test('gives every tool a real 44 pt pressable around a 36 pt tile', () => {
    const renderer = render(false);
    for (const label of [
      t('Photo_Add'),
      t('Common_Edit'),
      t('Meal_Clear'),
      t('Meal_MarkMissed'),
      t('Meal_MarkDone'),
    ]) {
      // The pressable IS the touch target: 44 x 44, with no hit slop that could
      // overlap the neighbouring tool.
      const touch = styleOf(tool(renderer, label));
      expect(touch.width).toBe(CARD_TOOL_TOUCH);
      expect(touch.height).toBe(CARD_TOOL_TOUCH);
      expect(tool(renderer, label).props.hitSlop).toBeUndefined();
      expect(CARD_TOOL_TOUCH).toBeGreaterThanOrEqual(44);

      // ...and the visible chip inside it is the compact 36 pt outlined tile.
      const tile = tileOf(renderer, label);
      expect(styleOf(tile).width).toBe(CARD_TOOL_SIZE);
      expect(styleOf(tile).height).toBe(CARD_TOOL_SIZE);
      expect(styleOf(tile).borderRadius).toBe(CARD_TOOL_RADIUS);
      expect(styleOf(tile).borderWidth).toBe(1);
      expect(CARD_TOOL_SIZE).toBe(36);
    }
    // A consistent 20 pt glyph in every tile, at both ends of the strip.
    expect(CARD_TOOL_GLYPH).toBe(20);
    expect(CARD_TOOL_GLYPH).toBeLessThan(CARD_TOOL_SIZE);
  });

  test('groups camera / edit / clear on the left and missed / done on the right', () => {
    const renderer = render(false);
    const groups = viewsWhere(
      renderer,
      (style) => style.flexDirection === 'row' && style.columnGap === CARD_TOOL_GAP,
    );
    expect(groups).toHaveLength(2);
    const labelsOf = (group: TestRenderer.ReactTestInstance): string[] =>
      group
        .findAll(
          (node) =>
            typeof node.props?.accessibilityLabel === 'string' &&
            typeof node.props.onPress === 'function',
        )
        .map((node) => node.props.accessibilityLabel as string);

    expect(labelsOf(groups[0])).toEqual([t('Photo_Add'), t('Common_Edit'), t('Meal_Clear')]);
    expect(labelsOf(groups[1])).toEqual([t('Meal_MarkMissed'), t('Meal_MarkDone')]);
    expect(styleOf(groups[1]).justifyContent).not.toBe('flex-start');

    // ONE short separator between the two groups - not a line per boundary.
    const dividers = viewsWhere(
      renderer,
      (style) => style.width === 1 && style.height === CARD_TOOLBAR_SEPARATOR_HEIGHT,
    );
    expect(dividers).toHaveLength(1);
    // ...and it hugs the marks: the auto margin takes every free pixel.
    expect(styleOf(dividers[0]).marginLeft).toBe('auto');
    expect(CARD_TOOLBAR_SEPARATOR_HEIGHT).toBe(24);
    // Five 44 pt targets, two group gaps, the 8 pt air on both sides of the
    // separator and the toolbar's 10 pt padding still fit a 360 pt phone card.
    expect(
      CARD_TOOL_TOUCH * 5 + CARD_TOOL_GAP * 4 + CARD_TOOLBAR_GAP * 2 + 1 + CARD_STRIP_PADDING * 2,
    ).toBeLessThan(360 - 32 - 2);
  });

  test('marks the meal CURRENT state on the toolbar', () => {
    // A DONE meal: the check tile keeps a ring in the done colour, the X does not.
    const done = render(false, { ...MEAL, status: MealStatus.Done });
    expect(styleOf(tileOf(done, t('Meal_MarkDone'))).borderColor).toBe(lightColors.done);
    // Disabled (pressing it again changes nothing) but NOT faded: it is the answer.
    expect(styleOf(tool(done, t('Meal_MarkDone'))).opacity).toBe(1);
    expect(styleOf(tileOf(done, t('Meal_MarkMissed'))).borderColor).toBe(lightColors.cardDivider);

    // A missed meal mirrors it.
    const missed = render(false, { ...MEAL, status: MealStatus.Missed });
    expect(styleOf(tileOf(missed, t('Meal_MarkMissed'))).borderColor).toBe(lightColors.missed);
    expect(styleOf(tileOf(missed, t('Meal_MarkDone'))).borderColor).toBe(lightColors.cardDivider);
  });

  test('is a nearly-white toolbar under ONE inset 1 pt rule', () => {
    for (const colors of [lightColors, darkColors]) {
      const renderer = render(colors.dark);

      // The rule: 1 pt tall, inset 14 pt from BOTH card edges, in `cardDivider`.
      const rules = viewsWhere(
        renderer,
        (style) => style.height === 1 && style.marginHorizontal === 14,
      );
      expect(rules).toHaveLength(1);
      expect(styleOf(rules[0]).backgroundColor).toBe(colors.cardDivider);

      // The toolbar: the card's own fill with a whisper of ink - never the heavy
      // control wash the old full-bleed strip used.
      const bars = viewsWhere(
        renderer,
        (style) =>
          style.paddingHorizontal === CARD_STRIP_PADDING && style.paddingVertical === 4,
      );
      expect(bars).toHaveLength(1);
      const bar = styleOf(bars[0]);
      expect(bar.backgroundColor).toBe(tintAlpha(colors.text, colors.dark ? '06' : '04'));
      expect(bar.backgroundColor).not.toBe(colors.surfaceVariant);
      expect(bar.columnGap).toBe(CARD_TOOLBAR_GAP);
      expect(bar.borderBottomLeftRadius).toBe(metrics.radius - 1);
      expect(bar.borderBottomRightRadius).toBe(metrics.radius - 1);

      // No full-bleed band anymore: nothing cancels the card's padding.
      expect(
        viewsWhere(renderer, (style) => style.marginLeft === -15 || style.marginRight === -13),
      ).toHaveLength(0);

      // The rule comes first, then the toolbar: both BELOW every glyph of the meal.
      const views = renderer.root.findAllByType(View);
      const firstTile = viewsWhere(renderer, (style) => style.width === CARD_TOOL_SIZE)[0];
      expect(views.indexOf(firstTile)).toBeLessThan(views.indexOf(rules[0]));
      expect(views.indexOf(rules[0])).toBeLessThan(views.indexOf(bars[0]));
    }
  });
});
