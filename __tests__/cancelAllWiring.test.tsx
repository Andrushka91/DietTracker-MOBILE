// CANCEL ALL wiring, driven through the REAL Dashboard and the REAL MealCard with
// the data layer mocked.
//
// Pinned here (the guard rails the reference helper tests cannot prove):
//   * every open draft is discarded, the persisted values come back, and NOTHING
//     is written - no save, no clear, no status change;
//   * a card that is NOT editing is untouched, and closing the last editor hides
//     the whole row;
//   * a card's OWN save in flight blocks Cancel all completely, even when the
//     handler is invoked directly in the same frame (before React's disabled state
//     has landed);
//   * a repeated tap is harmless;
//   * after a partial batch only the editors that are STILL open are discarded and
//     the stale "n of m saved" sentence disappears with them;
//   * changing the day drops the registry, so another day's cards are never
//     addressed.

import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { Text, TextInput } from 'react-native';

import { MealStatus, SyncStatus } from '../src/domain/enums';
import { MealEntry } from '../src/domain/models';
import { DashboardScreen } from '../src/ui/screens/DashboardScreen';
import { t, tFmt } from '../src/ui/strings';

type Renderer = TestRenderer.ReactTestRenderer;

const mockSaveMeal = jest.fn();
const mockLoadDay = jest.fn();
const mockNotifyChanged = jest.fn();

const mockApp = {
  profile: { id: 'profile-1' },
  accountId: null as string | null,
  isDark: false,
  use12HourClock: false,
  notifyChanged: mockNotifyChanged,
  setBusy: jest.fn(),
};

jest.mock('../src/ui/appContext', () => ({ useApp: () => mockApp }));

// `useFocusEffect` runs its callback on focus; in a test that is simply "run it".
jest.mock('@react-navigation/native', () => {
  const ReactModule = require('react');
  return {
    useFocusEffect: (callback: () => void) => {
      ReactModule.useEffect(callback, [callback]);
    },
  };
});

jest.mock('../src/services/mealTracking', () => {
  const categories = [
    { id: 'c1', fixedCategoryKey: 1, name: 'Breakfast', color: '#FF0F6CBD', icon: 'x', defaultTime: '07:30:00', displayOrder: 0 },
    { id: 'c2', fixedCategoryKey: 2, name: 'Morning snack', color: '#FF0F6CBD', icon: 'x', defaultTime: '10:30:00', displayOrder: 1 },
    { id: 'c3', fixedCategoryKey: 3, name: 'Lunch', color: '#FF0F6CBD', icon: 'x', defaultTime: '13:30:00', displayOrder: 2 },
    { id: 'c4', fixedCategoryKey: 4, name: 'Afternoon snack', color: '#FF0F6CBD', icon: 'x', defaultTime: '16:30:00', displayOrder: 3 },
    { id: 'c5', fixedCategoryKey: 5, name: 'Dinner', color: '#FF0F6CBD', icon: 'x', defaultTime: '19:30:00', displayOrder: 4 },
  ];
  return {
    ensureCategories: async () => categories,
    loadDay: (...args: unknown[]) => mockLoadDay(...args),
    saveMeal: (...args: unknown[]) => mockSaveMeal(...args),
    completeMeal: jest.fn(async () => ({ changed: false })),
    missMeal: jest.fn(async () => ({ changed: false })),
    clearMeal: jest.fn(async () => ({ changed: false })),
    markAllDone: jest.fn(async () => ({ changed: 0 })),
    markAllMissed: jest.fn(async () => ({ changed: 0 })),
    ensureMealStored: jest.fn(async (entry: MealEntry) => entry),
    saveDayAsTemplate: jest.fn(async () => ({ ok: true })),
  };
});

jest.mock('../src/data/repositories', () => ({
  getPhotoCounts: jest.fn(async () => new Map()),
  getPhotosForMeal: jest.fn(async () => []),
}));

jest.mock('../src/data/photoStore', () => ({
  addPhotoToMeal: jest.fn(async () => ({ ok: true })),
  removePhoto: jest.fn(async () => ({ ok: true })),
}));

jest.mock('../src/cloud/syncEngine', () => ({
  subscribeDataChange: () => () => undefined,
}));

jest.mock('../src/cloud/journal', () => ({ journalDelete: jest.fn() }));

jest.mock('../src/ui/dates', () => ({ readDateHandoff: () => null }));

jest.mock('../src/ui/clearMealPrompt', () => ({ clearMealRequest: jest.fn() }));

