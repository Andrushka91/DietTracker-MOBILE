// The dashboard's day header (v3 reference) - the part that lives in
// DashboardScreen rather than in a component of its own:
//
//   * the DATE is a plain heading on EVERY day: ONE 15 pt regular phrase with the
//     year in it ("Thu 5 Nov 2026"), no dot, no badge, no highlight and NO press
//     handler - tapping it does nothing, so the header has exactly one job per
//     control;
//   * on the CURRENT day only, a plain 11 pt "Today" caption sits 2 dp directly
//     beneath that phrase, in the same centred column. It is text, never a chip,
//     a fill, a dot or a second control, and it disappears the moment another day
//     is browsed (or the local date rolls over);
//   * the two equal arrows are the header's ONLY date navigation: there is no
//     calendar button, no return-to-current-day shortcut and no space reserved
//     for one;
//   * "today" is re-read on focus, on resume and just after local midnight,
//     WITHOUT changing the day being browsed;
//   * the two day-wide actions stay truthful about being disabled - and each is a
//     real touch target around a small outlined control - while Save all is only
//     wired while it has work.

import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { readFileSync } from 'fs';
import { join } from 'path';
import { Platform, StyleSheet, Text } from 'react-native';

import { addDays, formatDate } from '../src/domain/analytics';
import { MealCategoryKey, MealStatus, SyncStatus } from '../src/domain/enums';
import { MealCategory, MealEntry } from '../src/domain/models';
import { DashboardScreen } from '../src/ui/screens/DashboardScreen';
import { SaveAllRow } from '../src/ui/components/SaveAllRow';
import { formatCompactDate, formatLongDate, t } from '../src/ui/strings';
import { homeCompact, homeTodayInk } from '../src/ui/homeCompact';
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

/** The date phrase the header shows for `day`: weekday, day, month AND year. */
function fullDate(day: string): string {
  const compact = formatCompactDate(day);
  return [compact.primary, compact.year].filter(Boolean).join(' ');
}

/**
 * The date heading: the ONE accessible element carrying the header role and the
 * full-date label (plus "Today" on the current day). Its two texts - the date
 * phrase and the caption - live inside it, which is exactly why the caption is
 * announced once instead of being a second focus stop.
 */
function headingOf(renderer: Renderer): TestRenderer.ReactTestInstance {
  const found = renderer.root
    .findAll((node) => node.props?.accessibilityRole === 'header')
    .pop();
  if (found === undefined) {
    throw new Error('no date heading');
  }
  return found;
}

