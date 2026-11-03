// The meal cards' header icons: the mockup's five line drawings, one per meal,
// instead of the category emoji.
//
// `MealCategory.Icon` is still DATA (stored in SQLite, synced to the cloud, shown
// by the Windows app), but an emoji is not design: it renders differently on every
// Android skin, ignores the theme ink and cannot be aligned with a number. The
// five categories are FIXED, so their glyphs are fixed with them - which is why
// this mapping lives in code and not in the row.
//
// Pinned here: the five exact shapes, that no two meals share one, that every
// glyph NAME really exists in the bundled font (a typo renders as an invisible
// icon and nothing else complains), and that a card draws the glyph instead of the
// emoji it still carries in its data.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';

import { MealCategoryKey, MealStatus, SyncStatus } from '../src/domain/enums';
import { MealCategory, MealEntry } from '../src/domain/models';
import { MealCard } from '../src/ui/components/MealCard';
import { MEAL_GLYPH_SIZE, mealCategoryGlyph } from '../src/ui/mealGlyphs';

/** The bundled font's own glyph table: every name and its code point. */
const GLYPHMAP: Record<string, number> = JSON.parse(
  readFileSync(
    join(
      __dirname,
      '..',
      'node_modules',
      '@expo',
      'vector-icons',
      'build',
      'vendor',
      'react-native-vector-icons',
      'glyphmaps',
      'MaterialCommunityIcons.json',
    ),
    'utf8',
  ),
);

/** The mockup's drawing for each meal, in the order the cards appear. */
const EXPECTED: Array<[MealCategoryKey, string]> = [
  [MealCategoryKey.Breakfast, 'bowl-mix-outline'],
  [MealCategoryKey.MorningSnack, 'food-apple-outline'],
  [MealCategoryKey.Lunch, 'silverware-fork-knife'],
  [MealCategoryKey.AfternoonSnack, 'cookie-outline'],
  [MealCategoryKey.Dinner, 'room-service-outline'],
];

const NOW = new Date('2026-11-03T12:00:00.000Z');

function categoryOf(key: MealCategoryKey): MealCategory {
  return {
    id: `cat-${key}`,
    fixedCategoryKey: key,
    name: `Meal ${key}`,
    color: '#FF0F6CBD',
    // The row still carries an emoji: the card must not draw it any more.
    icon: '🍲',
    defaultTime: '12:00:00',
    displayOrder: key,
  };
}

function mealOf(category: MealCategory): MealEntry {
  return {
    id: `meal-${category.fixedCategoryKey}`,
    localProfileId: 'profile',
    date: '2026-11-03',
    mealCategoryId: category.id,
    mealCategoryKey: category.fixedCategoryKey,
    title: 'Soup',
    ingredients: '',
    plannedTime: '12:00:00',
    status: MealStatus.Pending,
    completedAt: null,
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    revision: 1,
    syncStatus: SyncStatus.PendingUpload,
    cloudRevision: null,
    contentHash: null,
  };
}

describe('the meal category glyphs', () => {
  test('each meal wears the mockup\'s drawing', () => {
    for (const [key, glyph] of EXPECTED) {
      expect(mealCategoryGlyph(key)).toBe(glyph);
    }
  });

  test('every glyph exists in the bundled font', () => {
    // A renamed or mistyped glyph renders as NOTHING at 22 pt and no other test
    // would notice, so the font's own table is the judge.
    for (const [, glyph] of EXPECTED) {
      expect(typeof GLYPHMAP[glyph]).toBe('number');
    }
  });

  test('five meals, five different marks', () => {
    const glyphs = EXPECTED.map(([, glyph]) => glyph);
    expect(new Set(glyphs).size).toBe(EXPECTED.length);
  });

  test('an unknown category key still gets a mark, not a hole', () => {
    expect(mealCategoryGlyph(99 as MealCategoryKey)).toBe('silverware-fork-knife');
  });

  test('the card draws the glyph, and never the emoji in its data', () => {
    for (const [key, glyph] of EXPECTED) {
      const category = categoryOf(key);
      let renderer: TestRenderer.ReactTestRenderer | undefined;
      act(() => {
        renderer = TestRenderer.create(
          <MealCard
            meal={mealOf(category)}
            category={category}
            photos={[]}
            use12HourClock={false}
            now={NOW}
            isDark={false}
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
        throw new Error('the card did not render');
      }
      const marks = renderer.root.findAll(
        (node) => node.props?.accessibilityLabel === `material:${glyph}`,
      );
      expect(marks.length).toBeGreaterThan(0);
      // The emoji the row carries is data for Windows - it is not drawn here.
      const emoji = renderer.root
        .findAllByType(Text)
        .filter((node) => node.props.children === category.icon);
      expect(emoji).toHaveLength(0);
    }
  });

  test('the glyph is drawn at the size the tile holds', () => {
    expect(MEAL_GLYPH_SIZE).toBe(22);
  });
});

