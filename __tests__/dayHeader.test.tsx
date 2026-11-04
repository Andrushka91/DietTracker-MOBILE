// The dashboard's day header (r3 reference) - the part that lives in
// DashboardScreen rather than in a component of its own:
//
//   * the DATE is a plain heading on EVERY day: 20 pt regular neutral ink with a
//     muted year beneath, no dot, no badge, no highlight, and NO press handler -
//     tapping it does nothing, so the header has exactly one job per control;
//   * the two 44 pt arrows are the header's ONLY date navigation: there is no
//     calendar button, no return-to-current-day shortcut and no space reserved
//     for one, on the current day or on any other;
//   * the current/next-day headers therefore have the same structure and height;
//   * "today" is re-read on focus, on resume and just after local midnight,
//     WITHOUT changing the day being browsed;
//   * the two day-wide actions stay truthful about being disabled, and Save all
//     is only wired while it has work.

import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { readFileSync } from 'fs';
import { join } from 'path';
import { StyleSheet, Text } from 'react-native';

import { addDays, formatDate } from '../src/domain/analytics';
import { MealCategoryKey, MealStatus, SyncStatus } from '../src/domain/enums';
import { MealCategory, MealEntry } from '../src/domain/models';
import { DashboardScreen } from '../src/ui/screens/DashboardScreen';
import { SaveAllRow } from '../src/ui/components/SaveAllRow';
import { formatCompactDate, formatLongDate, t } from '../src/ui/strings';
import { darkColors, fonts, lightColors } from '../src/ui/theme';

type Renderer = TestRenderer.ReactTestRenderer;

/** The device-local today, written the way the app writes dates. */
function todayKey(): string {
  return formatDate(new Date());
}

/** Five real categories - the header only needs their keys and names. */
const mockCategories: MealCategory[] = [
  { id: 'c1', fixedCategoryKey: MealCategoryKey.Breakfast, name: 'Breakfast', color: '#FF0F6CBD', icon: 'A', defaultTime: '07:30:00', displayOrder: 0 },
  { id: 'c2', fixedCategoryKey: MealCategoryKey.MorningSnack, name: 'Morning snack', color: '#FF0F6CBD', icon: 'B', defaultTime: '10:30:00', displayOrder: 1 },
  { id: 'c3', fixedCategoryKey: MealCategoryKey.Lunch, name: 'Lunch', color: '#FF0F6CBD', icon: 'C', defaultTime: '13:30:00', displayOrder: 2 },
  { id: 'c4', fixedCategoryKey: MealCategoryKey.AfternoonSnack, name: 'Afternoon snack', color: '#FF0F6CBD', icon: 'D', defaultTime: '16:30:00', displayOrder: 3 },
  { id: 'c5', fixedCategoryKey: MealCategoryKey.Dinner, name: 'Dinner', color: '#FF0F6CBD', icon: 'E', defaultTime: '19:30:00', displayOrder: 4 },
];

/** What `loadDay` returns for the rendered date. */
let mockRows: Array<{ key: MealCategoryKey; title: string; status: MealStatus }> = [];

/** One stored slot of the mocked day. */
function mockMeal(
  row: { key: MealCategoryKey; title: string; status: MealStatus },
  date: string,
): MealEntry {
  return {
    id: `meal-${row.key}`,
    localProfileId: 'profile-1',
    date,
    mealCategoryId: `c${row.key}`,
    mealCategoryKey: row.key,
    title: row.title,
    ingredients: '',
    plannedTime: null,
    status: row.status,
    completedAt: null,
    createdAt: `${date}T07:00:00.000Z`,
    updatedAt: `${date}T07:00:00.000Z`,
    revision: 1,
    syncStatus: SyncStatus.Synced,
    cloudRevision: null,
    contentHash: null,
  };
}

/** A phone-shaped window; the responsive cases move it themselves. */
const mockWindow = { width: 390, height: 844, scale: 3, fontScale: 1 };
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => mockWindow,
}));

const mockApp = {
  profile: { id: 'profile-1' } as { id: string } | null,
  accountId: null as string | null,
  isDark: false,
  use12HourClock: false,
  setBusy: jest.fn(),
  notifyChanged: jest.fn(),
};
jest.mock('../src/ui/appContext', () => ({ useApp: () => mockApp }));

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

