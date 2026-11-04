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
}): Renderer {
  let renderer: Renderer | undefined;
  act(() => {
    renderer = TestRenderer.create(
      <SaveAllRow
        unsaved={props.unsaved}
        saving={props.saving === true}
        notice={props.notice ?? null}
        onSaveAll={props.onSaveAll ?? (() => undefined)}
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

/** The one pressable of the row: the Save all button's 44 pt target. */
function button(renderer: Renderer): TestRenderer.ReactTestInstance {
  const found = renderer.root.findAll((node) => typeof node.props?.onPress === 'function').pop();
  if (found === undefined) {
    throw new Error('the save button was not rendered');
  }
  return found;
}

/**
 * The VISIBLE control inside that target: the 36 pt neutral outline (card surface
 * inside a thin border) the row actually draws.
 */
function control(renderer: Renderer): TestRenderer.ReactTestInstance {
  const found = button(renderer)
    .findAll((node) => styleOf(node).minHeight === 36)
    .pop();
  if (found === undefined) {
    throw new Error('the visible save control was not rendered');
  }
  return found;
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

  test('counts the open editors and offers the neutral outlined button', () => {
    const onSaveAll = jest.fn();
    const one = render({ unsaved: 1, onSaveAll });
    expect(texts(one)).toContain(t('Rn_EditorOpenOne'));
    const save = button(one);
    expect(save.props.disabled).toBe(false);
    expect(save.props.accessibilityState).toEqual({ disabled: false, busy: false });
    // A real 44 pt target around a smaller NEUTRAL outline - never an indigo fill.
    expect(styleOf(save).minHeight).toBe(44);
    expect(styleOf(save).minWidth).toBe(96);
    const visible = styleOf(control(one));
    expect(visible.backgroundColor).toBe(lightColors.cardFill);
    expect(visible.borderColor).toBe(lightColors.border);
    expect(visible.borderRadius).toBe(8);
    act(() => save.props.onPress());
    expect(onSaveAll).toHaveBeenCalledTimes(1);

    // Two editors read as two, not as "1 editor open".
    expect(texts(render({ unsaved: 2 }))).toContain(tFmt('Rn_EditorsOpen', 2));
  });

  test('says "Saving…" and locks the button while the batch runs', () => {
    const renderer = render({ unsaved: 2, saving: true });
    expect(texts(renderer)).toContain(t('Rn_Saving'));
    const save = button(renderer);
    expect(save.props.disabled).toBe(true);
    expect(save.props.accessibilityState).toEqual({ disabled: true, busy: true });
    // Truthful busy state: the whole control is subdued, not repainted indigo.
    expect(styleOf(save).opacity).toBe(0.5);
    expect(styleOf(control(renderer)).backgroundColor).toBe(lightColors.cardFill);
  });

  test('names a partial batch result and keeps the rest saveable', () => {
    const notice = tFmt('Rn_SaveAllPartialRow', 2, 3);
    const renderer = render({ unsaved: 1, notice });
    expect(texts(renderer)).toContain(notice);
    // The editor that failed is still open, so Save all stays live.
    expect(button(renderer).props.disabled).toBe(false);
    // The row never claims a cloud upload happened.
    for (const line of texts(renderer)) {
      expect(line.toLowerCase()).not.toContain('sync');
      expect(line.toLowerCase()).not.toContain('cloud');
    }
  });

  test('works in the dark theme too', () => {
    const renderer = render({ unsaved: 1, colors: darkColors, isDark: true });
    expect(texts(renderer)).toContain(t('Rn_EditorOpenOne'));
    // The same neutral control: the dark card's surface inside the dark border.
    const visible = styleOf(control(renderer));
    expect(visible.backgroundColor).toBe(darkColors.cardFill);
    expect(visible.borderColor).toBe(darkColors.border);
  });
});
