// The "Clear this meal?" question, as the compact centered card of the mockup.
//
// The defect these tests pin: it used to be a bottom SHEET whose single paragraph
// mixed what disappears with the warning ("… are deleted. This cannot be undone.")
// and whose answers were the bare words "No" / "Yes". The mockup draws a centered
// card: a red bin in a red-washed badge, the title, the meal it is about
// ("Lunch · 13:30"), the paragraph, one bold red line and two pills -
// Cancel / Clear meal.
//
// Covered here:
//  - the request the dashboard builds (card layout, destructive, badge, texts),
//  - the meal line: category · time, the category alone without a time, and the
//    category-key fallback before the categories load,
//  - the rendered surface: centered, the badge in the red wash, the red bold
//    warning, and two side-by-side pills whose answers call back.

import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { StyleSheet, Text, View } from 'react-native';

import { MealCategoryKey, MealStatus, SyncStatus } from '../src/domain/enums';
import { MealEntry } from '../src/domain/models';
import { clearMealRequest } from '../src/ui/clearMealPrompt';
import { ConfirmDialog } from '../src/ui/components/dialogs';
import { t } from '../src/ui/strings';
import { fonts, lightColors, tintAlpha } from '../src/ui/theme';

type Renderer = TestRenderer.ReactTestRenderer;

const ENTRY: MealEntry = {
  id: 'meal-lunch',
  localProfileId: 'profile',
  date: '2026-11-03',
  mealCategoryId: 'cat-lunch',
  mealCategoryKey: MealCategoryKey.Lunch,
  title: 'Soup',
  ingredients: 'Carrot',
  plannedTime: '13:30:00',
  status: MealStatus.Pending,
  completedAt: null,
  createdAt: '2026-11-03T09:00:00.000Z',
  updatedAt: '2026-11-03T09:00:00.000Z',
  revision: 1,
  syncStatus: SyncStatus.PendingUpload,
  cloudRevision: null,
  contentHash: null,
};

function build(entry: MealEntry = ENTRY, categoryName: string | null = 'Lunch', use12HourClock = false) {
  const onCancel = jest.fn();
  const onConfirm = jest.fn();
  const request = clearMealRequest({ entry, categoryName, use12HourClock, onCancel, onConfirm });
  return { request, onCancel, onConfirm };
}

/** A node's style, whether it is still a pressable function or already an array. */
function styleOf(node: { props: { style?: unknown } }): Record<string, unknown> {
  const style = node.props.style;
  const resolved =
    typeof style === 'function'
      ? (style as (state: { pressed: boolean }) => unknown)({ pressed: false })
      : style;
  return (StyleSheet.flatten(resolved as never) ?? {}) as Record<string, unknown>;
}

function textOf(renderer: Renderer, content: string): TestRenderer.ReactTestInstance {
  const found = renderer.root.findAllByType(Text).find((node) => node.props.children === content);
  if (found === undefined) {
    throw new Error(`no text "${content}"`);
  }
  return found;
}

function pressable(renderer: Renderer, label: string): TestRenderer.ReactTestInstance {
  const found = renderer.root
    .findAll(
      (node) => node.props?.accessibilityLabel === label && typeof node.props.onPress === 'function',
    )
    .pop();
  if (found === undefined) {
    throw new Error(`no button labelled "${label}"`);
  }
  return found;
}

function nodeWithTestID(renderer: Renderer, testID: string): TestRenderer.ReactTestInstance {
  const found = renderer.root.findAll((node) => node.props?.testID === testID)[0];
  if (found === undefined) {
    throw new Error(`no node with testID "${testID}"`);
  }
  return found;
}

function renderCard(entry: MealEntry = ENTRY, categoryName: string | null = 'Lunch') {
  const { request, onCancel, onConfirm } = build(entry, categoryName);
  let renderer: Renderer | undefined;
  act(() => {
    renderer = TestRenderer.create(<ConfirmDialog isDark={false} request={request} />);
  });
  if (renderer === undefined) {
    throw new Error('the card did not render');
  }
  return { renderer, onCancel, onConfirm };
}

describe('the clear-meal request', () => {
  test('asks the compact CARD, destructively, with the meal it is about', () => {
    const { request } = build();
    expect(request.layout).toBe('card');
    expect(request.destructive).toBe(true);
    expect(request.title).toBe(t('Meal_ClearTitle'));
    // "Lunch · 13:30": the question names the meal exactly as its card does.
    expect(request.message).toBe('Lunch · 13:30');
    // The paragraph says what disappears; the warning is its own bold line.
    expect(request.body).toBe(t('Rn_ClearMealBody'));
    expect(request.warning).toBe(t('Rn_ClearMealWarning'));
    // The badge wears the same bin as the Clear tool, not a generic trash, in a
    // wash of the red - this question removes records.
    expect(request.badge).toEqual({ feather: 'trash-2' });
    expect(request.badgeTone).toBe('danger');
    // "Cancel" reads as the way out; the decision keeps its own verb.
    expect(request.cancelText).toBe(t('Common_Cancel'));
    expect(request.confirmText).toBe(t('Meal_Clear'));
  });

  test('follows the 12-hour preference and drops an empty time', () => {
    expect(build(ENTRY, 'Lunch', true).request.message).toBe('Lunch · 1:30 PM');
    expect(build({ ...ENTRY, plannedTime: '' }).request.message).toBe('Lunch');
  });

  test('falls back to the category key before the categories have loaded', () => {
    expect(build(ENTRY, null).request.message).toBe('Lunch · 13:30');
  });
});

