// The Calendar page as the mockup draws it: three outlined blocks (month strip,
// weekday strip, date matrix with its attached key), a filled indigo selection,
// today's thin outline (also when another day is selected), five meal marks per
// recorded day, and a selected-day row plus a grouped agenda.
//
// The page is driven here through its REAL component with the data layer mocked,
// so the assertions are about behaviour, not markup: the markers follow the real
// clock (today is computed from the machine's date), the grid comes from the real
// `monthGrid`, one tap previews a date (no navigation), and a SECOND tap of the
// same date within 300 ms opens exactly that date - the same thing long press and
// the cell's accessibility action do.

import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { StyleSheet, Text, View } from 'react-native';

import { MealCategoryKey, MealStatus, SyncStatus } from '../src/domain/enums';
import { MealEntry } from '../src/domain/models';
import { formatDate } from '../src/domain/analytics';
import { monthGrid } from '../src/ui/calendarGrid';
import { CalendarScreen } from '../src/ui/screens/CalendarScreen';
import { formatLongDate, formatMonthLabel, t, tFmt } from '../src/ui/strings';
import { darkColors, lightColors } from '../src/ui/theme';
/** ONE stable app object, mutable per test (the theme, the clock). */
const mockApp = { profile: { id: 'profile-1' }, isDark: false, use12HourClock: false };

jest.mock('../src/ui/appContext', () => ({
  useApp: () => mockApp,
}));

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
  // Stable identities: the page sets this into state, and a new array per call
  // would re-render the board after every reload.
  const categories = [
    { id: 'c1', fixedCategoryKey: 1, name: 'Breakfast', color: '#FF0F6CBD', icon: '🥐', defaultTime: '07:30:00', displayOrder: 0 },
    { id: 'c2', fixedCategoryKey: 2, name: 'Morning snack', color: '#FF0F6CBD', icon: '🍎', defaultTime: '10:30:00', displayOrder: 1 },
    { id: 'c3', fixedCategoryKey: 3, name: 'Lunch', color: '#FF0F6CBD', icon: '🍲', defaultTime: '13:30:00', displayOrder: 2 },
    { id: 'c4', fixedCategoryKey: 4, name: 'Afternoon snack', color: '#FF0F6CBD', icon: '🍪', defaultTime: '16:30:00', displayOrder: 3 },
    { id: 'c5', fixedCategoryKey: 5, name: 'Dinner', color: '#FF0F6CBD', icon: '🍽️', defaultTime: '19:30:00', displayOrder: 4 },
  ];
  return { ensureCategories: async () => categories };
});

jest.mock('../src/cloud/syncEngine', () => ({
  subscribeDataChange: () => () => undefined,
}));

jest.mock('../src/data/repositories', () => ({
  getMealsInRange: jest.fn(async () => []),
  getPhotoCounts: jest.fn(async () => new Map()),
}));

import { getMealsInRange, getPhotoCounts } from '../src/data/repositories';

const mealsMock = getMealsInRange as jest.Mock;
const photosMock = getPhotoCounts as jest.Mock;

/** Today, from the REAL clock - the page must follow it, not a constant. */
const TODAY = formatDate(new Date());
const MONTH = TODAY.slice(0, 7);
/** A second day of the same month, so today stays on the board. */
const OTHER = TODAY.endsWith('-01') ? `${MONTH}-02` : `${MONTH}-01`;

type Renderer = TestRenderer.ReactTestRenderer;

function entry(
  key: MealCategoryKey,
  status: MealStatus,
  title: string,
  ingredients: string,
  plannedTime: string | null,
): MealEntry {
  return {
    id: `meal-${key}`,
    localProfileId: 'profile-1',
    date: OTHER,
    mealCategoryId: `c${key}`,
    mealCategoryKey: key,
    title,
    ingredients,
    plannedTime,
    status,
    completedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    revision: 1,
    syncStatus: SyncStatus.PendingUpload,
    cloudRevision: null,
    contentHash: null,
  };
}