jest.mock('../src/services/mealTracking', () => ({
  ensureCategories: async () => mockCategories,
  loadDay: async (_profileId: string, date: string) => ({
    date,
    meals: mockRows.map((row) => mockMeal(row, date)),
  }),
  markAllDone: jest.fn(async () => ({ changed: 0, skippedEmpty: 0 })),
  markAllMissed: jest.fn(async () => ({ changed: 0, skippedEmpty: 0 })),
  saveMeal: jest.fn(async () => ({ ok: true })),
  completeMeal: jest.fn(async () => ({ changed: false })),
  missMeal: jest.fn(async () => ({ changed: false })),
  clearMeal: jest.fn(async () => undefined),
  ensureMealStored: jest.fn(async () => undefined),
  saveDayAsTemplate: jest.fn(async () => undefined),
}));

jest.mock('../src/data/repositories', () => ({
  getPhotoCounts: async () => new Map(),
  getPhotosForMeal: async () => [],
}));

jest.mock('../src/data/photoStore', () => ({
  addPhotoToMeal: jest.fn(async () => ({ ok: true })),
  removePhoto: jest.fn(async () => undefined),
}));

jest.mock('../src/cloud/syncEngine', () => ({ subscribeDataChange: () => () => undefined }));
jest.mock('../src/cloud/journal', () => ({ journalDelete: jest.fn(async () => undefined) }));

// The cards themselves are not part of the header contract.
jest.mock('../src/ui/components/MealCard', () => ({ MealCard: () => null }));
jest.mock('../src/ui/components/PhotoViewer', () => ({ PhotoViewer: () => null }));

function styleOf(node: { props: { style?: unknown } }): Record<string, unknown> {
  const style = node.props.style;
  const resolved = typeof style === 'function' ? style({ pressed: false }) : style;
  return (StyleSheet.flatten(resolved as never) ?? {}) as Record<string, unknown>;
}

function texts(renderer: Renderer): string[] {
  return renderer.root
    .findAllByType(Text)
    .map((node) => node.props.children)
    .filter((value): value is string => typeof value === 'string');
}

function textOf(renderer: Renderer, value: string): TestRenderer.ReactTestInstance {
  const found = renderer.root.findAllByType(Text).find((node) => node.props.children === value);
  if (found === undefined) {
    throw new Error(`no text "${value}"`);
  }
  return found;
}

/** The one host node carrying a testID (composite wrappers repeat it). */
function byTestId(renderer: Renderer, testID: string): TestRenderer.ReactTestInstance | null {
  const found = renderer.root
    .findAll((node) => node.props?.testID === testID && typeof node.type === 'string')
    .pop();
  return found ?? null;
}

function pressable(renderer: Renderer, label: string): TestRenderer.ReactTestInstance {
  const found = renderer.root
    .findAll(
      (node) => node.props?.accessibilityLabel === label && typeof node.props.onPress === 'function',
    )
    .pop();
  if (found === undefined) {
    throw new Error(`no pressable labelled "${label}"`);
  }
  return found;
}

/**
 * The date heading on `day`: the Text carrying the header role and the full-date
 * accessibility label. It is a heading, so it never has an `onPress` - and it is
 * real text, so it is announced as text rather than as a button.
 */
function headingOf(renderer: Renderer, day: string): TestRenderer.ReactTestInstance {
  const found = renderer.root
    .findAll(
      (node) =>
        node.props?.accessibilityLabel === formatLongDate(day) &&
        node.props?.accessibilityRole === 'header',
    )
    .pop();
  if (found === undefined) {
    throw new Error(`no date heading for ${day}`);
  }
  return found;
}

/**
 * Controls whose accessible name offers a way back to the current day. The
 * corrected header has none - the arrows step one day at a time and nothing
 * else on the card moves the date.
 */
function shortcuts(renderer: Renderer): TestRenderer.ReactTestInstance[] {
  return renderer.root.findAll(
    (node) =>
      typeof node.props?.onPress === 'function' &&
      /current day|today/i.test(String(node.props?.accessibilityLabel ?? '')),
  );
}

/** Renders the dashboard on `date` and waits for the mocked day to load. */
const mockRenderers: Renderer[] = [];

async function renderDashboard(date: string): Promise<Renderer> {
  let renderer: Renderer | undefined;
  await act(async () => {
    renderer = TestRenderer.create(<DashboardScreen route={{ params: { date } }} />);
  });
  if (renderer === undefined) {
    throw new Error('the dashboard did not render');
  }
  mockRenderers.push(renderer);
  return renderer;
}

