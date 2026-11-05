// The Templates page: the "Templates" heading with its small regular subtitle,
// ONE quiet inline notice, then a compact outlined TILE per template - the
// outlined kind glyph, the real name, ONE metadata row (kind · real meal count,
// update time at the right) and ONE action row holding two SIBLING targets:
// "Meal preview" + chevron, and a neutral outlined "Apply to date" inside a real
// 48/44 dp target. The expanded contents render below that row.
//
// Pinned here: the wording, the count and every time/title come from the stored
// template, the accordion really toggles, preview and apply are separate targets
// (the card itself is not pressable), the apply action still goes through the
// validated date prompt, and - the invariant of this page - a template can never
// show a completion state or a photograph.

import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { StyleSheet, Text, TextInput, View } from 'react-native';

import { MealCategoryKey, SyncStatus } from '../src/domain/enums';
import { MealTemplate, MealTemplateContent } from '../src/domain/models';
import { formatDate } from '../src/domain/analytics';
import { TemplatesScreen } from '../src/ui/screens/TemplatesScreen';
import { formatLongDate, formatMediumDate, t, tFmt } from '../src/ui/strings';
import { lightColors } from '../src/ui/theme';
import { selectedAccentFill } from '../src/ui/accentActions';
import { templatesCalendarTokens } from '../src/ui/templatesCalendar';

/** ONE stable app object, mutable per test (the theme). */
const mockApp = {
  profile: { id: 'profile-1' },
  accountId: null as string | null,
  isDark: false,
  use12HourClock: false,
  notifyChanged: jest.fn(),
};

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
  // Stable identities: the page keeps these in state.
  const categories = [
    { id: 'c1', fixedCategoryKey: 1, name: 'Breakfast', color: '#FF0F6CBD', icon: '🥐', defaultTime: '07:30:00', displayOrder: 0 },
    { id: 'c2', fixedCategoryKey: 2, name: 'Morning snack', color: '#FF0F6CBD', icon: '🍎', defaultTime: '10:30:00', displayOrder: 1 },
    { id: 'c3', fixedCategoryKey: 3, name: 'Lunch', color: '#FF0F6CBD', icon: '🍲', defaultTime: '13:30:00', displayOrder: 2 },
    { id: 'c4', fixedCategoryKey: 4, name: 'Afternoon snack', color: '#FF0F6CBD', icon: '🍪', defaultTime: '16:30:00', displayOrder: 3 },
    { id: 'c5', fixedCategoryKey: 5, name: 'Dinner', color: '#FF0F6CBD', icon: '🍽️', defaultTime: '19:30:00', displayOrder: 4 },
  ];
  return {
    ensureCategories: async () => categories,
    applyTemplate: jest.fn(async () => undefined),
  };
});

jest.mock('../src/cloud/syncEngine', () => ({
  subscribeDataChange: () => () => undefined,
}));

jest.mock('../src/data/repositories', () => ({
  getTemplates: jest.fn(async () => []),
}));

import { applyTemplate } from '../src/services/mealTracking';
import { getTemplates } from '../src/data/repositories';

const applyMock = applyTemplate as jest.Mock;
const templatesMock = getTemplates as jest.Mock;

type Renderer = TestRenderer.ReactTestRenderer;

function content(
  key: MealCategoryKey,
  title: string,
  ingredients: string,
  plannedTime: string | null,
): MealTemplateContent {
  return { mealCategoryKey: key, title, ingredients, plannedTime };
}

/** A full-day template named after its day, the way the dashboard saves one. */
const DAY_TEMPLATE: MealTemplate = {
  id: 'tpl-day',
  localProfileId: 'profile-1',
  name: '2026-10-30',
  isFullDay: true,
  templateMealSlot: null,
  templateMeal: null,
  templateDay: [
    content(MealCategoryKey.Breakfast, 'Oatmeal', 'with berries', '07:30:00'),
    content(MealCategoryKey.MorningSnack, '', '', '10:30:00'),
    content(MealCategoryKey.Lunch, 'Soup', '', '13:30:00'),
    content(MealCategoryKey.AfternoonSnack, '', '', '17:00:00'),
    content(MealCategoryKey.Dinner, 'Pasta', '', '20:00:00'),
  ],
  recurrenceRules: null,
  createdAt: '2026-10-30T20:40:00.000Z',
  updatedAt: '2026-10-30T20:43:00.000Z',
  syncStatus: SyncStatus.Synced,
};

