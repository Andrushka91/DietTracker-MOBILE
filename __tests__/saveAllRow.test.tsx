// The day header's SAVE ROW, which only exists while an editor is open:
//
//     ✎ 1 editor open                          [ 🖫 Save all ]
//
// Pinned here: with no editor open the row (and its hairline) is not rendered AT
// ALL, one/many open editors are counted in words, the button is the only
// pressable and only live when there is something to save, "Saving…" locks it, a
// partial batch result is named while the remaining editors stay open, and the
// wording never claims the CLOUD has the records - a save writes to this device
// and queues the upload.

import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { StyleSheet, Text } from 'react-native';

import { SaveAllRow } from '../src/ui/components/SaveAllRow';
import { t, tFmt } from '../src/ui/strings';
import { darkColors, lightColors, type ThemeColors } from '../src/ui/theme';

type Renderer = TestRenderer.ReactTestRenderer;

function render(props: {
  unsaved: number;
  saving?: boolean;
  notice?: string | null;
  colors?: ThemeColors;
  isDark?: boolean;
  onSaveAll?: () => void;
  onCancelAll?: () => void;
}): Renderer {
  let renderer: Renderer | undefined;
  act(() => {
    renderer = TestRenderer.create(
      <SaveAllRow
        unsaved={props.unsaved}
        saving={props.saving === true}
        notice={props.notice ?? null}
        onSaveAll={props.onSaveAll ?? (() => undefined)}
        onCancelAll={props.onCancelAll ?? (() => undefined)}
        colors={props.colors ?? lightColors}
        isDark={props.isDark ?? false}
      />,
    );
  });
  if (renderer === undefined) {
    throw new Error('the save row did not render');
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

/** The pressable elements of the row: Cancel all and Save all targets. */
function buttons(renderer: Renderer): TestRenderer.ReactTestInstance[] {
  return renderer.root.findAll((node) => {
    const props = node.props;
    return typeof props?.onPress === 'function' && typeof props?.accessibilityLabel === 'string';
  });
}

/**
 * The VISIBLE control inside a target: the 30 dp accent/outlined face the row draws.
 * Walks descendants like the MealCard editor tests because react-test-renderer's
 * children array mixes element and string nodes.
 */
function controlOf(renderer: Renderer, kind: 'save' | 'cancel'): TestRenderer.ReactTestInstance {
  const found = buttons(renderer).find((node) => {
    const label = node.props.accessibilityLabel as string | undefined;
    return label === (kind === 'save' ? t('Dashboard_SaveAll') : t('Rn_CancelAll'));
  });
  if (found === undefined) {
    throw new Error(`no visible ${kind} control was rendered`);
  }
  const child = found.findAll((n) => styleOf(n).borderRadius === 8).pop();
  if (child === undefined) {
    throw new Error(`no inner view for ${kind} control`);
  }
  return child;
}

function texts(renderer: Renderer): string[] {
  return renderer.root
    .findAllByType(Text)
    .map((node) => node.props.children)
    .filter((value): value is string => typeof value === 'string');
}

describe('the save row', () => {
  test('does not exist while every editor is closed', () => {
    // The reference's idle dashboard has NO save row: nothing to explain, no
    // "saved" claim to read, and no hairline taking up the card's height.
    expect(render({ unsaved: 0 }).toJSON()).toBeNull();
  });

  test('counts the open editors and offers Cancel all + Save all faces', () => {
    const onSaveAll = jest.fn();
    const onCancelAll = jest.fn();
    const one = render({ unsaved: 1, onSaveAll, onCancelAll });
    expect(texts(one)).toContain(t('Rn_EditorOpenOne'));
    const btns = buttons(one);
    // Both controls exist and are enabled.
    expect(btns.length).toBe(2);
    const saveBtn = btns.find((b) => b.props.accessibilityLabel === t('Dashboard_SaveAll'));
    const cancelBtn = btns.find((b) => b.props.accessibilityLabel === t('Rn_CancelAll'));
    expect(saveBtn!.props.disabled).toBe(false);
    expect(cancelBtn!.props.disabled).toBe(false);
    // Real 48/44 dp target around a smaller face; visible face uses accent wash.
    const saveControl = controlOf(one, 'save');
    const cancelControl = controlOf(one, 'cancel');
    const saveVisible = styleOf(saveControl);
    const cancelVisible = styleOf(cancelControl);
    // Save all wears the accent family (not neutral card fill).
    expect(saveVisible.backgroundColor).not.toBe(lightColors.cardFill);
    expect(saveVisible.borderRadius).toBe(8);
    // Cancel uses the red cancel family.
    expect(cancelVisible.backgroundColor).not.toBe(lightColors.cardFill);
    act(() => saveBtn!.props.onPress());
    expect(onSaveAll).toHaveBeenCalledTimes(1);
    act(() => cancelBtn!.props.onPress());
    expect(onCancelAll).toHaveBeenCalledTimes(1);

    // Two editors read as two, not as "1 editor open".
    expect(texts(render({ unsaved: 2 }))).toContain(tFmt('Rn_EditorsOpen', 2));
  });

  test('says "Saving…" and locks both buttons while the batch runs', () => {
    const renderer = render({ unsaved: 2, saving: true });
    expect(texts(renderer)).toContain(t('Rn_Saving'));
    const btns = buttons(renderer);
    // Both controls are disabled; the whole control is subdued (opacity 0.5).
    for (const btn of btns) {
      const label = btn.props.accessibilityLabel as string | undefined;
      if (label === t('Dashboard_SaveAll') || label === t('Rn_CancelAll')) {
        expect(btn.props.disabled).toBe(true);
      }
    }
  });

  test('names a partial batch result and keeps the rest saveable', () => {
    const notice = tFmt('Rn_SaveAllPartialRow', 2, 3);
    const renderer = render({ unsaved: 1, notice });
    expect(texts(renderer)).toContain(notice);
    // The editor that failed is still open, so Save all stays live.
    const btns = buttons(renderer);
    for (const btn of btns) {
      expect(btn.props.disabled).toBe(false);
    }
    // The row never claims a cloud upload happened.
    for (const line of texts(renderer)) {
      expect(line.toLowerCase()).not.toContain('sync');
      expect(line.toLowerCase()).not.toContain('cloud');
    }
  });

  test('works in the dark theme too', () => {
    const renderer = render({ unsaved: 1, colors: darkColors, isDark: true });
    expect(texts(renderer)).toContain(t('Rn_EditorOpenOne'));
    // Both controls use their proper color families, not neutral card fill.
    const saveVisible = styleOf(controlOf(renderer, 'save'));
    const cancelVisible = styleOf(controlOf(renderer, 'cancel'));
    expect(saveVisible.backgroundColor).not.toBe(darkColors.cardFill);
    expect(cancelVisible.backgroundColor).not.toBe(darkColors.cardFill);
  });
});
