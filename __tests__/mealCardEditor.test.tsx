// The meal card's editor is compact and bounded on purpose:
//
//  * the title stops at the domain's own 120 characters and stays single-line,
//  * the notes box starts at ONE row and opens up to two only when the text needs
//    it (the same two-row limit as before - a third line is refused),
//  * the planned time accepts a time and nothing else, five characters long and
//    only as wide as "HH:MM",
//  * every field is the 44 pt chip of the reference, which is also the minimum
//    touch target, and the planned time shares one footer with Cancel / Save.
//
// Covered here: the pure mask, the props/styles the three inputs render with, and
// the notes box's shallow-then-grown height.

import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { StyleSheet, Text } from 'react-native';

import { MealCategoryKey, MealStatus, SyncStatus } from '../src/domain/enums';
import { MealCategory, MealEntry } from '../src/domain/models';
import {
  FIELD_HEIGHT,
  MealCard,
  NOTES_HEIGHT,
  timeDraft,
} from '../src/ui/components/MealCard';
import { t } from '../src/ui/strings';
import { lightColors, tintAlpha } from '../src/ui/theme';

const NOW = new Date('2026-11-01T12:00:00.000Z');

const CATEGORY: MealCategory = {
  id: 'cat-lunch',
  fixedCategoryKey: MealCategoryKey.Lunch,
  name: 'Lunch',
  color: '#FFFF9500',
  icon: '🍲',
  defaultTime: '12:30:00',
  displayOrder: 3,
};

const MEAL: MealEntry = {
  id: 'meal-lunch',
  localProfileId: 'profile',
  date: '2026-11-01',
  mealCategoryId: CATEGORY.id,
  mealCategoryKey: MealCategoryKey.Lunch,
  title: 'Ciorbă',
  ingredients: 'legume',
  plannedTime: null,
  status: MealStatus.Pending,
  completedAt: null,
  createdAt: NOW.toISOString(),
  updatedAt: NOW.toISOString(),
  revision: 1,
  syncStatus: SyncStatus.PendingUpload,
  cloudRevision: null,
  contentHash: null,
};

/** The input rendered for one of the editor's persistent captions. */
function field(renderer: TestRenderer.ReactTestRenderer, label: string) {
  const found = renderer.root
    .findAll(
      (node) =>
        node.props?.accessibilityLabel === label &&
        typeof node.props.onChangeText === 'function' &&
        typeof node.type !== 'string',
    )
    .pop();
  if (found === undefined) {
    throw new Error(`no field labelled "${label}"`);
  }
  return found;
}

function styleOf(node: TestRenderer.ReactTestInstance): Record<string, unknown> {
  return (StyleSheet.flatten(node.props.style) ?? {}) as Record<string, unknown>;
}

/**
 * The `MeasuredInput` wrapper of a field: it owns both the input and the invisible
 * ruler beside it, so layout/text-layout events are found through it.
 */
function measured(
  renderer: TestRenderer.ReactTestRenderer,
  label: string,
): TestRenderer.ReactTestInstance {
  const found = renderer.root
    .findAll(
      (node) =>
        node.props?.accessibilityLabel === label && typeof node.props?.rows === 'number',
    )
    .pop();
  if (found === undefined) {
    throw new Error(`no measured field labelled "${label}"`);
  }
  return found;
}

/** The invisible ruler that reports how many lines the current text needs. */
function ruler(
  renderer: TestRenderer.ReactTestRenderer,
  label: string,
): TestRenderer.ReactTestInstance {
  const found = measured(renderer, label)
    .findAll((node) => typeof node.props?.onTextLayout === 'function')
    .pop();
  if (found === undefined) {
    throw new Error(`no ruler for "${label}"`);
  }
  return found;
}

/**
 * Drives the field's own layout. The ruler only exists once the field knows its
 * width, exactly as on a device.
 */
function layout(renderer: TestRenderer.ReactTestRenderer, label: string): void {
  const input = measured(renderer, label)
    .findAll((node) => typeof node.props?.onLayout === 'function')
    .pop();
  if (input === undefined) {
    throw new Error(`no input to lay out for "${label}"`);
  }
  act(() => {
    input.props.onLayout({ nativeEvent: { layout: { width: 240, height: FIELD_HEIGHT } } });
  });
}