/** Breakfast done with a title and two photographs, lunch missed with none. */
const ENTRIES: MealEntry[] = [
  entry(MealCategoryKey.Breakfast, MealStatus.Done, 'Oatmeal', '', '07:30:00'),
  entry(MealCategoryKey.Lunch, MealStatus.Missed, '', 'soup', null),
];

async function renderScreen(initialDate?: string) {
  const onOpenDay = jest.fn();
  let renderer: Renderer | undefined;
  await act(async () => {
    renderer = TestRenderer.create(
      <CalendarScreen onOpenDay={onOpenDay} initialDate={initialDate} initialDateRequestId={1} />,
    );
  });
  if (renderer === undefined) {
    throw new Error('the calendar did not render');
  }
  return { renderer, onOpenDay };
}

function styleOf(node: { props: { style?: unknown } }): Record<string, unknown> {
  const style = node.props.style;
  const resolved =
    typeof style === 'function'
      ? (style as (state: { pressed: boolean }) => unknown)({ pressed: false })
      : style;
  return (StyleSheet.flatten(resolved as never) ?? {}) as Record<string, unknown>;
}

/** Every text the page prints. */
function texts(renderer: Renderer): string[] {
  return renderer.root
    .findAllByType(Text)
    .map((node) => node.props.children)
    .filter((value): value is string => typeof value === 'string');
}

/** The cell of one date, found by its accessible name. */
function cell(renderer: Renderer, date: string): TestRenderer.ReactTestInstance {
  const found = renderer.root
    .findAll(
      (node) =>
        typeof node.props?.accessibilityLabel === 'string' &&
        node.props.accessibilityLabel.startsWith(formatLongDate(date)) &&
        typeof node.props.onLongPress === 'function',
    )
    .pop();
  if (found === undefined) {
    throw new Error(`no cell for ${date}`);
  }
  return found;
}

/** A control of the page, found by its accessible name. */
function pressable(renderer: Renderer, label: string): TestRenderer.ReactTestInstance {
  const found = renderer.root
    .findAll(
      (node) =>
        node.props?.accessibilityLabel === label && typeof node.props.onPress === 'function',
    )
    .pop();
  if (found === undefined) {
    throw new Error(`no control labelled "${label}"`);
  }
  return found;
}

/** The five meal marks inside one cell. */
function marksOf(renderer: Renderer, date: string): Record<string, unknown>[] {
  return cell(renderer, date)
    .findAllByType(View)
    .map((node) => styleOf(node))
    .filter((style) => style.width === 5 && style.height === 5);
}

beforeEach(() => {
  mealsMock.mockResolvedValue(ENTRIES);
  // Breakfast holds two photographs: the agenda and the summary both count them.
  photosMock.mockResolvedValue(new Map([['meal-1', 2]]));
});

describe('the month card', () => {
  test('drops the subtitle and keeps one compact board', async () => {
    const { renderer } = await renderScreen();
    expect(texts(renderer)).not.toContain('Your meals, day by day.');
    // The month label sits between the two arrows, and the seven weekday
    // captions are still Monday-first.
    expect(texts(renderer)).toContain(formatMonthLabel(MONTH));
    const weekdays = t('Calendar_Weekdays').split(/\s+/).filter((name) => name !== '');
    expect(weekdays).toHaveLength(7);
    for (const weekday of weekdays) {
      expect(texts(renderer)).toContain(weekday);
    }
  });

  test('draws every cell of the real grid, in whole weeks', async () => {
    const { renderer } = await renderScreen();
    const cells = renderer.root.findAll(
      (node) => typeof node.props?.onLongPress === 'function',
    );
    const grid = monthGrid(MONTH);
    expect(cells).toHaveLength(grid.dates.length);
    expect(cells.length % 7).toBe(0);
    expect(cells.length).toBeGreaterThanOrEqual(35);
  });

  test('keeps a 44 pt+ target and a compact legend with the dots caption', async () => {
    const { renderer } = await renderScreen();
    const cells = renderer.root.findAll(
      (node) => typeof node.props?.onLongPress === 'function',
    );
    for (const cellNode of cells.slice(0, 7)) {
      // The cell is taller than 44 pt, so the thumb has room even on a 360 dp
      // screen with seven columns.
      expect(styleOf(cellNode).minHeight).toBeGreaterThanOrEqual(44);
    }
    expect(texts(renderer)).toContain(t('Status_Done'));
    expect(texts(renderer)).toContain(t('Status_Missed'));
    expect(texts(renderer)).toContain(t('Status_Pending'));
    expect(texts(renderer)).toContain(t('Rn_CalendarDots'));
    expect(t('Rn_CalendarDots')).toBe('5 dots = 5 meals');
  });
});

