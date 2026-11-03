// The fit guard of the meal editor's fields.
//
// The limit is not a character count: the field lays the CURRENT text out in an
// invisible copy of itself (same width, same typography) and reads the real line
// count. A change that needs one row too many is rolled back, so the box can
// never overflow - and a deletion is never rolled back, so a value saved by an
// older, wider editor can be edited down but never grows past the box.

import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { StyleSheet } from 'react-native';

import { MeasuredInput, shouldRejectOverflow } from '../src/ui/components/MeasuredInput';

type Renderer = TestRenderer.ReactTestRenderer;

function element(value: string, onChangeText: (next: string) => void, rows = 2) {
  return (
    <MeasuredInput
      accessibilityLabel="field"
      value={value}
      onChangeText={onChangeText}
      rows={rows}
      paddingHorizontal={10}
      textStyle={{ fontSize: 14, lineHeight: 18 }}
      inputStyle={{ paddingHorizontal: 10 }}
    />
  );
}

function renderInput(value: string, onChangeText: (next: string) => void, rows = 2): Renderer {
  let renderer: Renderer | undefined;
  act(() => {
    renderer = TestRenderer.create(element(value, onChangeText, rows));
  });
  return renderer!;
}

/** The visible input (it owns the change handler and the layout callback). */
function input(renderer: Renderer) {
  const found = renderer.root
    .findAll(
      (node) =>
        node.props?.accessibilityLabel === 'field' &&
        typeof node.props.onChangeText === 'function' &&
        typeof node.props.onLayout === 'function',
    )
    .pop();
  if (found === undefined) {
    throw new Error('no input');
  }
  return found;
}

/** The invisible copy that reports the real line count. */
function ruler(renderer: Renderer) {
  const found = renderer.root
    .findAll((node) => typeof node.props?.onTextLayout === 'function')
    .pop();
  if (found === undefined) {
    throw new Error('no ruler');
  }
  return found;
}

function lines(count: number) {
  return { nativeEvent: { lines: Array.from({ length: count }, () => ({})) } };
}

describe('the fit rule', () => {
  test('only growth past the allowed rows is refused', () => {
    expect(shouldRejectOverflow(3, 2, 10, 11)).toBe(true);
    expect(shouldRejectOverflow(2, 2, 10, 11)).toBe(false);
    // A deletion is always accepted, even while the text is still too long.
    expect(shouldRejectOverflow(3, 2, 11, 10)).toBe(false);
    expect(shouldRejectOverflow(3, 2, 10, 10)).toBe(false);
  });
});

describe('the measured field', () => {
  test('lays the text out at the field width minus its padding', async () => {
    const renderer = renderInput('hello', jest.fn());
    // Nothing is measured before the input has a width.
    expect(renderer.root.findAll((node) => typeof node.props?.onTextLayout === 'function')).toHaveLength(
      0,
    );

    await act(async () => {
      input(renderer).props.onLayout({ nativeEvent: { layout: { width: 310 } } });
    });

    const measure = ruler(renderer);
    expect(measure.props.children).toBe('hello');
    // 310 pt field - 2 × 10 pt padding = 290 pt of text.
    expect((StyleSheet.flatten(measure.props.style) ?? {}).width).toBe(290);
  });

  test('rolls back the change that needs one row too many', async () => {
    const onChange = jest.fn();
    const renderer = renderInput('two rows', onChange);
    await act(async () => {
      input(renderer).props.onLayout({ nativeEvent: { layout: { width: 310 } } });
    });

    // The user types one more character and the parent applies it...
    await act(async () => {
      input(renderer).props.onChangeText('two rows!');
    });
    await act(async () => {
      renderer.update(element('two rows!', onChange));
    });
    expect(onChange).toHaveBeenLastCalledWith('two rows!');

    // ...but the real layout needs a third row, so the field keeps the old value.
    await act(async () => {
      ruler(renderer).props.onTextLayout(lines(3));
    });
    expect(onChange).toHaveBeenLastCalledWith('two rows');
  });

  test('leaves a value that fits alone', async () => {
    const onChange = jest.fn();
    const renderer = renderInput('two rows', onChange);
    await act(async () => {
      input(renderer).props.onLayout({ nativeEvent: { layout: { width: 310 } } });
    });
    await act(async () => {
      ruler(renderer).props.onTextLayout(lines(2));
    });
    expect(onChange).not.toHaveBeenCalled();
  });

  test('never rolls back a deletion, even while the text is still too long', async () => {
    const onChange = jest.fn();
    const long = 'a'.repeat(200);
    const renderer = renderInput(long, onChange);
    await act(async () => {
      input(renderer).props.onLayout({ nativeEvent: { layout: { width: 310 } } });
    });

    await act(async () => {
      input(renderer).props.onChangeText('a'.repeat(199));
    });
    await act(async () => {
      renderer.update(element('a'.repeat(199), onChange));
    });
    await act(async () => {
      ruler(renderer).props.onTextLayout(lines(4));
    });
    // The stored value can be shortened; it is never cut by the guard itself.
    expect(onChange).toHaveBeenLastCalledWith('a'.repeat(199));
  });
});