async function renderEditor(meal: MealEntry = MEAL): Promise<TestRenderer.ReactTestRenderer> {
  let renderer: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(
      <MealCard
        meal={meal}
        category={CATEGORY}
        photos={[]}
        use12HourClock={false}
        now={NOW}
        isDark={false}
        forceEditing
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
  return renderer!;
}

describe('the planned-time field', () => {
  test('keeps a time and drops everything else', () => {
    expect(timeDraft('12:30')).toBe('12:30');
    expect(timeDraft('9:30')).toBe('9:30');
    // A number pad without a colon: the mask inserts the separator.
    expect(timeDraft('1230')).toBe('12:30');
    expect(timeDraft('123')).toBe('12:3');
    // Three digits that cannot start with a two-digit hour are a one-digit hour.
    expect(timeDraft('930')).toBe('9:30');
    expect(timeDraft('253')).toBe('2:53');
    // Letters, spaces and symbols never reach the save validation.
    expect(timeDraft('ab12h30!')).toBe('12:30');
    expect(timeDraft('')).toBe('');
    // Five characters at most: the third digit block is dropped.
    expect(timeDraft('12345')).toBe('12:34');
  });

  test('is narrow, five characters long and time-only on the keyboard', async () => {
    const renderer = await renderEditor();
    const time = field(renderer, t('Rn_FieldPlannedTime'));
    expect(time.props.maxLength).toBe(5);
    expect(time.props.keyboardType).toBeDefined();
    expect(time.props.keyboardType).not.toBe('default');
    // Only as wide as "HH:MM" needs, left in the row but CENTERED inside, so the
    // chip is symmetrical around the time.
    expect(styleOf(time).width).toBe(56);
    expect(styleOf(time).alignSelf).toBe('flex-start');
    expect(styleOf(time).textAlign).toBe('center');

    // Typing digits produces the masked value.
    await act(async () => {
      field(renderer, t('Rn_FieldPlannedTime')).props.onChangeText('1230');
    });
    expect(field(renderer, t('Rn_FieldPlannedTime')).props.value).toBe('12:30');
  });
});

describe('the title and description fields', () => {
  test('the title is a single line with no character cap', async () => {
    const renderer = await renderEditor();
    const title = field(renderer, t('Rn_FieldMealName'));
    // No `multiline`: a long title never adds a row.
    expect(title.props.multiline).toBeUndefined();
    // No `maxLength` either: the fit is decided by the measured layout, not by a
    // character count (see `MeasuredInput`).
    expect(title.props.maxLength).toBeUndefined();
  });

  test('the description box starts shallow and grows to two rows when needed', async () => {
    const renderer = await renderEditor({ ...MEAL, ingredients: '' });
    const description = field(renderer, t('Rn_FieldDescription'));
    expect(description.props.multiline).toBe(true);
    // Shallow: ONE row on an empty draft - the compact field of the reference.
    expect(description.props.numberOfLines).toBe(1);
    expect(styleOf(description).height).toBe(FIELD_HEIGHT);
    expect(FIELD_HEIGHT).toBe(44);
    expect(styleOf(description).lineHeight).toBe(18);
    expect(description.props.maxLength).toBeUndefined();

    // The ruler reports two lines: the box opens up to the two-row height...
    layout(renderer, t('Rn_FieldDescription'));
    act(() => {
      ruler(renderer, t('Rn_FieldDescription')).props.onTextLayout({
        nativeEvent: { lines: [{}, {}] },
      });
    });
    expect(styleOf(field(renderer, t('Rn_FieldDescription'))).height).toBe(NOTES_HEIGHT);
    expect(NOTES_HEIGHT).toBe(52);

    // ...and a third line never grows it: the LIMIT is the same two rows, and the
    // fit guard is what refuses the text that would need them.
    act(() => {
      ruler(renderer, t('Rn_FieldDescription')).props.onTextLayout({
        nativeEvent: { lines: [{}, {}, {}] },
      });
    });
    expect(styleOf(field(renderer, t('Rn_FieldDescription'))).height).toBe(NOTES_HEIGHT);
  });

  test('every single-line field is the 44 pt chip', async () => {
    const renderer = await renderEditor();
    for (const label of [t('Rn_FieldMealName'), t('Rn_FieldPlannedTime')]) {
      expect(styleOf(field(renderer, label)).height).toBe(FIELD_HEIGHT);
    }
    // The chip IS the app's minimum touch target.
    expect(FIELD_HEIGHT).toBeGreaterThanOrEqual(44);
  });

  test('the fields wear a soft fill and a subtle border', async () => {
    const renderer = await renderEditor();
    for (const label of [
      t('Rn_FieldMealName'),
      t('Rn_FieldDescription'),
      t('Rn_FieldPlannedTime'),
    ]) {
      const style = styleOf(field(renderer, label));
      expect(style.borderWidth).toBe(1);
      expect(style.borderColor).toBe(lightColors.border);
      expect(style.backgroundColor).toBe(lightColors.surfaceVariant);
      expect(style.borderRadius).toBe(10);
    }
  });

  test('the answers share the planned-time row, in a tinted footer', async () => {
    const renderer = await renderEditor();
    const withStyle = (match: (style: Record<string, unknown>) => boolean) =>
      renderer.root
        .findAll((node) => {
          const style = StyleSheet.flatten(node.props?.style) as Record<string, unknown> | undefined;
          return style !== undefined && match(style);
        })
        .pop();

    // The time field and the two answers share one row, bottoms aligned.
    const foot = withStyle(
      (style) =>
        style.flexDirection === 'row' &&
        style.alignItems === 'flex-end' &&
        style.justifyContent === 'space-between',
    );
    expect(foot).toBeDefined();
    // ...on a light band: 8 pt of padding, rounded, and a barely-there accent tint.
    const footStyle = styleOf(foot!);
    expect(footStyle.padding).toBe(8);
    expect(footStyle.borderRadius).toBe(12);
    expect(footStyle.backgroundColor).toBe(tintAlpha(lightColors.accent, '0D'));

    // The editor is compact (8 pt between its field groups) and still tops the
    // card's 6 pt bottom padding up to its 13 pt right padding.
    const editor = withStyle((style) => style.paddingBottom === 7 && style.rowGap === 8);
    expect(editor).toBeDefined();
  });

  test('the editor carries no heading of its own', async () => {
    const renderer = await renderEditor();
    const editor = renderer.root
      .findAll((node) => {
        const style = StyleSheet.flatten(node.props?.style) as Record<string, unknown> | undefined;
        return style?.rowGap === 8 && style?.paddingBottom === 7;
      })
      .pop();
    expect(editor).toBeDefined();
    // Only the three persistent labels and the two answers: no "Edit meal" title,
    // nothing to read twice (the card's own header already names the meal).
    const texts = (editor as TestRenderer.ReactTestInstance)
      .findAllByType(Text)
      .map((node) => node.props.children)
      .filter((value): value is string => typeof value === 'string');
    expect(texts).toEqual([
      t('Rn_FieldMealName'),
      t('Rn_FieldDescription'),
      t('Rn_FieldPlannedTime'),
      t('Common_Cancel'),
      t('Common_Save'),
    ]);
  });

  test('the card keeps its icon, name and status pill while editing', async () => {
    const renderer = await renderEditor();
    // The category's line icon (Lunch: fork and knife) is still in the header...
    const glyphs = renderer.root
      .findAll((node) => typeof node.props?.accessibilityLabel === 'string')
      .map((node) => node.props.accessibilityLabel as string);
    expect(glyphs).toContain('material:silverware-fork-knife');
    // ...the status pill still says Pending, and the meal's name is still there.
    const texts = renderer.root.findAllByType(Text).map((node) => node.props.children);
    expect(texts).toContain(t('Status_Pending'));
    expect(texts).toContain('Lunch');
  });

  test('the action strip is hidden while the editor is open', async () => {
    const renderer = await renderEditor();
    const labels = renderer.root
      .findAll(
        (node) =>
          typeof node.props?.accessibilityLabel === 'string' &&
          typeof node.props.onPress === 'function',
      )
      .map((node) => node.props.accessibilityLabel as string);
    // None of the five tools exists: the editor replaces the strip, it does not
    // stack above it.
    for (const label of [
      t('Photo_Add'),
      t('Common_Edit'),
      t('Meal_Clear'),
      t('Meal_MarkMissed'),
      t('Meal_MarkDone'),
    ]) {
      expect(labels).not.toContain(label);
    }
    const glyphs = renderer.root
      .findAll((node) => typeof node.props?.accessibilityLabel === 'string')
      .map((node) => node.props.accessibilityLabel as string);
    expect(glyphs).not.toContain('feather:trash-2');
    expect(glyphs).not.toContain('feather:edit');
  });

  test('an existing long value is not truncated when the editor opens', async () => {
    // A value saved by an older, wider editor opens exactly as it is: the fit
    // guard only ever refuses GROWTH, so nothing stored can be cut.
    const long = 'x'.repeat(500);
    const renderer = await renderEditor({ ...MEAL, title: 'T'.repeat(80), ingredients: long });
    expect(field(renderer, t('Rn_FieldDescription')).props.value).toBe(long);
    expect(field(renderer, t('Rn_FieldMealName')).props.value).toBe('T'.repeat(80));
  });
});
