// The meal card's tool row, drawn the way the reference card draws it:
//
//   meal (category / time / status, title, description, photos)
//   ───────────────────────────────────────────────── line across the card
//   camera        edit        clear        missed        done
//
// The five glyphs are the card's WHOLE affordance, and every one of them can go
// missing silently: a renamed Ionicons glyph renders as nothing, a touch square
// below 44 pt is unusable with a thumb, a line in `hairline` disappears on the
// dark card. These tests pin the glyph names, their order, the geometry of the
// row and the visibility of the line in BOTH themes.

import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { StyleSheet, View } from 'react-native';

import { MealCategoryKey, MealStatus, SyncStatus } from '../src/domain/enums';
import { MealCategory, MealEntry } from '../src/domain/models';
import {
  CARD_TOOL_GAP,
  CARD_TOOL_GLYPH,
  CARD_TOOL_TOUCH,
  MealCard,
} from '../src/ui/components/MealCard';
import { t } from '../src/ui/strings';
import { darkColors, lightColors } from '../src/ui/theme';

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

function render(isDark: boolean): Renderer {
  let renderer: Renderer | undefined;
  act(() => {
    renderer = TestRenderer.create(
      <MealCard
        meal={MEAL}
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
          node.props.accessibilityLabel.startsWith('icon:'),
      )
      .map((node) => node.props.accessibilityLabel as string);
    // Each mocked glyph reports itself twice (the Text and its host view).
    const glyphs = [...new Set(labels)];

    expect(glyphs).toEqual([
      'icon:camera-outline',
      'icon:create-outline',
      'icon:trash-outline',
      'icon:close',
      'icon:checkmark',
    ]);
  });

  test('gives every tool a 48 pt square, whatever the glyph size', () => {
    const renderer = render(false);
    for (const label of [
      t('Photo_Add'),
      t('Common_Edit'),
      t('Meal_Clear'),
      t('Meal_MarkMissed'),
      t('Meal_MarkDone'),
    ]) {
      const style = styleOf(tool(renderer, label));
      expect(style.width).toBe(CARD_TOOL_TOUCH);
      expect(style.height).toBe(CARD_TOOL_TOUCH);
    }
    // The reference draws the glyphs at 20 pt - bigger than the old 18, still
    // inside the same square, so nothing gets a smaller target.
    expect(CARD_TOOL_GLYPH).toBe(20);
    expect(CARD_TOOL_GLYPH).toBeLessThan(CARD_TOOL_TOUCH);
  });

  test('keeps the five squares apart on one right-aligned row', () => {
    const renderer = render(false);
    const rows = viewsWhere(
      renderer,
      (style) => style.columnGap === CARD_TOOL_GAP && style.flexDirection === 'row',
    );
    expect(rows).toHaveLength(1);
    expect(styleOf(rows[0]).justifyContent).toBe('flex-end');

    // Five squares and four gaps still fit the narrowest phone card: 360 dp
    // screen, 2 x 16 page padding, 15 + 13 card content padding.
    expect(CARD_TOOL_TOUCH * 5 + CARD_TOOL_GAP * 4).toBeLessThan(360 - 32 - 15 - 13);
  });

  test('separates the meal from its tools with one visible line', () => {
    for (const colors of [lightColors, darkColors]) {
      const renderer = render(colors.dark);
      const lines = viewsWhere(renderer, (style) => style.height === StyleSheet.hairlineWidth);
      expect(lines).toHaveLength(1);
      const style = styleOf(lines[0]);
      // A deliberate step above the card border - `hairline` and even `border`
      // were too faint to read on the dark card.
      expect(style.backgroundColor).toBe(colors.cardDivider);
      expect(colors.cardDivider).not.toBe(colors.border);
      expect(colors.cardDivider).not.toBe(colors.hairline);
      expect(style.marginTop).toBe(13);

      // It sits ABOVE the row of tools.
      const row = viewsWhere(
        renderer,
        (candidate) => candidate.columnGap === CARD_TOOL_GAP && candidate.flexDirection === 'row',
      )[0];
      const viewsInOrder = renderer.root.findAllByType(View);
      expect(viewsInOrder.indexOf(lines[0])).toBeLessThan(viewsInOrder.indexOf(row));

      // Equal air above and below the icons: the line-to-row gap equals the
      // card's bottom padding under the row.
      const content = viewsWhere(
        renderer,
        (candidate) => candidate.paddingLeft === 15 && candidate.paddingRight === 13,
      )[0];
      const bottomRow = viewsWhere(
        renderer,
        (candidate) => candidate.marginTop === 'auto' && typeof candidate.rowGap === 'number',
      )[0];
      expect(styleOf(bottomRow).rowGap).toBe(styleOf(content).paddingBottom);
    }
  });
});
