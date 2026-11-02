// Regression tests for the two dialogs that used to hide a defect:
//
//  * the photo-source question had only two buttons, and its "cancel" side meant
//    Gallery - so the backdrop and Android Back both launched the system picker.
//  * the template date prompt closed on confirm and had nowhere to show an
//    error, so an invalid date fell back to today and applied the template to
//    the wrong day.

import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { Modal, TextInput } from 'react-native';

import { ChoiceDialog, PromptDialog } from '../src/ui/components/dialogs';

type Renderer = TestRenderer.ReactTestRenderer;

function render(element: React.ReactElement): Renderer {
  let renderer: Renderer | undefined;
  act(() => {
    renderer = TestRenderer.create(element);
  });
  if (renderer === undefined) {
    throw new Error('the dialog did not render');
  }
  return renderer;
}

/** The element carrying an accessibility label that can actually be pressed. */
function pressable(renderer: Renderer, label: string) {
  const found = renderer.root
    .findAll(
      (node) =>
        node.props?.accessibilityLabel === label && typeof node.props.onPress === 'function',
    )
    .pop();
  if (found === undefined) {
    throw new Error(`no pressable labelled "${label}"`);
  }
  return found;
}

function scrim(renderer: Renderer, testID: string) {
  const found = renderer.root
    .findAll((node) => node.props?.testID === testID && typeof node.props.onPress === 'function')
    .pop();
  if (found === undefined) {
    throw new Error(`no scrim ${testID}`);
  }
  return found;
}

describe('the photograph source question', () => {
  function renderChooser() {
    const onCancel = jest.fn();
    const camera = jest.fn();
    const gallery = jest.fn();
    const renderer = render(
      <ChoiceDialog
        isDark={false}
        request={{
          title: 'Add a photograph',
          message: 'Take a new picture now, or pick one that is already on the phone.',
          cancelText: 'Cancel',
          choices: [
            { label: 'Camera', onPress: camera },
            { label: 'Gallery', onPress: gallery },
          ],
          onCancel,
        }}
      />,
    );
    return { renderer, onCancel, camera, gallery };
  }

  test('offers Camera, Gallery and a real Cancel', () => {
    const { renderer } = renderChooser();
    // All three answers exist as explicit buttons; none of them is a fallback.
    expect(() => pressable(renderer, 'Camera')).not.toThrow();
    expect(() => pressable(renderer, 'Gallery')).not.toThrow();
    expect(() => pressable(renderer, 'Cancel')).not.toThrow();
  });

  test('backdrop, Cancel and Android Back only dismiss - no picker starts', () => {
    const { renderer, onCancel, camera, gallery } = renderChooser();

    act(() => scrim(renderer, 'choice-dialog-scrim').props.onPress());
    act(() => pressable(renderer, 'Cancel').props.onPress());
    act(() => renderer.root.findByType(Modal).props.onRequestClose());

    expect(onCancel).toHaveBeenCalledTimes(3);
    expect(camera).not.toHaveBeenCalled();
    expect(gallery).not.toHaveBeenCalled();
  });

  test('a tap on the card itself is not a backdrop tap', () => {
    const { renderer, onCancel } = renderChooser();
    const card = renderer.root
      .findAll((node) => node.props?.testID === 'choice-dialog-card')
      .pop();
    // The card claims the touch, so it never reaches the dismissing scrim.
    expect(card?.props.onStartShouldSetResponder?.()).toBe(true);
    expect(onCancel).not.toHaveBeenCalled();
  });

  test('only a deliberate source choice starts one picker', () => {
    const { renderer, camera, gallery } = renderChooser();
    act(() => pressable(renderer, 'Camera').props.onPress());
    expect(camera).toHaveBeenCalledTimes(1);
    expect(gallery).not.toHaveBeenCalled();
  });
});

describe('the template target-date prompt', () => {
  function renderPrompt(validate: (value: string) => string | null) {
    const onCancel = jest.fn();
    const onConfirm = jest.fn();
    const renderer = render(
      <PromptDialog
        isDark={false}
        request={{
          title: 'Apply the template',
          message: 'Enter the target date (yyyy-MM-dd)',
          initialValue: '2026-11-02',
          cancelText: 'Cancel',
          confirmText: 'Apply template',
          today: { label: 'Today', value: '2026-11-02' },
          validate,
          onCancel,
          onConfirm,
        }}
      />,
    );
    return { renderer, onCancel, onConfirm };
  }

  const rejectBlank = (value: string): string | null =>
    value.trim() === '' ? 'Enter a date first.' : null;

  test('an invalid value keeps the form open and applies nothing', () => {
    const { renderer, onCancel, onConfirm } = renderPrompt(rejectBlank);
    act(() => renderer.root.findByType(TextInput).props.onChangeText(''));

    act(() => pressable(renderer, 'Apply template').props.onPress());

    expect(onConfirm).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
    // The field stays on the form and the reason is stated next to it.
    expect(renderer.root.findAllByType(TextInput)).toHaveLength(1);
    expect(
      renderer.root.findAll((node) => node.props?.testID === 'prompt-dialog-error').length,
    ).toBeGreaterThan(0);
  });

  test('Today only fills the field; the user still applies it', () => {
    const { renderer, onConfirm } = renderPrompt(rejectBlank);
    act(() => pressable(renderer, 'Today').props.onPress());
    expect(onConfirm).not.toHaveBeenCalled();

    act(() => pressable(renderer, 'Apply template').props.onPress());
    expect(onConfirm).toHaveBeenCalledWith('2026-11-02');
  });

  test('Cancel dismisses without applying', () => {
    const { renderer, onCancel, onConfirm } = renderPrompt(rejectBlank);
    act(() => pressable(renderer, 'Cancel').props.onPress());
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
