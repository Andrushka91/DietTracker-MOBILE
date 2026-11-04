// The Templates page as the r3 mockup draws it: the "Templates" heading with its
// subtitle, ONE quiet info strip, then a compact white card per template - glyph,
// real name over its update time, the kind badge, the REAL meal count, a
// full-width "Meal preview" accordion and ONE full-width "Apply to date" button
// that stays at the card's floor in both states.
//
// Pinned here: the wording, the count and every time/title come from the stored
// template, the accordion really toggles, the apply action still goes through the
// validated date prompt, and - the invariant of this page - a template can never
// show a completion state or a photograph.

import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { StyleSheet, Text, TextInput } from 'react-native';

import { MealCategoryKey, SyncStatus } from '../src/domain/enums';
import { MealTemplate, MealTemplateContent } from '../src/domain/models';
import { formatDate } from '../src/domain/analytics';
import { TemplatesScreen } from '../src/ui/screens/TemplatesScreen';
import { formatMediumDate, t, tFmt } from '../src/ui/strings';

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

/** Every text the page prints. */
function texts(renderer: Renderer): string[] {
  return renderer.root
    .findAllByType(Text)
    .map((node) => node.props.children)
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

beforeEach(() => {
  applyMock.mockClear();
  mockApp.isDark = false;
});


describe('the page head', () => {
  test('keeps the heading, adds the subtitle and ONE quiet info strip', async () => {
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

  test('offers ONE full-width, 44 pt apply button in both states', async () => {
    const renderer = await renderScreen();
    const collapsed = styleOf(applyButtons(renderer)[0]);
    expect(collapsed.minHeight).toBeGreaterThanOrEqual(44);
    expect(collapsed.borderRadius).toBe(12);
    expect(applyButtons(renderer)).toHaveLength(1);

    act(() => accordion(renderer).props.onPress());
    expect(styleOf(applyButtons(renderer)[0]).minHeight).toBeGreaterThanOrEqual(44);
    expect(applyButtons(renderer)).toHaveLength(1);
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
  test('opens the same validated date prompt, today first', async () => {
    const renderer = await renderScreen();
    act(() => applyButtons(renderer)[0].props.onPress());
    const field = renderer.root.findByType(TextInput);
    expect(field.props.value).toBe(formatDate(new Date()));
    // The sheet's headline is the reference's "Apply template"...
    expect(texts(renderer)).toContain(t('Rn_TemplateApplyTitle'));
    // ...over the compact sheet's summary: the real template (a day-named one as
    // a long date, exactly like the card) and its real meal count.
    expect(texts(renderer)).toContain(
      `${formatMediumDate(DAY_TEMPLATE.name)} · ${tFmt('Rn_TemplateMealCount', 5)}`,
    );
    // ...and it labels the field it asks for, with the format under it.
    expect(texts(renderer)).toContain(t('Rn_TemplateDateLabel'));
    expect(texts(renderer)).toContain(t('Rn_TemplateDateFormatHint'));
  });

  test('writes the template into the typed date', async () => {
    const renderer = await renderScreen();
    act(() => applyButtons(renderer)[0].props.onPress());
    const field = renderer.root.findByType(TextInput);
    act(() => field.props.onChangeText('2026-12-01'));
    await act(async () => {
      button(renderer, t('Rn_TemplateApplyConfirm')).props.onPress();
    });
    expect(applyMock).toHaveBeenCalledWith(DAY_TEMPLATE, '2026-12-01', null);
  });

  test('refuses an impossible date and applies nothing', async () => {
    const renderer = await renderScreen();
    act(() => applyButtons(renderer)[0].props.onPress());
    const field = renderer.root.findByType(TextInput);
    act(() => field.props.onChangeText('2026-02-31'));
    await act(async () => {
      button(renderer, t('Rn_TemplateApplyConfirm')).props.onPress();
    });
    expect(applyMock).not.toHaveBeenCalled();
    expect(texts(renderer)).toContain(t('Rn_TemplateDateImpossible'));
  });
});
