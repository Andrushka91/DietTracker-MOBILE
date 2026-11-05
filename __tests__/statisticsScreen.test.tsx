// The Statistics page after the vertical-bar redesign.
//
// Pinned here is only what the redesign CHANGED: every period draws vertical
// columns (never the old horizontal rows, and never a width/font fallback),
// pressing a column selects that exact row without navigating, the explicit
// action is the only thing that leaves the page, and the empty branch stays
// honest. The counts themselves come from the unchanged breakdown helpers, so
// their maths is covered by its own suites and not repeated here.

import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';

import { MealCategoryKey, MealStatus, SyncStatus } from '../src/domain/enums';
import { MealEntry } from '../src/domain/models';
import { formatDate, startOfWeek } from '../src/domain/analytics';
import { StatisticsScreen } from '../src/ui/screens/StatisticsScreen';
import { formatLongDate, t, tFmt } from '../src/ui/strings';

type Renderer = TestRenderer.ReactTestRenderer;

/** A phone-sized window; the narrow case moves it itself. */
const mockWindow = { width: 390, height: 844, scale: 3, fontScale: 1 };
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => mockWindow,
}));

const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => {
  const ReactModule = require('react');
  return {
    useNavigation: () => ({ navigate: mockNavigate }),
    // Focus in a test is simply "the effect ran".
    useFocusEffect: (callback: () => void) => {
      ReactModule.useEffect(callback, [callback]);
    },
  };
});

const mockApp = { profile: { id: 'profile-1' } as { id: string } | null, isDark: false };
jest.mock('../src/ui/appContext', () => ({ useApp: () => mockApp }));

/** What the repository returns for the requested range. */
let mockEntries: MealEntry[] = [];
jest.mock('../src/data/repositories', () => ({
  getMealsInRange: async () => mockEntries,
}));
jest.mock('../src/cloud/syncEngine', () => ({ subscribeDataChange: () => () => undefined }));

/** The device-local today, written the way the app writes dates. */
const TODAY = formatDate(new Date());
const WEEK_START = startOfWeek(TODAY);

/** One stored meal slot of `date`. */
function meal(date: string, mealCategoryKey: MealCategoryKey, status: MealStatus): MealEntry {
  return {
    id: `meal-${date}-${mealCategoryKey}`,
    localProfileId: 'profile-1',
    date,
    mealCategoryId: `c${mealCategoryKey}`,
    mealCategoryKey,
    title: status === MealStatus.Pending ? '' : 'Meal',
    ingredients: '',
    plannedTime: null,
    status,
    completedAt: null,
    createdAt: `${date}T07:00:00.000Z`,
    updatedAt: `${date}T07:00:00.000Z`,
    revision: 1,
    syncStatus: SyncStatus.Synced,
    cloudRevision: null,
    contentHash: null,
  };
}

/**
 * The week's first day has 2 done + 1 missed, so the period HAS recorded
 * outcomes; every other day is untouched, which is five pending slots.
 */
function seedWeek(): void {
  mockEntries = [
    meal(WEEK_START, MealCategoryKey.Breakfast, MealStatus.Done),
    meal(WEEK_START, MealCategoryKey.MorningSnack, MealStatus.Done),
    meal(WEEK_START, MealCategoryKey.Lunch, MealStatus.Missed),
  ];
}

/**
 * The same 2 done + 1 missed, but on TODAY - so the day period itself also has
 * recorded outcomes (the day period only covers today).
 */
function seedToday(): void {
  mockEntries = [
    meal(TODAY, MealCategoryKey.Breakfast, MealStatus.Done),
    meal(TODAY, MealCategoryKey.MorningSnack, MealStatus.Done),
    meal(TODAY, MealCategoryKey.Lunch, MealStatus.Missed),
  ];
}

async function renderScreen(): Promise<Renderer> {
  let renderer: Renderer | undefined;
  await act(async () => {
    renderer = TestRenderer.create(<StatisticsScreen />);
  });
  if (renderer === undefined) {
    throw new Error('the statistics page did not render');
  }
  return renderer;
}

function texts(renderer: Renderer): string[] {
  return renderer.root
    .findAllByType(Text)
    .map((node) => node.props.children)
    .filter((value): value is string => typeof value === 'string');
}

/** The chart's own columns: the only pressables whose label names counts. */
function columns(renderer: Renderer): TestRenderer.ReactTestInstance[] {
  return renderer.root.findAll(
    (node) =>
      typeof node.props?.onPress === 'function' &&
      typeof node.props?.accessibilityLabel === 'string' &&
      (node.props.accessibilityLabel as string).includes(' done. '),
  );
}

