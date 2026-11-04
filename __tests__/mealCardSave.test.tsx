// Regression test for the "press Save twice" defect on Android.
//
// Reported: after typing a title / description in a meal card, the first tap on
// Save did nothing and a second tap was needed. Two independent causes are
// pinned down here:
//
//  1. the dashboard list scrolls the editor, and a ScrollView with the default
//     `keyboardShouldPersistTaps="never"` swallows the first tap after typing
//     (the tap only dismisses the keyboard) - fixed on the screen itself, and
//     asserted below on the rendered tree,
//  2. even when both taps arrive, ONE save must be written: the card keeps a
//     re-entry guard and disables the button while the write is in flight.

jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file:///mock/documents/',
  getInfoAsync: jest.fn(async () => ({ exists: false, size: 0, uri: '', isDirectory: false })),
  makeDirectoryAsync: jest.fn(async () => undefined),
  readAsStringAsync: jest.fn(async () => ''),
  writeAsStringAsync: jest.fn(async () => undefined),
  deleteAsync: jest.fn(async () => undefined),
  copyAsync: jest.fn(async () => undefined),
  readDirectoryAsync: jest.fn(async () => []),
}));

/**
 * The editor's 40/80 policy is spied on - not replaced - so the tests can prove
 * the SHARED save path really consults it (single Save and "Save all" alike).
 */
jest.mock('../src/ui/components/mealEditorLimits', () => {
  const actual = jest.requireActual('../src/ui/components/mealEditorLimits');
  return { ...actual, isDraftLengthAllowed: jest.fn(actual.isDraftLengthAllowed) };
});

import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { MealCategoryKey, MealStatus, SyncStatus } from '../src/domain/enums';
import { MealCategory, MealEntry } from '../src/domain/models';
import { MealCard } from '../src/ui/components/MealCard';
import {
  EDITOR_DESCRIPTION_LIMIT,
  EDITOR_TITLE_LIMIT,
  isDraftLengthAllowed,
} from '../src/ui/components/mealEditorLimits';
import { t } from '../src/ui/strings';


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

/**
 * The pressable element rendered with a given accessibility label. The lookup
 * walks every node because RN wraps Pressable in memo/forwardRef: the props
 * (and therefore onPress) live on the element that was written in the card.
 */
function button(renderer: TestRenderer.ReactTestRenderer, label: string) {
  const found = renderer.root
    .findAll(
      (node) =>
        node.props?.accessibilityLabel === label && typeof node.props.onPress === 'function',
    )
    .pop();
  if (found === undefined) {
    throw new Error(`no button labelled "${label}"`);
  }
  return found;
}

function renderCard(
  onSave: (draft: MealEntry) => Promise<string | null>,
  options: {
    meal?: MealEntry;
    forceEditing?: boolean;
    saveAllTick?: number;
    onBatchResult?: (mealId: string, saved: boolean) => void;
  } = {},
) {
  return TestRenderer.create(
    <MealCard
      meal={options.meal ?? MEAL}
      category={CATEGORY}
      photos={[]}
      use12HourClock={false}
      now={NOW}
      isDark={false}
      forceEditing={options.forceEditing}
      saveAllTick={options.saveAllTick}
      onBatchResult={options.onBatchResult}
      onSave={onSave}
      onComplete={async () => undefined}
      onMissed={async () => undefined}
      onClear={() => undefined}
      onAddPhoto={() => undefined}
      onRemovePhoto={() => undefined}
      onOpenPhoto={() => undefined}
    />,
  );
}

/** The editor's text input, found by its floating caption / accessible name. */
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

/** Types one change into a field and lets React settle. */
async function type(
  renderer: TestRenderer.ReactTestRenderer,
  label: string,
  value: string,
): Promise<void> {
  await act(async () => {
    field(renderer, label).props.onChangeText(value);
  });
}