describe('the selected day and today', () => {
  test('today starts selected: one filled circle and its outline', async () => {
    const { renderer } = await renderScreen();
    const badge = cell(renderer, TODAY);
    const views = badge.findAllByType(View).map((node) => styleOf(node));
    // The fill (accent) and the outline (the fill's ink, so both read at once).
    expect(views.some((style) => style.backgroundColor === lightColors.accent)).toBe(true);
    expect(views.some((style) => style.borderColor === lightColors.accentFillText)).toBe(true);
    const number = badge.findAllByType(Text)[0];
    expect(styleOf(number).color).toBe(lightColors.accentFillText);
  });

  test('another day selected: the fill moves, today keeps its outline', async () => {
    const { renderer } = await renderScreen(OTHER);
    const selected = cell(renderer, OTHER).findAllByType(View).map((node) => styleOf(node));
    expect(selected.some((style) => style.backgroundColor === lightColors.accent)).toBe(true);
    expect(selected.some((style) => style.borderColor === lightColors.accentFillText)).toBe(false);

    const today = cell(renderer, TODAY).findAllByType(View).map((node) => styleOf(node));
    // Today is NOT filled any more - it keeps the thin accent outline.
    expect(today.some((style) => style.backgroundColor === lightColors.accent)).toBe(false);
    expect(today.some((style) => style.borderColor === lightColors.accent)).toBe(true);
  });
});

describe('the day marks', () => {
  test('a recorded day shows exactly five dots, in meal order', async () => {
    const { renderer } = await renderScreen(OTHER);
    const marks = marksOf(renderer, OTHER);
    expect(marks).toHaveLength(5);
    // Breakfast done, lunch missed, the three untouched slots pending.
    expect(marks.map((style) => style.backgroundColor)).toEqual([
      lightColors.done,
      lightColors.pending,
      lightColors.missed,
      lightColors.pending,
      lightColors.pending,
    ]);
  });

  test('an untouched day shows no dots at all', async () => {
    const { renderer } = await renderScreen(OTHER);
    expect(marksOf(renderer, TODAY)).toHaveLength(0);
  });
});


describe('the selected day row', () => {
  test('shows the counts and photographs of THAT day, and opens it', async () => {
    const { renderer, onOpenDay } = await renderScreen(OTHER);
    const printed = texts(renderer);
    // The old heading row is gone: no compact date line and no "double-tap"
    // hint (asserted on the literal copy, so re-adding the line fails here).
    expect(printed).not.toContain('Double-tap a date to open');
    expect(printed).not.toContain(formatLongDate(OTHER));
    // The summary follows the data: three real counts, each keeping its status
    // word, plus the day's photograph total - the items can wrap, so nothing is
    // truncated on a narrow card.
    expect(printed).toContain(`1 ${t('Status_Done')}`);
    expect(printed).toContain(`1 ${t('Status_Missed')}`);
    expect(printed).toContain(`3 ${t('Status_Pending')}`);
    expect(
      printed.some((line) => line.includes(tFmt('Rn_CalendarPhotoCount', 2))),
    ).toBe(true);
    // The row is still SPOKEN as the one sentence the page always read out.
    const spoken = renderer.root
      .findAll(
        (node) =>
          node.props?.accessibilityLabel ===
          `${tFmt('Rn_CalendarDaySummary', 1, 1, 3)} · ${tFmt('Rn_CalendarPhotoCount', 2)}`,
      )
      .pop();
    expect(spoken).toBeDefined();

    // Neither the filled "Open day" button nor the old inline hint row is back:
    // no control on the page carries the open action as its own press.
    expect(printed).not.toContain('Double-tap a date to open');
    expect(
      renderer.root.findAll(
        (node) =>
          node.props?.accessibilityLabel === t('Calendar_OpenDay') &&
          typeof node.props.onPress === 'function',
      ),
    ).toHaveLength(0);

    // Long press still opens that exact date (the fallback for the gesture).
    act(() => cell(renderer, OTHER).props.onLongPress());
    expect(onOpenDay).toHaveBeenCalledWith(OTHER);
  });

  test('an untouched day still shows all three counts, in order', async () => {
    mealsMock.mockResolvedValue([]);
    const { renderer } = await renderScreen(OTHER);
    // 0 Done · 0 Missed · 5 Pending - the same three items a busy day shows, and
    // the zeros stay visible.
    const printed = texts(renderer);
    expect(printed).toContain(`0 ${t('Status_Done')}`);
    expect(printed).toContain(`0 ${t('Status_Missed')}`);
    expect(printed).toContain(`5 ${t('Status_Pending')}`);
    // No photographs were invented for the empty slots.
    expect(printed.some((line) => line.includes(tFmt('Rn_CalendarPhotoCount', 0)))).toBe(false);
  });
});