/** Unmounts every screen so the midnight timer is cleared before the next test. */
afterEach(() => {
  act(() => {
    for (const renderer of mockRenderers.splice(0)) {
      renderer.unmount();
    }
  });
});

beforeEach(() => {
  jest.clearAllMocks();
  mockWindow.width = 390;
  mockWindow.fontScale = 1;
  mockApp.isDark = false;
  mockApp.profile = { id: 'profile-1' };
  // A day with real meals: both bulk actions are eligible.
  mockRows = [
    { key: MealCategoryKey.Breakfast, title: 'Oats', status: MealStatus.Done },
    { key: MealCategoryKey.MorningSnack, title: 'Apple', status: MealStatus.Done },
    { key: MealCategoryKey.Lunch, title: 'Soup', status: MealStatus.Missed },
    { key: MealCategoryKey.AfternoonSnack, title: 'Nuts', status: MealStatus.Pending },
    { key: MealCategoryKey.Dinner, title: 'Rice', status: MealStatus.Pending },
  ];
});


/** The plain date heading, on the real device-local day. */
describe('the date heading', () => {
  test('is plain neutral text with the year beneath, never a Pressable', async () => {
    const day = todayKey();
    const renderer = await renderDashboard(day);
    const compact = formatCompactDate(day);

    // A heading, not a control: the header role on real TEXT, no press handler.
    const heading = headingOf(renderer, day);
    expect(heading.type).toBe('Text');
    expect(heading.props.onPress).toBeUndefined();
    expect(heading.props.accessibilityHint).toBeUndefined();
    // Exactly ONE host node carries the full date - the Text itself - so no
    // wrapper repeats the label or the heading role, and nothing is a control.
    const labelledHosts = renderer.root
      .findAll((node) => node.props?.accessibilityLabel === formatLongDate(day))
      .filter((node) => typeof node.type === 'string');
    expect(labelledHosts).toHaveLength(1);
    expect(labelledHosts[0].type).toBe('Text');

    // 20 pt REGULAR neutral ink - the counters stay the only bold numbers.
    const dateInk = styleOf(textOf(renderer, compact.primary));
    expect(dateInk.fontSize).toBe(20);
    expect(dateInk.fontFamily).toBe(fonts.regular);
    expect(dateInk.color).toBe(lightColors.text);
    // ...and an 11 pt muted year under it.
    const yearInk = styleOf(textOf(renderer, compact.year));
    expect(yearInk.fontSize).toBe(11);
    expect(yearInk.color).toBe(lightColors.textMuted);

    // No marker chrome survives on the current day: no dot, spacer or badge.
    expect(byTestId(renderer, 'day-current-dot')).toBeNull();
    expect(byTestId(renderer, 'day-current-spacer')).toBeNull();
    expect(byTestId(renderer, 'day-date-badge')).toBeNull();
    // ...and no "Today" word, nor any control offering a way back.
    expect(texts(renderer)).not.toContain(t('Calendar_Today'));
    expect(shortcuts(renderer)).toHaveLength(0);
  });

  test('is identical on an OTHER day, with no shortcut and no extra gap', async () => {
    const current = todayKey();
    const other = addDays(current, 1);
    const currentRenderer = await renderDashboard(current);
    const otherRenderer = await renderDashboard(other);

    // The typography is the SAME style object on every day: only the words
    // change, so the header cannot jump in height when the day does.
    const currentInk = styleOf(textOf(currentRenderer, formatCompactDate(current).primary));
    const otherInk = styleOf(textOf(otherRenderer, formatCompactDate(other).primary));
    expect(otherInk).toEqual(currentInk);
    expect(otherInk.color).toBe(lightColors.text);
    expect(styleOf(textOf(otherRenderer, formatCompactDate(other).year)).color).toBe(
      lightColors.textMuted,
    );

    // No marker, no badge, no spacer and - above all - no return shortcut or the
    // gap it used to reserve under the arrows.
    for (const testID of [
      'day-current-dot',
      'day-current-spacer',
      'day-date-badge',
      'day-return-today',
    ]) {
      expect(byTestId(otherRenderer, testID)).toBeNull();
    }
    expect(shortcuts(otherRenderer)).toHaveLength(0);
  });
});