/**
 * Presses a control and lets the page settle: changing the period starts a new
 * load, and the card deliberately shows the loading state until that snapshot
 * lands (the previous period's numbers are never paired with a new label).
 */
async function press(node: TestRenderer.ReactTestInstance): Promise<void> {
  await act(async () => {
    node.props.onPress();
  });
  await act(async () => {
    await Promise.resolve();
  });
}

/** A control by its accessible name. */
function button(renderer: Renderer, label: string): TestRenderer.ReactTestInstance {
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

beforeEach(() => {
  mockNavigate.mockClear();
  // Every test starts on an empty diary, then seeds the days it needs.
  mockEntries = [];
  mockWindow.width = 390;
  mockWindow.fontScale = 1;
  mockApp.isDark = false;
});

describe('the vertical breakdown', () => {
  test('draws one column per day of the settled week, with real values', async () => {
    seedWeek();
    const renderer = await renderScreen();
    // Seven real day columns on ONE shared scale - and the chart's own chrome.
    expect(columns(renderer)).toHaveLength(7);
    const printed = texts(renderer);
    expect(printed).toContain(t('Rn_StatAxisLabel'));
    expect(printed).toContain(t('Rn_StatChartSelectHint'));
    // The first day's exact value, and a future day's real total (never hidden).
    expect(printed).toContain(tFmt('Rn_StatDoneOfTotal', 2, 5));
    expect(printed).toContain(tFmt('Rn_StatDoneOfTotal', 0, 5));
    // Its label names the context and every count, not just the fraction.
    const first = columns(renderer)[0];
    expect(first.props.accessibilityLabel).toContain(formatLongDate(WEEK_START));
    expect(first.props.accessibilityLabel).toContain(tFmt('Rn_CalendarDaySummary', 2, 1, 2));
  });

  test('keeps the columns on a narrow window with enlarged text', async () => {
    seedWeek();
    mockWindow.width = 320;
    mockWindow.fontScale = 1.6;
    const renderer = await renderScreen();
    // The old page fell back to horizontal rows here; the columns stay, and the
    // CHART (not the page) scrolls.
    expect(columns(renderer)).toHaveLength(7);
    expect(texts(renderer)).toContain(t('Rn_StatAxisLabel'));
  });

  test('all four periods draw columns from the same rows', async () => {
    // Recorded outcomes on TODAY, so every period (including Day) has some.
    seedToday();
    const renderer = await renderScreen();
    for (const [mode, expected] of [
      [t('Rn_PeriodDay'), 5],
      [t('Rn_PeriodWeek'), 7],
      [t('Rn_PeriodMonth'), 6],
      [t('Rn_PeriodYear'), 12],
    ] as const) {
      await press(button(renderer, mode));
      // Mid-load the card is honest (no old numbers), so this also proves the
      // settled period really did arrive.
      // The number of columns follows that period's own grouping.
      expect(columns(renderer)).toHaveLength(expected);
    }
  });

  test('no recorded outcomes shows the honest empty block instead of bars', async () => {
    // No meal has been decided yet: total slots exist, but nothing is recorded.
    const renderer = await renderScreen();
    const printed = texts(renderer);
    expect(printed).toContain(t('Rn_StatEmptyTitle'));
    expect(printed).toContain(t('Rn_StatEmptyBody'));
    // No columns and no chart chrome - the page never invents recorded bars.
    expect(columns(renderer)).toHaveLength(0);
    expect(printed).not.toContain(t('Rn_StatAxisLabel'));
  });
});

describe('selecting a column', () => {
  test('selects the exact row and never navigates on its own', async () => {
    seedWeek();
    const renderer = await renderScreen();
    const first = columns(renderer)[0];
    await act(async () => {
      first.props.onPress();
    });
    // The card's own footer states what the chosen row holds...
    expect(texts(renderer)).toContain(formatLongDate(WEEK_START));
    expect(texts(renderer)).toContain(tFmt('Rn_CalendarDaySummary', 2, 1, 2));
    // ...and the tap alone changed nothing outside this screen.
    expect(mockNavigate).not.toHaveBeenCalled();
    // A second tap on the same column clears the selection again.
    await act(async () => {
      columns(renderer)[0].props.onPress();
    });
    expect(texts(renderer)).not.toContain(tFmt('Rn_CalendarDaySummary', 2, 1, 2));
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  test('only the explicit action opens the day, with a real hand-off', async () => {
    seedWeek();
    const renderer = await renderScreen();
    await act(async () => {
      columns(renderer)[0].props.onPress();
    });
    await act(async () => {
      button(renderer, t('Rn_StatViewDay')).props.onPress();
    });
    expect(mockNavigate).toHaveBeenCalledTimes(1);
    const [target, params] = mockNavigate.mock.calls[0];
    expect(target).toBe('DashboardTab');
    expect((params as { date: string }).date).toBe(WEEK_START);
    // A hand-off carries its own request id, so the same day opens again.
    expect(typeof (params as { requestId: number }).requestId).toBe('number');
  });

  test('a multi-day row opens the calendar instead', async () => {
    seedToday();
    const renderer = await renderScreen();
    // Year rows are whole months, so this column is a genuine range.
    await press(button(renderer, t('Rn_PeriodYear')));
    await press(columns(renderer)[0]);
    await press(button(renderer, t('Rn_StatOpenCalendar')));
    expect(mockNavigate).toHaveBeenCalledTimes(1);
    expect(mockNavigate.mock.calls[0][0]).toBe('CalendarTab');
  });
});

describe('the Today shortcut', () => {
  test('returns to the day view of today from any period, clearing the selection', async () => {
    seedToday();
    const renderer = await renderScreen();
    // Start somewhere else entirely, with a column selected.
    await press(button(renderer, t('Rn_PeriodYear')));
    await press(columns(renderer)[0]);
    expect(texts(renderer)).toContain(t('Rn_StatOpenCalendar'));

    await press(button(renderer, t('Common_Today')));

    // The DAY period of the local today: five meal columns, nothing selected.
    expect(columns(renderer)).toHaveLength(5);
    expect(columns(renderer)[0].props.accessibilityLabel).toContain(formatLongDate(TODAY));
    expect(texts(renderer)).not.toContain(t('Rn_StatOpenCalendar'));
    // ...and it happened INSIDE Statistics: no navigation, no diary hop.
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  test('on the current day it stays there and only clears the meal selection', async () => {
    seedToday();
    const renderer = await renderScreen();
    await press(button(renderer, t('Rn_PeriodDay')));
    await press(columns(renderer)[0]);
    expect(texts(renderer)).toContain(t('Rn_StatViewDay'));

    await press(button(renderer, t('Common_Today')));

    expect(columns(renderer)).toHaveLength(5);
    expect(texts(renderer)).not.toContain(t('Rn_StatViewDay'));
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  test('computes the local date AT PRESS TIME, not at render time', async () => {
    jest.useFakeTimers({ now: new Date(2026, 10, 4, 23, 59, 0) });
    try {
      // The new day has recorded outcomes; the page itself rendered before midnight.
      mockEntries = [
        meal('2026-11-05', MealCategoryKey.Breakfast, MealStatus.Done),
        meal('2026-11-05', MealCategoryKey.Lunch, MealStatus.Missed),
      ];
      const renderer = await renderScreen();
      await act(async () => {
        jest.advanceTimersByTime(61_000);
      });

      await press(button(renderer, t('Common_Today')));

      // The shortcut jumped to the day that is current NOW, not to the stale one.
      expect(columns(renderer)[0].props.accessibilityLabel).toContain(
        formatLongDate('2026-11-05'),
      );
      expect(mockNavigate).not.toHaveBeenCalled();
    } finally {
      jest.clearAllTimers();
      jest.useRealTimers();
    }
  });
});

describe('the month chart labels', () => {
  test('prints one compact two-line bucket per clipped week', async () => {
    seedToday();
    const renderer = await renderScreen();
    await press(button(renderer, t('Rn_PeriodMonth')));
    const buckets = columns(renderer).length;
    // A month always has at least four clipped weeks.
    expect(buckets).toBeGreaterThanOrEqual(4);
    // Every printed bucket is the compact form: a day or range, then the month.
    const compact = texts(renderer).filter((line) => line.includes('\n'));
    expect(compact).toHaveLength(buckets);
    for (const line of compact) {
      expect(line).toMatch(/^\d+(–\d+)?\n[A-Za-z]{3}$/);
    }
    // The year and the full range stay on the accessible label.
    expect(columns(renderer)[0].props.accessibilityLabel).toContain(TODAY.slice(0, 4));
  });
});