/** One single-meal template, so the count can read "1 meal". */
const MEAL_TEMPLATE: MealTemplate = {
  id: 'tpl-meal',
  localProfileId: 'profile-1',
  name: 'Lunch box',
  isFullDay: false,
  templateMealSlot: MealCategoryKey.Lunch,
  templateMeal: content(MealCategoryKey.Lunch, 'Pasta', '', '13:30:00'),
  templateDay: [],
  recurrenceRules: null,
  createdAt: '2026-10-29T12:00:00.000Z',
  updatedAt: '2026-10-29T12:05:00.000Z',
  syncStatus: SyncStatus.Synced,
};

async function renderScreen(templates: MealTemplate[] = [DAY_TEMPLATE]): Promise<Renderer> {
  templatesMock.mockResolvedValue(templates);
  let renderer: Renderer | undefined;
  await act(async () => {
    renderer = TestRenderer.create(<TemplatesScreen />);
  });
  if (renderer === undefined) {
    throw new Error('the templates page did not render');
  }
  return renderer;
}

function styleOf(node: { props: { style?: unknown } }): Record<string, unknown> {
  const style = node.props.style;
  const resolved =
    typeof style === 'function'
      ? (style as (state: { pressed: boolean }) => unknown)({ pressed: false })
      : style;
  return (StyleSheet.flatten(resolved as never) ?? {}) as Record<string, unknown>;
}

/**
 * Every text the page prints. A line built from several runs (the metadata's
 * "kind · count", or the "All 5 planned …" sentences elsewhere) contributes each
 * of its runs, so an assertion still reads the WORDS rather than one exact split.
 */