describe('the agenda of the selected day', () => {
  test("leads a titled meal with its title and names the slot underneath", async () => {
    const { renderer } = await renderScreen(OTHER);
    const printed = texts(renderer);
    expect(printed).toContain('Oatmeal');
    expect(printed).toContain('Breakfast');
    // The category glyph of every slot is the meal card's own line icon.
    const glyphs = renderer.root
      .findAll((node) => typeof node.props?.accessibilityLabel === 'string')
      .map((node) => node.props.accessibilityLabel as string);
    for (const glyph of [
      'material:bowl-mix-outline',
      'material:food-apple-outline',
      'material:silverware-fork-knife',
      'material:cookie-outline',
      'material:room-service-outline',
    ]) {
      expect(glyphs).toContain(glyph);
    }
  });

  test('an empty slot leads with its CATEGORY, never with "No meal recorded"', async () => {
    const { renderer } = await renderScreen(OTHER);
    const printed = texts(renderer);
    // Lunch has no title: the row's primary line is the category, and its
    // description is the secondary line.
    expect(printed).toContain('Lunch');
    expect(printed).toContain('soup');
    expect(printed).not.toContain('No meal recorded');
    // A slot with neither title nor description still names its category once,
    // and adds no second line.
    const afternoon = renderer.root
      .findAllByType(Text)
      .filter((node) => node.props.children === 'Afternoon snack');
    expect(afternoon).toHaveLength(1);
  });

  test('shows the photograph count and a small status pill per slot', async () => {
    const { renderer } = await renderScreen(OTHER);
    // The camera glyph only appears on the slot that holds the photographs.
    const cameras = renderer.root.findAll(
      (node) => node.props?.accessibilityLabel === 'icon:camera-outline',
    );
    expect(cameras.length).toBeGreaterThan(0);
    // ...beside the COUNT itself (a number, not a string).
    const counts = renderer.root
      .findAllByType(Text)
      .map((node) => node.props.children)
      .filter((value) => typeof value === 'number');
    expect(counts).toContain(2);
    expect(texts(renderer)).toContain(t('Status_Done'));
    expect(texts(renderer)).toContain(t('Status_Missed'));
    expect(texts(renderer)).toContain(t('Status_Pending'));
  });

  test('a day with nothing recorded still lists its five slots', async () => {
    mealsMock.mockResolvedValue([]);
    const { renderer } = await renderScreen(OTHER);
    // Five category rows, each naming its slot - and no invented content.
    for (const name of ['Breakfast', 'Morning snack', 'Lunch', 'Afternoon snack', 'Dinner']) {
      expect(texts(renderer)).toContain(name);
    }
    expect(texts(renderer)).not.toContain('Oatmeal');
  });

  test('separates every pair of rows with one inset 1 dp divider', async () => {
    const { renderer } = await renderScreen(OTHER);
    const agenda = renderer.root.findAllByType(View).find((node) => {
      const style = styleOf(node);
      // The flat 16 dp agenda surface (the rounded, clipped card).
      return style.borderRadius === 16 && style.borderWidth === 1 && style.overflow === 'hidden';
    });
    expect(agenda).toBeDefined();
    const dividers = agenda!
      .findAllByType(View)
      .map((node) => styleOf(node))
      .filter(
        (style) => style.height === 1 && style.backgroundColor === lightColors.cardDivider,
      );
    // Five rows -> four rules, none before the first row or after the last.
    expect(dividers).toHaveLength(4);
    for (const divider of dividers) {
      // INSET to the row gutters, so a rule never touches the card's frame.
      expect(divider.marginHorizontal).toBe(14);
    }
  });

  test('attaches the legend to the matrix with ONE shared rule', async () => {
    const { renderer } = await renderScreen(OTHER);
    const legends = renderer.root.findAllByType(View).filter((node) => {
      const style = styleOf(node);
      // The key is the matrix's footer: its own borderTop is the shared line.
      return style.borderTopWidth === 1 && style.marginTop === 4 && style.paddingVertical === 6;
    });
    expect(legends).toHaveLength(1);
    // Full width inside the matrix: no horizontal margin, so the line meets both
    // side borders - and there is no separate 1 dp rule above the key.
    expect(styleOf(legends[0]).marginHorizontal).toBeUndefined();
    expect(styleOf(legends[0]).paddingHorizontal).toBe(8);
    const standaloneRules = renderer.root
      .findAllByType(View)
      .map((node) => styleOf(node))
      .filter(
        (style) => style.height === 1 && style.backgroundColor === lightColors.cardDivider,
      );
    // Only the agenda's four inset row rules are separate 1 dp Views.
    expect(standaloneRules).toHaveLength(4);
    expect(standaloneRules.every((rule) => rule.marginHorizontal === 14)).toBe(true);
  });
});


