// The meal card's ACTION STRIP, drawn the way the reference card draws it:
//
//   meal (category / time / status, title, description, photos)
//   ────────────────────────────────────────────────────────────────
//   ░ [camera] [edit] [clear]              │        [✕ missed] [✓ done] ░
//   ░                    tinted strip                             ░
//
// The five tools are the card's WHOLE affordance, and every one of them can go
// missing silently: a renamed glyph renders as nothing, a tile below 44 pt of
// touch is unusable with a thumb, a line in `hairline` disappears on the dark
// card. These tests pin the glyph names (header, pencil, bin), their ink, the two
// groups and their divider, the tile/target geometry, the strip's tint and line in
// BOTH themes, and that the meal's CURRENT state stays visible on its mark.

import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { StyleSheet, View } from 'react-native';

import { MealCategoryKey, MealStatus, SyncStatus } from '../src/domain/enums';
import { MealCategory, MealEntry } from '../src/domain/models';
import {
  CARD_TOOL_GAP,
  CARD_TOOL_GLYPH,
  CARD_TOOL_SIZE,
  CARD_TOOL_TOUCH,
  MealCard,
} from '../src/ui/components/MealCard';
import { t } from '../src/ui/strings';
import { darkColors, lightColors, metrics } from '../src/ui/theme';

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

/** Pending, so the status pill draws a dot and the only glyphs are the tools. */
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

  test('gives every tool a compact tile with a 44 pt touch target', () => {
    const renderer = render(false);
    for (const label of [
      t('Photo_Add'),
      t('Common_Edit'),
      t('Meal_Clear'),
      t('Meal_MarkMissed'),
      t('Meal_MarkDone'),
    ]) {
      const style = styleOf(tool(renderer, label));
      expect(style.width).toBe(CARD_TOOL_SIZE);
      expect(style.height).toBe(CARD_TOOL_SIZE);
      // The visible tile is compact; the hit slop is what makes the TARGET big.
      const slop = tool(renderer, label).props.hitSlop as number;
      expect(CARD_TOOL_SIZE + slop * 2).toBeGreaterThanOrEqual(CARD_TOOL_TOUCH);
      expect(CARD_TOOL_TOUCH).toBeGreaterThanOrEqual(44);
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

    // ONE divider between the two groups - not a line per boundary.
    const dividers = viewsWhere(
      renderer,
      (style) => style.width === 1 && style.alignSelf === 'stretch',
    );
    expect(dividers).toHaveLength(1);
    expect(CARD_TOOL_SIZE * 5 + CARD_TOOL_GAP * 4 + 24).toBeLessThan(360 - 32 - 15 - 13);
  });

  test('marks the meal CURRENT state on the strip', () => {
    // A DONE meal: the check tile keeps a ring in the done colour, the X does not.
    const done = render(false, { ...MEAL, status: MealStatus.Done });
    const doneTile = styleOf(tool(done, t('Meal_MarkDone')));
    expect(doneTile.borderColor).toBe(lightColors.done);
    // Disabled (pressing it again changes nothing) but NOT faded: it is the answer.
    expect(doneTile.opacity).toBe(1);
    expect(styleOf(tool(done, t('Meal_MarkMissed'))).borderColor).toBe('transparent');

    // A missed meal mirrors it.
    const missed = render(false, { ...MEAL, status: MealStatus.Missed });
    expect(styleOf(tool(missed, t('Meal_MarkMissed'))).borderColor).toBe(lightColors.missed);
    expect(styleOf(tool(missed, t('Meal_MarkDone'))).borderColor).toBe('transparent');
  });

  test('the strip is a tinted footer closed by one clear line', () => {
    for (const colors of [lightColors, darkColors]) {
      const renderer = render(colors.dark);
      const strips = viewsWhere(
        renderer,
        (style) => style.borderTopWidth === 1 && style.backgroundColor === colors.surfaceVariant,
      );
      expect(strips).toHaveLength(1);
      const strip = styleOf(strips[0]);
      // A deliberate step above the card border - `hairline` and even `border` were
      // too faint to read on the dark card.
      expect(strip.borderTopColor).toBe(colors.cardDivider);
      expect(colors.cardDivider).not.toBe(colors.border);
      expect(colors.cardDivider).not.toBe(colors.hairline);
      // It follows the card's corners and bleeds to the card's edges.
      expect(strip.borderBottomLeftRadius).toBe(metrics.radius - 1);
      expect(strip.marginLeft).toBe(-15);
      expect(strip.marginRight).toBe(-13);

      // It is the LAST block of the card: below every glyph of the meal.
      const viewsInOrder = renderer.root.findAllByType(View);
      const firstTile = viewsWhere(renderer, (style) => style.width === CARD_TOOL_SIZE)[0];
      expect(viewsInOrder.indexOf(strips[0])).toBeLessThan(viewsInOrder.indexOf(firstTile));

      // One 12 pt value above the line, held by the strip's host - no chain of
      // paddings to keep in sync.
      const hosts = viewsWhere(
        renderer,
        (style) => style.paddingTop === 12 && style.marginTop === 'auto',
      );
      expect(hosts).toHaveLength(1);
    }
  });
});