const NOW = new Date('2026-11-05T12:00:00.000Z');
const DAY = '2026-11-05';
const OTHER_DAY = '2026-11-06';

function meal(key: 1 | 2 | 3 | 4 | 5, date: string, title: string): MealEntry {
  return {
    id: `meal-${date}-${key}`,
    localProfileId: 'profile-1',
    date,
    mealCategoryId: `c${key}`,
    mealCategoryKey: key,
    title,
    ingredients: 'notes',
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
}

function dayMeals(date: string): MealEntry[] {
  return [
    meal(1, date, 'Oatmeal'),
    meal(2, date, 'Apple'),
    meal(3, date, 'Soup'),
    meal(4, date, 'Nuts'),
    meal(5, date, 'Stew'),
  ];
}

/** Every pressable carrying an accessibility label, in tree order. */
function pressables(renderer: Renderer, label: string): TestRenderer.ReactTestInstance[] {
  return renderer.root.findAll(
    (node) =>
      node.props?.accessibilityLabel === label && typeof node.props.onPress === 'function',
  );
}

/** The text a user can actually read (the hidden time-measuring copy excluded). */
function visibleTexts(renderer: Renderer): string[] {
  return renderer.root
    .findAllByType(Text)
    .filter((node) => node.props.accessible !== false)
    .map((node) => node.props.children)
    .filter((value): value is string => typeof value === 'string');
}

/** The open editors' Meal name fields, in card order. */
function titleFields(renderer: Renderer): TestRenderer.ReactTestInstance[] {
  return renderer.root
    .findAllByType(TextInput)
    .filter((node) => node.props.accessibilityLabel === t('Rn_FieldMealName'));
}

const mounted: Renderer[] = [];

async function renderDashboard(date: string = DAY): Promise<Renderer> {
  let renderer: Renderer | undefined;
  await act(async () => {
    renderer = TestRenderer.create(<DashboardScreen route={{ params: { date } }} />);
  });
  mounted.push(renderer!);
  return renderer!;
}

// Unmount between tests: the screen arms a midnight timer and a resume listener,
// and neither should outlive its test.
afterEach(async () => {
  for (const renderer of mounted.splice(0)) {
    await act(async () => {
      renderer.unmount();
    });
  }
});

/** Opens the card at `index` of the remaining Edit tools. */
async function openEditor(renderer: Renderer, index: number): Promise<void> {
  const edit = pressables(renderer, t('Common_Edit'));
  await act(async () => {
    edit[index].props.onPress();
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockLoadDay.mockImplementation(async (_profileId: string, date: string) => ({
    meals: dayMeals(date),
  }));
  mockSaveMeal.mockResolvedValue({ ok: true });
});


describe('Cancel all', () => {
  test('discards every open draft and writes nothing', async () => {
    const renderer = await renderDashboard();
    await openEditor(renderer, 0);
    await openEditor(renderer, 0);
    expect(pressables(renderer, t('Common_Cancel'))).toHaveLength(2);

    // Two changed drafts.
    await act(async () => {
      titleFields(renderer)[0].props.onChangeText('Changed one');
      titleFields(renderer)[1].props.onChangeText('Changed two');
    });

    const cancelAll = pressables(renderer, t('Rn_CancelAll'));
    expect(cancelAll).toHaveLength(1);
    await act(async () => {
      cancelAll[0].props.onPress();
    });

    // Both editors closed, the row went with them, nothing was written.
    expect(pressables(renderer, t('Common_Cancel'))).toHaveLength(0);
    expect(pressables(renderer, t('Rn_CancelAll'))).toHaveLength(0);
    expect(mockSaveMeal).not.toHaveBeenCalled();
    // No write reached the data layer, so nothing announced a change.
    expect(mockNotifyChanged).not.toHaveBeenCalled();
    // The persisted values are back on the cards.
    expect(visibleTexts(renderer)).toContain('Oatmeal');
    expect(visibleTexts(renderer)).toContain('Apple');
    expect(visibleTexts(renderer)).not.toContain('Changed one');
  });

  test('leaves a closed card alone and hides the row when the last editor closes', async () => {
    const renderer = await renderDashboard();
    await openEditor(renderer, 0);
    // The untouched cards still offer Edit.
    expect(pressables(renderer, t('Common_Edit'))).toHaveLength(4);

    await act(async () => {
      pressables(renderer, t('Rn_CancelAll'))[0].props.onPress();
    });
    // Only the one editor closed; the four untouched cards never opened.
    expect(pressables(renderer, t('Common_Edit'))).toHaveLength(5);
    expect(pressables(renderer, t('Rn_CancelAll'))).toHaveLength(0);
    expect(mockSaveMeal).not.toHaveBeenCalled();
  });

  test('is blocked while a card is saving, even invoked directly in the same frame', async () => {
    let finish: ((value: { ok: boolean }) => void) | undefined;
    mockSaveMeal.mockImplementation(
      () => new Promise<{ ok: boolean }>((resolve) => {
        finish = resolve;
      }),
    );
    const renderer = await renderDashboard();
    await openEditor(renderer, 0);

    // Save starts (and hangs): the card owns the write.
    await act(async () => {
      pressables(renderer, t('Common_Save'))[0].props.onPress();
    });
    expect(mockSaveMeal).toHaveBeenCalledTimes(1);

    // The row is drawn disabled, but the handler is invoked anyway - the ref guard
    // must refuse, not the visuals.
    await act(async () => {
      pressables(renderer, t('Rn_CancelAll'))[0].props.onPress();
    });
    expect(pressables(renderer, t('Common_Save'))).toHaveLength(1);

    await act(async () => {
      finish?.({ ok: true });
    });
    // The save completed and closed the editor by itself; Cancel all never ran.
    expect(mockSaveMeal).toHaveBeenCalledTimes(1);
    expect(pressables(renderer, t('Common_Edit'))).toHaveLength(5);
  });

  test('a repeated tap after a cancellation is harmless', async () => {
    const renderer = await renderDashboard();
    await openEditor(renderer, 0);
    const cancelAll = pressables(renderer, t('Rn_CancelAll'))[0];

    await act(async () => {
      cancelAll.props.onPress();
      // Same node, same frame: the registry is already empty.
      cancelAll.props.onPress();
    });

    expect(pressables(renderer, t('Common_Edit'))).toHaveLength(5);
    expect(mockSaveMeal).not.toHaveBeenCalled();
  });

  test('after a partial batch only the still-open editor is discarded', async () => {
    mockSaveMeal
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: false });
    const renderer = await renderDashboard();
    await openEditor(renderer, 0);
    await openEditor(renderer, 0);
    expect(pressables(renderer, t('Common_Cancel'))).toHaveLength(2);

    await act(async () => {
      pressables(renderer, t('Dashboard_SaveAll'))[0].props.onPress();
    });
    // One card saved and closed, the other kept its editor and is named.
    expect(pressables(renderer, t('Common_Cancel'))).toHaveLength(1);
    const partial = tFmt('Rn_SaveAllPartialRow', 1, 2);
    expect(visibleTexts(renderer)).toContain(partial);

    await act(async () => {
      pressables(renderer, t('Rn_CancelAll'))[0].props.onPress();
    });
    // The remaining draft is gone and the stale sentence with it.
    expect(pressables(renderer, t('Common_Cancel'))).toHaveLength(0);
    expect(visibleTexts(renderer)).not.toContain(partial);
    // The successful write is never undone.
    expect(mockSaveMeal).toHaveBeenCalledTimes(2);
  });

  test('changing the day re-registers only the cards that are still on screen', async () => {
    const renderer = await renderDashboard(DAY);
    await openEditor(renderer, 0);
    expect(pressables(renderer, t('Rn_CancelAll'))).toHaveLength(1);
    expect(visibleTexts(renderer)).toContain(t('Rn_EditorOpenOne'));

    // Browse another day. The same card instances stay mounted (they are keyed by
    // meal slot), so the open editor follows the user - but exactly ONE editor is
    // still accounted for: the previous day's registration was replaced, never
    // added to.
    await act(async () => {
      renderer.update(<DashboardScreen route={{ params: { date: OTHER_DAY } }} />);
    });
    expect(visibleTexts(renderer)).toContain(t('Rn_EditorOpenOne'));
    expect(visibleTexts(renderer)).not.toContain(tFmt('Rn_EditorsOpen', 2));

    // And that one editor is the ONLY thing Cancel all addresses.
    await act(async () => {
      pressables(renderer, t('Rn_CancelAll'))[0].props.onPress();
    });
    expect(pressables(renderer, t('Rn_CancelAll'))).toHaveLength(0);
    expect(pressables(renderer, t('Common_Edit'))).toHaveLength(5);
    expect(mockSaveMeal).not.toHaveBeenCalled();
  });
});