/**
 * The two 44 pt arrows are the header's ONLY date navigation: they walk the
 * diary one day at a time and nothing else on the card moves the date.
 */
describe('the header arrows', () => {
  test('step forward and back, with no other date control present', async () => {
    const day = todayKey();
    const renderer = await renderDashboard(day);

    await act(async () => {
      pressable(renderer, t('Dashboard_NextDay')).props.onPress();
    });
    expect(texts(renderer)).toContain(formatCompactDate(addDays(day, 1)).primary);

    await act(async () => {
      pressable(renderer, t('Dashboard_PreviousDay')).props.onPress();
    });
    expect(texts(renderer)).toContain(formatCompactDate(day).primary);

    // Exactly two labelled controls in the header row: previous and next.
    const controls = renderer.root.findAll(
      (node) =>
        typeof node.props?.onPress === 'function' &&
        [t('Dashboard_PreviousDay'), t('Dashboard_NextDay')].includes(
          node.props?.accessibilityLabel as string,
        ),
    );
    expect(controls.length).toBeGreaterThanOrEqual(2);
    // The date itself is never one of them.
    expect(() => pressable(renderer, formatLongDate(day))).toThrow();
  });
});

/** The same neutral ink in dark mode: no accent, no wash, no hardcoded white. */
describe('the date heading in dark mode', () => {
  test('stays neutral and unhighlighted', async () => {
    mockApp.isDark = true;
    const day = todayKey();
    const renderer = await renderDashboard(day);
    const compact = formatCompactDate(day);

    const dateInk = styleOf(textOf(renderer, compact.primary));
    expect(dateInk.color).toBe(darkColors.text);
    expect(dateInk.color).not.toBe(darkColors.accent);
    expect(dateInk.fontFamily).toBe(fonts.regular);
    expect(styleOf(textOf(renderer, compact.year)).color).toBe(darkColors.textMuted);
    // Nothing draws a marker or a shortcut in the dark theme either.
    expect(byTestId(renderer, 'day-current-dot')).toBeNull();
    expect(byTestId(renderer, 'day-return-today')).toBeNull();
  });
});


/**
 * The date used to open the Calendar. It no longer does anything at all: the
 * Calendar bottom tab stays the way to browse days, and the header keeps its two
 * arrows.
 */
describe('the date is not a control', () => {
  test('never opens the Calendar and carries no choose-date hint', async () => {
    const day = addDays(todayKey(), -1);
    const renderer = await renderDashboard(day);

    // No node offers to choose a date any more...
    const choosing = renderer.root.findAll(
      (node) => node.props?.accessibilityHint === t('Common_ChooseDate'),
    );
    expect(choosing).toHaveLength(0);
    expect(mockNavigate).not.toHaveBeenCalled();

    // ...and the heading is real text with no press handler.
    const heading = headingOf(renderer, day);
    expect(heading.type).toBe('Text');
    expect(heading.props.onPress).toBeUndefined();
    expect(heading.props.onClick).toBeUndefined();
  });
});

describe('staying correct across midnight', () => {
  test('re-reads the local date without changing the selected day', async () => {
    jest.useFakeTimers({ now: new Date(2026, 10, 4, 23, 59, 0) });
    try {
      // The selected day IS the current day at 23:59.
      const renderer = await renderDashboard('2026-11-04');
      expect(texts(renderer)).toContain(formatCompactDate('2026-11-04').primary);

      // 61 s later the local date has rolled over to 5 November.
      await act(async () => {
        jest.advanceTimersByTime(61_000);
      });

      // The SELECTED day is untouched...
      expect(texts(renderer)).toContain(formatCompactDate('2026-11-04').primary);
      // ...and no marker or shortcut appears, because neither exists any more.
      expect(byTestId(renderer, 'day-current-dot')).toBeNull();
      expect(byTestId(renderer, 'day-return-today')).toBeNull();
    } finally {
      jest.clearAllTimers();
      jest.useRealTimers();
    }
  });
});