/** The small visible outline inside a day action's 48 pt / 44 pt touch target. */
function outlineOf(control: TestRenderer.ReactTestInstance): TestRenderer.ReactTestInstance {
  const found = control
    .findAll((node) => typeof node.type === 'string' && styleOf(node).borderWidth === 1)
    .pop();
  if (found === undefined) {
    throw new Error('no visible outline inside the action target');
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
  test('is ONE date phrase plus a plain Today caption on the current day', async () => {
    const day = todayKey();
    const renderer = await renderDashboard(day);
    const compact = formatCompactDate(day);

    // A heading, not a control: the header role on one element, no press handler.
    const heading = headingOf(renderer);
    expect(heading.props.onPress).toBeUndefined();
    expect(heading.props.accessibilityHint).toBeUndefined();
    // "Today" is announced ONCE, appended to the heading's own label.
    expect(heading.props.accessibilityLabel).toBe(`${formatLongDate(day)}, ${t('Common_Today')}`);
    // Exactly ONE node carries that label, so no second heading or control
    // repeats the date or the caption.
    const labelledHosts = renderer.root
      .findAll((node) => node.props?.accessibilityLabel === heading.props.accessibilityLabel)
      .filter((node) => typeof node.type === 'string');
    expect(labelledHosts).toHaveLength(1);

    // The date is ONE phrase with the year in it: 15 pt regular on a 20 pt line.
    const dateText = textOf(renderer, fullDate(day));
    const dateInk = styleOf(dateText);
    expect(dateInk.fontSize).toBe(homeCompact.dateSize);
    expect(dateInk.lineHeight).toBe(homeCompact.dateLine);
    expect(dateInk.fontFamily).toBe(fonts.regular);
    expect(dateInk.color).toBe(lightColors.text);
    expect(dateInk.textAlign).toBe('center');
    // It wraps instead of truncating at large text sizes.
    expect(dateText.props.numberOfLines).toBeUndefined();
    // ...and the year no longer gets a line of its own.
    expect(texts(renderer)).not.toContain(compact.year);

    // "Today" is plain 11 pt semibold caption text 2 dp beneath the date.
    const today = textOf(renderer, t('Common_Today'));
    const todayInk = styleOf(today);
    expect(todayInk.fontSize).toBe(homeCompact.todaySize);
    expect(todayInk.lineHeight).toBe(homeCompact.todayLine);
    expect(todayInk.fontFamily).toBe(fonts.medium);
    expect(todayInk.color).toBe(homeTodayInk.light);
    expect(todayInk.textAlign).toBe('center');
    // No side badge, fill, border, dot or underline - just the word.
    expect(todayInk.width).toBe('100%');
    expect(todayInk.backgroundColor).toBeUndefined();
    expect(todayInk.borderWidth).toBeUndefined();
    expect(todayInk.textDecorationLine).toBeUndefined();
    expect(byTestId(renderer, 'day-current-dot')).toBeNull();
    expect(byTestId(renderer, 'day-current-spacer')).toBeNull();
    expect(byTestId(renderer, 'day-date-badge')).toBeNull();
    // It is not a control and there is no return-to-today shortcut.
    expect(today.props.onPress).toBeUndefined();
    expect(shortcuts(renderer)).toHaveLength(0);

    // Date and caption share ONE centred column, 2 dp apart, and each spans it.
    const column = styleOf(heading);
    expect(column.flexDirection).toBe('column');
    expect(column.alignItems).toBe('center');
    expect(column.gap).toBe(homeCompact.dateCaptionGap);
    expect(styleOf(dateText).textAlign).toBe('center');
  });

  test('drops the caption on an OTHER day and keeps the same date type', async () => {
    const current = todayKey();
    const other = addDays(current, 1);
    const currentRenderer = await renderDashboard(current);
    const otherRenderer = await renderDashboard(other);

    // The typography is the SAME style on every day: only the words change, so
    // the header cannot jump in height when the day does.
    const currentInk = styleOf(textOf(currentRenderer, fullDate(current)));
    const otherInk = styleOf(textOf(otherRenderer, fullDate(other)));
    expect(otherInk).toEqual(currentInk);
    expect(otherInk.color).toBe(lightColors.text);

    // No caption at all off the current day, and the label is the date alone.
    expect(texts(otherRenderer)).not.toContain(t('Common_Today'));
    expect(headingOf(otherRenderer).props.accessibilityLabel).toBe(formatLongDate(other));

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

    // Today: the date phrase carries the year and the caption is there.
    expect(texts(renderer)).toContain(fullDate(day));
    expect(texts(renderer)).toContain(t('Common_Today'));

    // Tomorrow is not today any more, so the caption disappears with the date
    // change - the words are the header's only difference between days.
    await act(async () => {
      pressable(renderer, t('Dashboard_NextDay')).props.onPress();
    });
    expect(texts(renderer)).toContain(fullDate(addDays(day, 1)));
    expect(texts(renderer)).not.toContain(t('Common_Today'));

    // ...and stepping back onto the current day brings it back.
    await act(async () => {
      pressable(renderer, t('Dashboard_PreviousDay')).props.onPress();
    });
    expect(texts(renderer)).toContain(fullDate(day));
    expect(texts(renderer)).toContain(t('Common_Today'));

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
  test('stays neutral, and the Today caption wears its own dark ink', async () => {
    mockApp.isDark = true;
    const day = todayKey();
    const renderer = await renderDashboard(day);

    const dateInk = styleOf(textOf(renderer, fullDate(day)));
    expect(dateInk.color).toBe(darkColors.text);
    expect(dateInk.color).not.toBe(darkColors.accent);
    expect(dateInk.fontFamily).toBe(fonts.regular);
    // The caption is the only tinted line: its own lighter indigo, not the accent.
    expect(styleOf(textOf(renderer, t('Common_Today'))).color).toBe(homeTodayInk.dark);
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

    // ...and the heading is plain text with no press handler.
    const heading = headingOf(renderer);
    expect(heading.type).toBe('View');
    expect(heading.props.onPress).toBeUndefined();
    expect(heading.props.onClick).toBeUndefined();
  });
});

describe('staying correct across midnight', () => {
  test('drops the Today caption without changing the selected day', async () => {
    jest.useFakeTimers({ now: new Date(2026, 10, 4, 23, 59, 0) });
    try {
      // The selected day IS the current day at 23:59, so it is captioned.
      const renderer = await renderDashboard('2026-11-04');
      expect(texts(renderer)).toContain(fullDate('2026-11-04'));
      expect(texts(renderer)).toContain(t('Common_Today'));

      // 61 s later the local date has rolled over to 5 November.
      await act(async () => {
        jest.advanceTimersByTime(61_000);
      });

      // The SELECTED day is untouched...
      expect(texts(renderer)).toContain(fullDate('2026-11-04'));
      // ...but it is yesterday now, so the caption and its label go away.
      expect(texts(renderer)).not.toContain(t('Common_Today'));
      expect(headingOf(renderer).props.accessibilityLabel).toBe(formatLongDate('2026-11-04'));
    } finally {
      jest.clearAllTimers();
      jest.useRealTimers();
    }
  });
});

describe('the day-wide actions', () => {
  test('are two equal outlined controls inside real touch targets', async () => {
    const renderer = await renderDashboard(todayKey());
    const missed = pressable(renderer, t('Rn_MarkAllMissed'));
    const done = pressable(renderer, t('Rn_MarkAllDone'));
    // The platform's own minimum target, straight from the Home tokens.
    const target = Platform.OS === 'ios' ? homeCompact.touchIOS : homeCompact.touchAndroid;

    for (const control of [missed, done]) {
      const style = styleOf(control);
      // The TARGET is 48 dp on Android / 44 pt on iOS, with no hitSlop padding.
      expect(style.minHeight).toBe(target);
      expect(style.flex).toBe(1);
      expect(style.opacity).toBeUndefined();
      expect(control.props.hitSlop).toBeUndefined();

      // The VISIBLE control inside it is the small neutral outline.
      const outline = styleOf(outlineOf(control));
      expect(outline.minHeight).toBe(homeCompact.controlVisibleMinHeight);
      expect(outline.borderWidth).toBe(1);
      expect(outline.borderRadius).toBe(homeCompact.controlRadius);
      // Neutral chrome: never a solid red/green slab.
      expect(outline.backgroundColor).toBe(lightColors.cardFill);
      expect(outline.borderColor).toBe(lightColors.cardDivider);
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
      // Truthful disabled: the whole target fades once - the outline inside it
      // keeps the neutral card fill instead of turning into a coloured slab.
      expect(styleOf(control).opacity).toBe(homeCompact.disabledOpacity);
      expect(styleOf(control).backgroundColor).toBeUndefined();
      expect(styleOf(outlineOf(control)).backgroundColor).toBe(lightColors.cardFill);
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