function texts(renderer: Renderer): string[] {
  return renderer.root
    .findAllByType(Text)
    .flatMap((node) => (Array.isArray(node.props.children) ? node.props.children : []))
    .concat(renderer.root.findAllByType(Text).map((node) => node.props.children))
    .filter((value): value is string => typeof value === 'string');
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

function accordion(renderer: Renderer): TestRenderer.ReactTestInstance {
  return button(renderer, t('Rn_TemplateMealPreview'));
}

/** The one "Apply to date" control (it must exist exactly once in both states). */
function applyButtons(renderer: Renderer): TestRenderer.ReactTestInstance[] {
  return renderer.root.findAll(
    (node) =>
      node.props?.accessibilityLabel === t('Template_Apply') &&
      typeof node.props.onPress === 'function',
  );
}

/** The medium date an endpoint field shows for `iso` ("2 November 2026"). */
function dateLabel(iso: string): string {
  return formatMediumDate(iso);
}

/** One endpoint of the range sheet, by its accessible name. */
function fieldValue(renderer: Renderer, label: string): string {
  const control = renderer.root
    .findAll(
      (node) =>
        node.props?.accessibilityLabel === label && typeof node.props?.onPress === 'function',
    )
    .pop();
  return String(control?.props?.accessibilityValue?.text ?? '');
}

/** One day of the expanded calendar, by its full-date accessible name. */
function dayCell(renderer: Renderer, iso: string): TestRenderer.ReactTestInstance {
  const long = formatLongDate(iso);
  const found = renderer.root
    .findAll(
      (node) =>
        typeof node.props?.onPress === 'function' &&
        typeof node.props?.accessibilityLabel === 'string' &&
        (node.props.accessibilityLabel === long ||
          (node.props.accessibilityLabel as string).startsWith(`${long},`)),
    )
    .pop();
  if (found === undefined) {
    throw new Error(`no calendar day for ${iso}`);
  }
  return found;
}

/**
 * A day of THIS month. The calendar opens on the current month, so both these
 * days are always on the grid that is already on screen - whatever today is.
 */
function thisMonthDay(day: number): string {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(
    day,
  ).padStart(2, '0')}`;
}

beforeEach(() => {
  applyMock.mockClear();
  mockApp.notifyChanged.mockClear();
  mockApp.isDark = false;
});


describe('the page head', () => {
  test('keeps the heading, adds the subtitle and ONE quiet notice', async () => {
    const renderer = await renderScreen();
    const printed = texts(renderer);
    expect(printed).toContain(t('Nav_Templates'));
    expect(printed).toContain(t('Rn_TemplateSubtitle'));
    expect(printed).toContain(t('Rn_TemplateInfo'));
    // The italic warning it replaced is gone from the page.
    expect(printed).not.toContain(t('Template_Notice'));
    expect(t('Rn_TemplateSubtitle')).toBe('Reuse a saved meal plan.');
    expect(t('Rn_TemplateInfo')).toBe('Meal details only — no status or photos');
  });
});

describe('the template card', () => {
  test('prints the real name, update time, kind and meal count', async () => {
    const renderer = await renderScreen();
    const printed = texts(renderer);
    // The stored name is a date, so it is shown in the long form; the update
    // caption then drops the date it would only repeat.
    expect(printed).toContain('30 October 2026');
    expect(printed).toContain(`${t('Rn_Updated')} 20:43`);
    expect(printed).toContain(t('Template_KindDay'));
    // Five stored meals, counted from the payload.
    expect(printed).toContain(tFmt('Rn_TemplateMealCount', 5));
    expect(tFmt('Rn_TemplateMealCount', 5)).toBe('5 meals');
    // The kind and the count share ONE metadata line (the separate kind badge and
    // the standalone preview-count column are gone) - and it is not duplicated.
    const kindLines = renderer.root
      .findAllByType(Text)
      .map((node) => node.props.children)
      .filter((children): children is unknown[] => Array.isArray(children))
      .map((children) => children.join(''))
      .filter((line) => line.includes(t('Template_KindDay')));
    expect(kindLines).toHaveLength(1);
    expect(kindLines[0]).toContain(tFmt('Rn_TemplateMealCount', 5));
  });

  test('counts a single-meal template as one meal', async () => {
    const renderer = await renderScreen([MEAL_TEMPLATE]);
    const printed = texts(renderer);
    expect(printed).toContain(t('Rn_TemplateMealCountOne'));
    expect(t('Rn_TemplateMealCountOne')).toBe('1 meal');
    expect(printed).toContain(t('Template_KindMeal'));
    // A free-text name is printed as it was saved.
    expect(printed).toContain('Lunch box');
  });

  test('keeps the accordion closed until it is tapped, then shows every row', async () => {
    const renderer = await renderScreen();
    // Collapsed: the label is there, the meals are not.
    expect(accordion(renderer).props.accessibilityState.expanded).toBe(false);
    expect(texts(renderer)).not.toContain('07:30');

    act(() => accordion(renderer).props.onPress());
    expect(accordion(renderer).props.accessibilityState.expanded).toBe(true);
    const open = texts(renderer);
    // All five stored times, in meal order, with their categories.
    for (const time of ['07:30', '10:30', '13:30', '17:00', '20:00']) {
      expect(open).toContain(time);
    }
    for (const category of ['Breakfast', 'Morning snack', 'Lunch', 'Afternoon snack', 'Dinner']) {
      expect(open.some((line) => line.includes(category))).toBe(true);
    }
    // A stored name leads, the category and the stored description follow it.
    expect(open).toContain('Oatmeal');
    expect(open).toContain('Breakfast · with berries');

    act(() => accordion(renderer).props.onPress());
    expect(accordion(renderer).props.accessibilityState.expanded).toBe(false);
    expect(texts(renderer)).not.toContain('07:30');
  });

  test('falls back to the category planned time when the template stores none', async () => {
    const noTimes: MealTemplate = {
      ...DAY_TEMPLATE,
      id: 'tpl-no-time',
      templateDay: [content(MealCategoryKey.Breakfast, 'Oatmeal', '', null)],
    };
    const renderer = await renderScreen([noTimes]);
    act(() => accordion(renderer).props.onPress());
    const printed = texts(renderer);
    // The category's planned time is what the diary will show for that slot.
    expect(printed).toContain('07:30');
    expect(printed).not.toContain(t('Rn_TemplateNoTime'));
  });

  test('puts Apply in a real 48/44 pt target around a 36 pt blue control', async () => {
    const renderer = await renderScreen();
    // The TARGET carries the platform touch height (44 in this iOS test window)
    // and keeps the design's 136 dp minimum width.
    const target = styleOf(applyButtons(renderer)[0]);
    expect(target.minHeight).toBeGreaterThanOrEqual(44);
    expect(target.minWidth).toBe(templatesCalendarTokens.applyMinWidth);
    // The VISIBLE control inside that target is a 36 dp OUTLINED accent control:
    // 8 dp corners, the page's pale accent wash — the same family the popup's
    // "Apply template" wears, and never a solid slab.
    const visible = applyButtons(renderer)[0]
      .findAllByType(View)
      .map((node) => styleOf(node))
      .find((style) => style.borderRadius === 8 && style.borderWidth === 1);
    expect(visible).toBeDefined();
    expect(visible?.minHeight).toBe(36);
    expect(visible?.borderColor).toBe(lightColors.accent);
    expect(visible?.backgroundColor).toBe(selectedAccentFill(lightColors));
    expect(applyButtons(renderer)).toHaveLength(1);

    // Expanding the contents must neither move nor duplicate the control.
    act(() => accordion(renderer).props.onPress());
    expect(styleOf(applyButtons(renderer)[0]).minHeight).toBeGreaterThanOrEqual(44);
    expect(applyButtons(renderer)).toHaveLength(1);
  });

  test('keeps preview and apply as two sibling targets in a non-clickable card', async () => {
    const renderer = await renderScreen();
    const preview = accordion(renderer);
    const apply = applyButtons(renderer)[0];
    // Neither target contains the other, so a press can only ever do its own job.
    expect(
      apply.findAll((node) => node.props?.accessibilityLabel === t('Rn_TemplateMealPreview')),
    ).toHaveLength(0);
    expect(
      preview.findAll((node) => node.props?.accessibilityLabel === t('Template_Apply')),
    ).toHaveLength(0);
    // One template, exactly two controls - no whole-card press, no third action.
    const controls = renderer.root.findAll(
      (node) =>
        typeof node.props?.onPress === 'function' &&
        typeof node.props?.accessibilityLabel === 'string',
    );
    expect(controls.map((node) => node.props.accessibilityLabel)).toEqual([
      t('Rn_TemplateMealPreview'),
      t('Template_Apply'),
    ]);
    // Previewing alone never opens the apply sheet.
    act(() => preview.props.onPress());
    expect(renderer.root.findAllByType(TextInput)).toHaveLength(0);
  });

  test('never shows a completion state or a photograph', async () => {
    const renderer = await renderScreen();
    act(() => accordion(renderer).props.onPress());
    const printed = texts(renderer);
    expect(printed).not.toContain(t('Status_Done'));
    expect(printed).not.toContain(t('Status_Missed'));
    expect(printed).not.toContain(t('Status_Pending'));
    // No photo COUNT and no camera glyph: the info strip is allowed to SAY that
    // templates carry no photographs, but nothing may claim one.
    expect(printed.some((line) => /^\d+ photos?$/.test(line))).toBe(false);
    expect(
      renderer.root.findAll((node) => node.props?.name === 'camera-outline'),
    ).toHaveLength(0);
  });
});

describe('applying', () => {
  test('opens the range sheet with today on BOTH ends', async () => {
    const renderer = await renderScreen();
    act(() => applyButtons(renderer)[0].props.onPress());

    // The sheet's headline and the real template summary are unchanged...
    expect(texts(renderer)).toContain(t('Rn_TemplateApplyTitle'));
    expect(texts(renderer)).toContain(
      `${formatMediumDate(DAY_TEMPLATE.name)} · ${tFmt('Rn_TemplateMealCount', 5)}`,
    );
    // ...and it asks for two days, both starting on today.
    const today = formatDate(new Date());
    expect(fieldValue(renderer, t('Rn_TemplateStartDate'))).toBe(dateLabel(today));
    expect(fieldValue(renderer, t('Rn_TemplateEndDate'))).toBe(dateLabel(today));
    // The calendar is the only input - there is no typed field left.
    expect(renderer.root.findAllByType(TextInput)).toHaveLength(0);
    expect(texts(renderer)).not.toContain('Type date');
  });

  test('a calendar choice only fills a draft; the answer writes every day once', async () => {
    const renderer = await renderScreen();
    act(() => applyButtons(renderer)[0].props.onPress());

    act(() => button(renderer, t('Rn_TemplateStartDate')).props.onPress());
    act(() => dayCell(renderer, thisMonthDay(10)).props.onPress());
    act(() => dayCell(renderer, thisMonthDay(12)).props.onPress());

    // Three inclusive days are drafted and NOTHING has been written yet.
    expect(fieldValue(renderer, t('Rn_TemplateEndDate'))).toBe(
      dateLabel(thisMonthDay(12)),
    );
    expect(applyMock).not.toHaveBeenCalled();
    expect(mockApp.notifyChanged).not.toHaveBeenCalled();

    await act(async () => {
      button(renderer, tFmt('Rn_TemplateApplyRangeMany', 3)).props.onPress();
    });

    // One day at a time, in order, with the captured account...
    expect(applyMock.mock.calls).toEqual([
      [DAY_TEMPLATE, thisMonthDay(10), null],
      [DAY_TEMPLATE, thisMonthDay(11), null],
      [DAY_TEMPLATE, thisMonthDay(12), null],
    ]);
    // ...and ONE refresh for the whole range.
    expect(mockApp.notifyChanged).toHaveBeenCalledTimes(1);
    expect(texts(renderer)).toContain(tFmt('Rn_TemplateRangeAppliedMany', 3));
  });

  test('a partial failure stops, reports it, refreshes ONCE and keeps the sheet', async () => {
    applyMock
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('the day could not be written'));
    const renderer = await renderScreen();
    act(() => applyButtons(renderer)[0].props.onPress());
    act(() => button(renderer, t('Rn_TemplateStartDate')).props.onPress());
    act(() => dayCell(renderer, thisMonthDay(10)).props.onPress());
    act(() => dayCell(renderer, thisMonthDay(12)).props.onPress());

    await act(async () => {
      button(renderer, tFmt('Rn_TemplateApplyRangeMany', 3)).props.onPress();
    });

    // Day 10 landed, day 11 threw, day 12 was never attempted and never retried.
    expect(applyMock.mock.calls).toEqual([
      [DAY_TEMPLATE, thisMonthDay(10), null],
      [DAY_TEMPLATE, thisMonthDay(11), null],
    ]);
    expect(mockApp.notifyChanged).toHaveBeenCalledTimes(1);
    // The sheet stays open with a truthful report: no target date, no meals.
    const printed = texts(renderer);
    expect(printed).toContain(tFmt('Rn_TemplateRangePartial', 1, 3));
    expect(printed).toContain(
      tFmt('Rn_TemplateRangePartialFailed', formatLongDate(thisMonthDay(11))),
    );
    expect(printed).toContain(tFmt('Rn_TemplateRangePartialUnattempted', 1));
    expect(printed.join(' ')).not.toContain('the day could not be written');
    expect(texts(renderer)).toContain(tFmt('Rn_TemplateRangeStopped', 1, 3));
    // Close is the only way out - no second Apply and no retry.
    act(() => button(renderer, t('Rn_TemplateRangeClose')).props.onPress());
    expect(applyMock).toHaveBeenCalledTimes(2);
  });

  test('cancelling the range sheet applies nothing', async () => {
    const renderer = await renderScreen();
    act(() => applyButtons(renderer)[0].props.onPress());
    act(() => button(renderer, t('Rn_TemplateStartDate')).props.onPress());
    act(() => button(renderer, t('Common_Cancel')).props.onPress());
    expect(renderer.root.findAllByType(TextInput)).toHaveLength(0);
    expect(applyMock).not.toHaveBeenCalled();
  });
});