describe('editing a meal card saves with ONE press', () => {
  test('two taps while the first save is in flight write the record once', async () => {
    const saved: MealEntry[] = [];
    const onSave = jest.fn(async (draft: MealEntry) => {
      saved.push(draft);
      // A real write takes a moment: the second tap lands while this is running.
      await new Promise((resolve) => setTimeout(resolve, 20));
      return null;
    });

    let renderer: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = renderCard(onSave);
    });
    await act(async () => {
      button(renderer!, t('Common_Edit')).props.onPress();
    });
    // Both taps arrive before the first save resolved (React state has not
    // re-rendered the disabled button yet) - the guard, not the disabled prop,
    // is what has to hold here.
    await act(async () => {
      const save = button(renderer!, t('Common_Save'));
      save.props.onPress();
      save.props.onPress();
      await new Promise((resolve) => setTimeout(resolve, 60));
    });

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(saved).toHaveLength(1);
    expect(saved[0].title).toBe('Ciorbă');
    // The editor closed, so the card is back in read mode after one press.
    expect(button(renderer!, t('Common_Edit'))).toBeDefined();
  });

  test('the dashboard list lets a tap through while the keyboard is open', () => {
    // The meal editor lives inside the dashboard ScrollView: with the default
    // 'never' the first tap after typing would only dismiss the keyboard and
    // the Save button would never receive it.
    const source = readFileSync(
      join(__dirname, '..', 'src', 'ui', 'screens', 'DashboardScreen.tsx'),
      'utf8',
    );
    expect(source).toContain('keyboardShouldPersistTaps="handled"');
  });
});

/**
 * The editor's 40/80 policy lives in the SHARED `runSave`, so a single Save and
 * the dashboard's "Save all" cannot disagree - and a longer value saved by
 * Windows or an older build is never forced to shrink just because a time was
 * corrected.
 */
describe('the editor length policy inside the shared save', () => {
  test('a longer saved value saves UNCHANGED with a corrected time', async () => {
    const legacyTitle = 'T'.repeat(60);
    const legacyDescription = 'd'.repeat(120);
    const onSave = jest.fn<Promise<string | null>, [MealEntry]>(async () => null);
    let renderer: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = renderCard(onSave, {
        forceEditing: true,
        meal: { ...MEAL, title: legacyTitle, ingredients: legacyDescription },
      });
    });

    // Only the time changes: the two long texts are left exactly as they were.
    await type(renderer!, t('Rn_FieldPlannedTime'), '0815');
    await act(async () => {
      button(renderer!, t('Common_Save')).props.onPress();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(onSave).toHaveBeenCalledTimes(1);
    const saved = onSave.mock.calls[0][0] as MealEntry;
    expect(saved.title).toBe(legacyTitle);
    expect(saved.ingredients).toBe(legacyDescription);
    expect(saved.plannedTime).toBe('08:15:00');
    // The guard ran against what the session OPENED with, for both fields.
    expect(isDraftLengthAllowed).toHaveBeenCalledWith(
      legacyTitle,
      legacyTitle,
      EDITOR_TITLE_LIMIT,
    );
    expect(isDraftLengthAllowed).toHaveBeenCalledWith(
      legacyDescription,
      legacyDescription,
      EDITOR_DESCRIPTION_LIMIT,
    );
  });

  test('a refused 41st character never reaches the saved record', async () => {
    const onSave = jest.fn<Promise<string | null>, [MealEntry]>(async () => null);
    let renderer: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = renderCard(onSave, { forceEditing: true, meal: { ...MEAL, title: '' } });
    });

    await type(renderer!, t('Rn_FieldMealName'), 'a'.repeat(40));
    // The change that would need a 41st character is refused whole...
    await type(renderer!, t('Rn_FieldMealName'), 'a'.repeat(41));
    await act(async () => {
      button(renderer!, t('Common_Save')).props.onPress();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    // ...so exactly 40 characters are written - nothing was sliced in.
    const saved = onSave.mock.calls[0][0] as MealEntry;
    expect(saved.title).toBe('a'.repeat(40));
    expect(saved.title).toHaveLength(EDITOR_TITLE_LIMIT);
  });

  test('Cancel writes nothing and keeps the saved meal', async () => {
    const onSave = jest.fn(async () => null);
    let renderer: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = renderCard(onSave, { forceEditing: true });
    });

    await type(renderer!, t('Rn_FieldMealName'), 'Changed');
    await act(async () => {
      button(renderer!, t('Common_Cancel')).props.onPress();
    });

    expect(onSave).not.toHaveBeenCalled();
    // Back in read mode with the stored text untouched.
    const texts = renderer!.root.findAllByType(Text).map((node) => node.props.children);
    expect(texts).toContain('Ciorbă');
    expect(texts).not.toContain('Changed');
  });
});