describe('the day-wide actions', () => {
  test('are two equal outlined buttons, 44 pt tall, with state glyphs', async () => {
    const renderer = await renderDashboard(todayKey());
    const missed = pressable(renderer, t('Rn_MarkAllMissed'));
    const done = pressable(renderer, t('Rn_MarkAllDone'));

    for (const control of [missed, done]) {
      const style = styleOf(control);
      expect(style.minHeight).toBe(44);
      expect(style.borderWidth).toBe(1);
      expect(style.borderRadius).toBe(12);
      expect(style.flex).toBe(1);
      // Neutral chrome: never a solid red/green slab.
      expect(style.backgroundColor).toBe(lightColors.cardFill);
      expect(style.borderColor).toBe(lightColors.cardDivider);
      expect(style.opacity).toBe(1);
    }

    // The glyphs carry the state colours; the labels stay neutral ink.
    const glyphColor = (label: string): unknown =>
      renderer.root.findAll((node) => node.props?.accessibilityLabel === label)[0]?.props.color;
    expect(glyphColor('icon:close')).toBe(lightColors.missed);
    expect(glyphColor('icon:checkmark')).toBe(lightColors.done);
    expect(styleOf(textOf(renderer, t('Rn_MarkAllDone'))).color).toBe(lightColors.text);
  });

  test('disable themselves truthfully on a day with nothing to mark', async () => {
    // Five untouched placeholders: no title, no description -> no eligibility.
    mockRows = mockRows.map((row) => ({ ...row, title: '', status: MealStatus.Pending }));
    const renderer = await renderDashboard(todayKey());

    for (const label of [t('Rn_MarkAllMissed'), t('Rn_MarkAllDone')]) {
      const control = pressable(renderer, label);
      expect(control.props.disabled).toBe(true);
      expect(control.props.accessibilityState).toEqual({ disabled: true });
      // Truthful disabled: the whole button fades, it does not become a fill.
      expect(styleOf(control).opacity).toBe(0.45);
      expect(styleOf(control).backgroundColor).toBe(lightColors.cardFill);
    }
  });

  test('stack at full width on a narrow screen or at 1.3 font scale', async () => {
    mockWindow.width = 320;
    let renderer = await renderDashboard(todayKey());
    expect(styleOf(pressable(renderer, t('Rn_MarkAllDone'))).width).toBe('100%');
    expect(styleOf(pressable(renderer, t('Rn_MarkAllMissed'))).width).toBe('100%');

    mockWindow.width = 390;
    mockWindow.fontScale = 1.3;
    renderer = await renderDashboard(todayKey());
    expect(styleOf(pressable(renderer, t('Rn_MarkAllDone'))).width).toBe('100%');

    // Back on a phone at 1.2 they share the row again.
    mockWindow.fontScale = 1.2;
    renderer = await renderDashboard(todayKey());
    expect(styleOf(pressable(renderer, t('Rn_MarkAllDone'))).width).toBeUndefined();
    expect(styleOf(pressable(renderer, t('Rn_MarkAllDone'))).flex).toBe(1);
  });

  test('Save all exists only while it has work: an idle day wires zero editors', async () => {
    const renderer = await renderDashboard(todayKey());
    const saveRow = renderer.root.findByType(SaveAllRow);
    expect(saveRow.props.unsaved).toBe(0);
    expect(saveRow.props.saving).toBe(false);
    // ...and an idle row draws nothing at all.
    expect(texts(renderer)).not.toContain(t('Dashboard_SaveAll'));
  });
});


/**
 * The refresh WIRING cannot be observed through a render - `AppState` events and
 * focus are outside the tree - so the screen's own source is pinned here: the
 * local date is re-read on focus, on resume and just after local midnight, and
 * the comparison is never a UTC slice. The midnight behaviour itself is covered
 * above with a fake clock.
 */
describe('the local-date refresh wiring', () => {
  test('re-reads "today" on focus, on resume and at each local midnight', () => {
    const source = readFileSync(
      join(__dirname, '..', 'src', 'ui', 'screens', 'DashboardScreen.tsx'),
      'utf8',
    );
    // One helper, used by all three triggers.
    expect(source.match(/refreshToday\(\);/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
    // Focus: the reload callback refreshes before reloading the day.
    expect(source).toContain("AppState.addEventListener('change'");
    expect(source).toContain("state === 'active'");
    // Midnight: the next LOCAL midnight, then re-armed.
    expect(source).toContain('midnight.setHours(24, 0, 0, 0);');
    // Device-local dates only - never a UTC slice.
    expect(source).not.toContain('toISOString().slice(0, 10)');
    expect(source).toContain('formatDate(new Date())');
  });
});