describe('opening a day with the date gesture', () => {
  /** A controlled clock: the page reads Date.now() through this, nothing sleeps. */
  let now = 1_700_000_000_000;
  let clock: jest.SpyInstance<number, []>;

  beforeEach(() => {
    now = 1_700_000_000_000;
    clock = jest.spyOn(Date, 'now').mockImplementation(() => now);
  });

  afterEach(() => {
    clock.mockRestore();
  });

  function tap(renderer: Renderer, date: string): void {
    act(() => cell(renderer, date).props.onPress());
  }

  test('a single tap previews the date immediately and opens nothing', async () => {
    const { renderer, onOpenDay } = await renderScreen();
    expect(cell(renderer, OTHER).props.accessibilityState.selected).toBe(false);
    tap(renderer, OTHER);
    expect(onOpenDay).not.toHaveBeenCalled();
    // The preview followed the FIRST tap - no timer, no delayed selection. The
    // state is read from the CELL, which is now the only thing carrying the date.
    expect(cell(renderer, OTHER).props.accessibilityState.selected).toBe(true);
  });

  test('a second tap of the SAME date inside 300 ms opens that exact date once', async () => {
    const { renderer, onOpenDay } = await renderScreen();
    tap(renderer, OTHER);
    now += 120;
    tap(renderer, OTHER);
    expect(onOpenDay).toHaveBeenCalledTimes(1);
    expect(onOpenDay).toHaveBeenCalledWith(OTHER);
  });

  test('a different date, or a tap after 300 ms, opens nothing', async () => {
    const different = await renderScreen();
    tap(different.renderer, OTHER);
    now += 100;
    tap(different.renderer, TODAY);
    expect(different.onOpenDay).not.toHaveBeenCalled();

    const late = await renderScreen();
    tap(late.renderer, OTHER);
    now += 301;
    tap(late.renderer, OTHER);
    expect(late.onOpenDay).not.toHaveBeenCalled();
  });

  test('a rapid third press never opens a second time', async () => {
    const { renderer, onOpenDay } = await renderScreen();
    tap(renderer, OTHER);
    now += 100;
    tap(renderer, OTHER);
    expect(onOpenDay).toHaveBeenCalledTimes(1);
    // The pair was consumed by the open: a third press starts a NEW candidate.
    now += 100;
    tap(renderer, OTHER);
    expect(onOpenDay).toHaveBeenCalledTimes(1);
  });

  test('first-tapping a neighbouring month still allows the second tap', async () => {
    const { renderer, onOpenDay } = await renderScreen();
    const neighbour = monthGrid(MONTH).dates.find((date) => date.slice(0, 7) !== MONTH);
    expect(neighbour).toBeDefined();
    // The first tap selects it AND moves the grid; that month change must NOT
    // clear the pair, or the gesture could never work on those days.
    tap(renderer, neighbour as string);
    now += 80;
    tap(renderer, neighbour as string);
    expect(onOpenDay).toHaveBeenCalledTimes(1);
    expect(onOpenDay).toHaveBeenCalledWith(neighbour);
  });

  test('the explicit controls clear a pending first tap', async () => {
    const { renderer, onOpenDay } = await renderScreen();
    // The header's "Today" shortcut is gone; the month arrows are the page's
    // explicit controls now.
    expect(
      renderer.root.findAll(
        (node) =>
          node.props?.accessibilityLabel === t('Calendar_Today') &&
          typeof node.props.onPress === 'function',
      ),
    ).toHaveLength(0);
    tap(renderer, OTHER);
    // Previous + next month: back on the same grid, but the candidate is gone.
    act(() => pressable(renderer, t('Calendar_PreviousMonth')).props.onPress());
    act(() => pressable(renderer, t('Calendar_NextMonth')).props.onPress());
    tap(renderer, OTHER);
    expect(onOpenDay).not.toHaveBeenCalled();
  });

  test('an externally requested date clears a pending first tap', async () => {
    const { renderer, onOpenDay } = await renderScreen();
    tap(renderer, OTHER);
    await act(async () => {
      renderer.update(
        <CalendarScreen onOpenDay={onOpenDay} initialDate={TODAY} initialDateRequestId={2} />,
      );
    });
    tap(renderer, OTHER);
    expect(onOpenDay).not.toHaveBeenCalled();
  });

  test('long press opens the exact date and swallows its trailing onPress', async () => {
    const { renderer, onOpenDay } = await renderScreen();
    act(() => cell(renderer, OTHER).props.onLongPress());
    expect(onOpenDay).toHaveBeenCalledTimes(1);
    expect(onOpenDay).toHaveBeenCalledWith(OTHER);
    // Both platforms emit the press after a long press: it must not open twice.
    tap(renderer, OTHER);
    expect(onOpenDay).toHaveBeenCalledTimes(1);
    // The NEXT completed pair still opens: a long press does not disarm the cell.
    now += 400;
    tap(renderer, OTHER);
    now += 80;
    tap(renderer, OTHER);
    expect(onOpenDay).toHaveBeenCalledTimes(2);
  });

  test('the accessibility action opens the exact date once', async () => {
    const { renderer, onOpenDay } = await renderScreen();
    const target = cell(renderer, OTHER);
    expect(target.props.accessibilityActions).toEqual([
      { name: 'openDay', label: t('Calendar_OpenDay') },
    ]);
    expect(target.props.accessibilityHint).toBe(t('Rn_CalendarSelectHint'));
    act(() => target.props.onAccessibilityAction({ nativeEvent: { actionName: 'openDay' } }));
    expect(onOpenDay).toHaveBeenCalledTimes(1);
    expect(onOpenDay).toHaveBeenCalledWith(OTHER);
  });
});

describe('the dark theme', () => {
  afterEach(() => {
    mockApp.isDark = false;
  });

  test('paints the same markers with the dark tokens', async () => {
    mockApp.isDark = true;
    const { renderer } = await renderScreen();
    const badge = cell(renderer, TODAY);
    const views = badge.findAllByType(View).map((node) => styleOf(node));
    expect(views.some((style) => style.backgroundColor === darkColors.accent)).toBe(true);
    expect(views.some((style) => style.borderColor === darkColors.accentFillText)).toBe(true);
    const number = badge.findAllByType(Text)[0];
    expect(styleOf(number).color).toBe(darkColors.accentFillText);
    expect(darkColors.accent).not.toBe(lightColors.accent);
  });
});