/**
 * "Save all" walks the SAME `runSave` as the card's own Save button: the same
 * 40/80 guard, the same domain validation, and a truthful per-card result.
 */
describe('"Save all" runs the same save path', () => {
  /** Re-renders the card with a new "Save all" tick. */
  async function saveAll(
    renderer: TestRenderer.ReactTestRenderer,
    meal: MealEntry,
    props: {
      onSave: (draft: MealEntry) => Promise<string | null>;
      onBatchResult: (mealId: string, saved: boolean) => void;
    },
  ): Promise<void> {
    await act(async () => {
      renderer.update(
        <MealCard
          meal={meal}
          category={CATEGORY}
          photos={[]}
          use12HourClock={false}
          now={NOW}
          isDark={false}
          forceEditing
          saveAllTick={1}
          onBatchResult={props.onBatchResult}
          onSave={props.onSave}
          onComplete={async () => undefined}
          onMissed={async () => undefined}
          onClear={() => undefined}
          onAddPhoto={() => undefined}
          onRemovePhoto={() => undefined}
          onOpenPhoto={() => undefined}
        />,
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  test('a valid draft is saved once and reported as saved', async () => {
    const onSave = jest.fn(async () => null);
    const onBatchResult = jest.fn();
    let renderer: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = renderCard(onSave, { forceEditing: true, saveAllTick: 0, onBatchResult });
    });

    await saveAll(renderer!, MEAL, { onSave, onBatchResult });

    // The length policy was consulted for both fields...
    expect(isDraftLengthAllowed).toHaveBeenCalledWith('Ciorbă', 'Ciorbă', EDITOR_TITLE_LIMIT);
    expect(isDraftLengthAllowed).toHaveBeenCalledWith(
      'legume',
      'legume',
      EDITOR_DESCRIPTION_LIMIT,
    );
    // ...and the write happened exactly once, with a truthful batch result.
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onBatchResult).toHaveBeenCalledWith(MEAL.id, true);
  });

  test('a draft that breaks a rule is not written and is reported as failed', async () => {
    const emptyMeal: MealEntry = { ...MEAL, title: '', ingredients: '' };
    const onSave = jest.fn(async () => null);
    const onBatchResult = jest.fn();
    let renderer: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = renderCard(onSave, {
        forceEditing: true,
        saveAllTick: 0,
        onBatchResult,
        meal: emptyMeal,
      });
    });

    // An empty meal is still refused by the DOMAIN validation - the length
    // policy does not replace it - so the editor stays open and the batch learns
    // that this card failed.
    await saveAll(renderer!, emptyMeal, { onSave, onBatchResult });

    expect(onSave).not.toHaveBeenCalled();
    expect(onBatchResult).toHaveBeenCalledWith(MEAL.id, false);
    // The reason is on the card and the Save button is still there to retry.
    const texts = renderer!.root.findAllByType(Text).map((node) => node.props.children);
    expect(texts).toContain(t('Error_meal_title_required'));
    expect(button(renderer!, t('Common_Save'))).toBeDefined();
  });
});