describe('the clear-meal card on screen', () => {
  test('is the centered card, not the bottom sheet', () => {
    const { renderer } = renderCard();
    // The card scrim centers its child; the bottom sheet pushes it to the edge.
    expect(styleOf(nodeWithTestID(renderer, 'confirm-dialog-scrim')).justifyContent).toBe('center');
    // The card is rounded on ALL corners, 24 pt, like every alert card.
    const card = styleOf(nodeWithTestID(renderer, 'confirm-dialog-card'));
    expect(card.borderRadius).toBe(24);
    expect(card.borderTopLeftRadius).toBeUndefined();
    // ...and its title is centered, unlike the sheet's left-aligned one.
    expect(styleOf(textOf(renderer, t('Meal_ClearTitle'))).textAlign).toBe('center');
  });

  test('draws the red bin badge, the paragraph and the red warning line', () => {
    const { renderer } = renderCard();
    const colors = lightColors;

    // Badge: the mockup's red wash with the same bin the Clear tool draws.
    const badge = renderer.root
      .findAllByType(View)
      .find((node) => styleOf(node).borderRadius === 16 && styleOf(node).width === 56);
    expect(badge).toBeDefined();
    expect(styleOf(badge!).backgroundColor).toBe(tintAlpha(colors.missed, '1F'));
    const bin = renderer.root.findAll(
      (node) => node.props?.accessibilityLabel === 'feather:trash-2',
    );
    expect(bin.length).toBeGreaterThan(0);
    for (const glyph of bin) {
      expect(glyph.props.color).toBe(colors.missed);
    }

    // The paragraph is the readable secondary ink, centered.
    const body = styleOf(textOf(renderer, t('Rn_ClearMealBody')));
    expect(body.textAlign).toBe('center');
    expect(body.color).toBe(colors.textSecondary);

    // The consequence line is bold and red - the one loud line of the card.
    const warning = styleOf(textOf(renderer, t('Rn_ClearMealWarning')));
    expect(warning.fontFamily).toBe(fonts.bold);
    expect(warning.color).toBe(colors.missed);
  });

  test('offers two side-by-side pills that answer the question', () => {
    const { renderer, onCancel, onConfirm } = renderCard();

    const cancel = styleOf(pressable(renderer, t('Common_Cancel')));
    const clear = styleOf(pressable(renderer, t('Meal_Clear')));
    // Both are pills of equal width on one row...
    expect(cancel.flex).toBe(1);
    expect(clear.flex).toBe(1);
    expect(cancel.borderRadius).toBe(14);
    expect(cancel.minHeight).toBe(48);
    // ...the way out in the quiet control fill, the decision in the red fill.
    expect(cancel.backgroundColor).toBe(lightColors.surfaceVariant);
    expect(clear.backgroundColor).toBe(lightColors.error);
    expect(styleOf(textOf(renderer, t('Meal_Clear'))).color).toBe(lightColors.onState);

    act(() => pressable(renderer, t('Common_Cancel')).props.onPress());
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();

    act(() => pressable(renderer, t('Meal_Clear')).props.onPress());
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  test('the scrim dismisses exactly like Cancel', () => {
    const { renderer, onCancel, onConfirm } = renderCard();
    act(() => nodeWithTestID(renderer, 'confirm-dialog-scrim').props.onPress());
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  test('a destructive card that deletes NOTHING keeps the quiet badge', () => {
    // The sign-out card is destructive for the session - its decision pill is red -
    // but it removes no record, so its badge must stay the neutral control wash.
    // Only a question that deletes data paints the badge red.
    let renderer: Renderer | undefined;
    act(() => {
      renderer = TestRenderer.create(
        <ConfirmDialog
          isDark={false}
          request={{
            layout: 'card',
            destructive: true,
            title: t('Account_SignOutTitle'),
            message: t('Rn_SignOutMessage'),
            confirmIcon: 'log-out-outline',
            cancelText: t('Common_Cancel'),
            confirmText: t('Rn_SignOutConfirm'),
            onCancel: () => undefined,
            onConfirm: () => undefined,
          }}
        />,
      );
    });
    if (renderer === undefined) {
      throw new Error('the card did not render');
    }
    const badge = renderer.root
      .findAllByType(View)
      .find((node) => styleOf(node).borderRadius === 16 && styleOf(node).width === 56);
    expect(badge).toBeDefined();
    expect(styleOf(badge!).backgroundColor).toBe(lightColors.surfaceVariant);
    const glyphs = renderer.root.findAll(
      (node) => node.props?.accessibilityLabel === 'icon:log-out-outline',
    );
    expect(glyphs.length).toBeGreaterThan(0);
    for (const glyph of glyphs) {
      expect(glyph.props.color).toBe(lightColors.textSecondary);
    }
    // The decision itself is still the red pill.
    expect(styleOf(pressable(renderer, t('Rn_SignOutConfirm'))).backgroundColor).toBe(
      lightColors.error,
    );
  });
});

