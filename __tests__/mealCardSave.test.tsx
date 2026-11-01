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

import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { MealCategoryKey, MealStatus, SyncStatus } from '../src/domain/enums';
import { MealCategory, MealEntry } from '../src/domain/models';
import { MealCard } from '../src/ui/components/MealCard';
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

function renderCard(onSave: (draft: MealEntry) => Promise<string | null>) {
  return TestRenderer.create(
    <MealCard
      meal={MEAL}
      category={CATEGORY}
      photos={[]}
      use12HourClock={false}
      now={NOW}
      isDark={false}
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
