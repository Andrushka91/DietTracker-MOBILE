// Regression tests for the two dialogs that used to hide a defect:
//
//  * the photo-source question had only two buttons, and its "cancel" side meant
//    Gallery - so the backdrop and Android Back both launched the system picker.
//  * the template date prompt closed on confirm and had nowhere to show an
//    error, so an invalid date fell back to today and applied the template to
//    the wrong day.

import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { ActivityIndicator, Modal, StyleSheet, Text, TextInput, View } from 'react-native';

import { ChoiceDialog, ConfirmDialog, LoadingSheet, PromptDialog } from '../src/ui/components/dialogs';
import { dateDraft, dateInputProblem, DATE_INPUT_LENGTH } from '../src/ui/dates';
import {
  type TemplateDateRange,
  type TemplateRangeResult,
} from '../src/services/applyTemplateRange';
import { formatLongDate, formatMonthLabel, t, tFmt } from '../src/ui/strings';
import { fonts, lightColors, typeScale } from '../src/ui/theme';

/**
 * The compact Apply-template sheet stacks its two answers at full width below
 * 350 dp or above a 1.15 font scale. RN's jest window reports fontScale 2, so
 * the width-dependent cases set it explicitly here.
 */
const mockWindow = { width: 390, height: 844, scale: 3, fontScale: 1 };
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => mockWindow,
}));

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

  test('masks away every character that is not a number', () => {
    const onCancel = jest.fn();
    const onConfirm = jest.fn();
    const validate = jest.fn((value: string) =>
      value.trim() === '' ? 'Enter a date first.' : null,
    );
    const renderer = render(
      <PromptDialog
        isDark={false}
        request={{
          title: 'Apply the template',
          message: 'Enter the target date (yyyy-MM-dd)',
          initialValue: '',
          cancelText: 'Cancel',
          confirmText: 'Apply template',
          // Exactly what TemplatesScreen asks for.
          keyboardType: 'number-pad',
          sanitize: dateDraft,
          maxLength: DATE_INPUT_LENGTH,
          validate,
          onCancel,
          onConfirm,
        }}
      />,
    );

    const field = (): TestRenderer.ReactTestInstance => renderer.root.findByType(TextInput);
    const type = (next: string): void => {
      act(() => field().props.onChangeText(next));
    };

    // The keyboard itself offers nothing but digits, and the field stops at a date.
    expect(field().props.keyboardType).toBe('number-pad');
    expect(field().props.maxLength).toBe(DATE_INPUT_LENGTH);

    // A paste is masked character by character: digits survive, the dashes are
    // put back where they belong, and the junk between them is gone.
    type('2a0 2/6-.1x1_-0y2');
    expect(field().props.value).toBe('2026-11-02');

    // Letters alone leave the field EMPTY - the validator never sees them, so a
    // date can no longer be "typed wrong", and nothing invalid is applied.
    type('tomorrow');
    expect(field().props.value).toBe('');
    act(() => pressable(renderer, 'Apply template').props.onPress());
    expect(validate).toHaveBeenLastCalledWith('');
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
  });
});
describe('the shared dialog surface', () => {
  /** A flattened style from a node whose `style` may still be a function. */
  function styleOf(node: TestRenderer.ReactTestInstance): Record<string, unknown> {
    const style = node.props.style;
    const resolved = typeof style === 'function' ? style({ pressed: false }) : style;
    return (StyleSheet.flatten(resolved) ?? {}) as Record<string, unknown>;
  }

  function nodeWithTestID(renderer: Renderer, testID: string) {
    const found = renderer.root.findAll((node) => node.props?.testID === testID).pop();
    if (found === undefined) {
      throw new Error(`no node with testID ${testID}`);
    }
    return found;
  }

  function renderConfirm(destructive: boolean) {
    const onCancel = jest.fn();
    const onConfirm = jest.fn();
    const renderer = render(
      <ConfirmDialog
        isDark={false}
        request={{
          title: 'Remove the photograph?',
          message: 'The photograph is deleted from this device.',
          confirmText: 'Delete photo',
          destructive,
          onCancel,
          onConfirm,
        }}
      />,
    );
    return { renderer, onCancel, onConfirm };
  }

  test('rises from the bottom edge, not the middle of the screen', () => {
    const { renderer } = renderConfirm(true);
    // The scrim stacks its child at the bottom...
    expect(styleOf(nodeWithTestID(renderer, 'confirm-dialog-scrim')).justifyContent).toBe('flex-end');
    // ...and the sheet is a bottom sheet: only its TOP corners are rounded.
    const sheet = styleOf(nodeWithTestID(renderer, 'confirm-dialog-card'));
    expect(sheet.borderTopLeftRadius).toBe(20);
    expect(sheet.borderTopRightRadius).toBe(20);
    expect(sheet.borderBottomLeftRadius).toBeUndefined();
  });

  test('carries a bold title, a close X and 52 pt answer rows', () => {
    const { renderer, onCancel, onConfirm } = renderConfirm(true);

    const title = renderer.root
      .findAllByType(Text)
      .find((node) => node.props.children === 'Remove the photograph?');
    expect(title).toBeDefined();
    const titleStyle = styleOf(title!);
    expect(titleStyle.fontFamily).toBe(fonts.bold);
    expect(titleStyle.fontSize).toBe(20);

    // The X is a real dismissal and every answer is a full-width row.
    act(() => pressable(renderer, t('Common_Close')).props.onPress());
    expect(onCancel).toHaveBeenCalledTimes(1);

    for (const label of ['No', 'Delete photo']) {
      const row = styleOf(pressable(renderer, label));
      expect(row.minHeight).toBe(52);
      expect(row.flexDirection).toBe('row');
    }
    act(() => pressable(renderer, 'Delete photo').props.onPress());
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  test('paints a destructive answer in the red ink, with the trash glyph', () => {
    const { renderer } = renderConfirm(true);
    // The destructive row is red; the neutral row keeps the ordinary ink.
    const destructiveLabel = renderer.root
      .findAllByType(Text)
      .find((node) => node.props.children === 'Delete photo');
    expect(styleOf(destructiveLabel!).color).toBe(lightColors.error);
    const glyphs = renderer.root
      .findAll(
        (node) =>
          typeof node.props?.accessibilityLabel === 'string' &&
          node.props.accessibilityLabel.startsWith('icon:'),
      )
      .map((node) => node.props.accessibilityLabel as string);
    expect(glyphs).toContain('icon:trash-outline');

    // A non-destructive confirm keeps the accent ink and the check.
    const neutral = renderConfirm(false);
    const neutralLabel = neutral.renderer.root
      .findAllByType(Text)
      .find((node) => node.props.children === 'Delete photo');
    expect(styleOf(neutralLabel!).color).toBe(lightColors.accent);
  });

  test('a request may name its own glyph instead of the bin', () => {
    // Signing out is destructive for the session but deletes nothing, so the
    // screen asks for the log-out glyph; the bin stays the default.
    const renderer = render(
      <ConfirmDialog
        isDark={false}
        request={{
          title: 'Sign out?',
          message: 'Your meals are saved to your Google account first.',
          confirmText: 'Yes',
          destructive: true,
          confirmIcon: 'log-out-outline',
          onCancel: jest.fn(),
          onConfirm: jest.fn(),
        }}
      />,
    );
    const glyphs = renderer.root
      .findAll(
        (node) =>
          typeof node.props?.accessibilityLabel === 'string' &&
          node.props.accessibilityLabel.startsWith('icon:'),
      )
      .map((node) => node.props.accessibilityLabel as string);
    expect(glyphs).toContain('icon:log-out-outline');
    expect(glyphs).not.toContain('icon:trash-outline');
  });

  test('a question may drop the glyph of a plain "No"', () => {
    // The sign-out question asks a plain Yes/No. A cross beside "No" read as
    // "close the dialog" rather than as the answer, so that row carries no glyph
    // while the answer that ends the session keeps the log-out one.
    const onCancel = jest.fn();
    const renderer = render(
      <ConfirmDialog
        isDark={false}
        request={{
          title: 'Sign out?',
          message: 'Your meals are saved to your Google account first.',
          cancelText: 'No',
          confirmText: 'Yes',
          destructive: true,
          confirmIcon: 'log-out-outline',
          cancelIcon: null,
          onCancel,
          onConfirm: jest.fn(),
        }}
      />,
    );
    const glyphsOf = (label: string): string[] =>
      pressable(renderer, label)
        .findAll(
          (node) =>
            typeof node.props?.accessibilityLabel === 'string' &&
            node.props.accessibilityLabel.startsWith('icon:'),
        )
        .map((node) => node.props.accessibilityLabel as string);
    // The quiet answer draws no glyph at all; the answer that ends the session
    // draws the log-out one. (The sheet's own close X lives in the header, not in
    // a row, so it is not part of this list.)
    expect(glyphsOf('No')).toEqual([]);
    // `findAll` sees the Text component and its host node, so the names are
    // deduplicated before the comparison.
    expect([...new Set(glyphsOf('Yes'))]).toEqual(['icon:log-out-outline']);

    // The quiet row is still a full 52 pt answer row and still answers.
    const row = styleOf(pressable(renderer, 'No'));
    expect(row.minHeight).toBe(52);
    act(() => pressable(renderer, 'No').props.onPress());
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  test('an ordinary question keeps the X on its quiet answer', () => {
    const { renderer } = renderConfirm(false);
    const glyphs = pressable(renderer, 'No')
      .findAll(
        (node) =>
          typeof node.props?.accessibilityLabel === 'string' &&
          node.props.accessibilityLabel.startsWith('icon:'),
      )
      .map((node) => node.props.accessibilityLabel as string);
    expect([...new Set(glyphs)]).toEqual(['icon:close']);
  });

  test('the choice and prompt dialogs use the same surface', () => {
    const chooser = render(
      <ChoiceDialog
        isDark={false}
        request={{
          title: 'Add a photograph',
          message: 'Take a new picture now, or pick one already on the phone.',
          cancelText: 'Cancel',
          choices: [{ label: 'Camera', onPress: () => undefined }],
          onCancel: () => undefined,
        }}
      />,
    );
    expect(styleOf(nodeWithTestID(chooser, 'choice-dialog-card')).borderTopLeftRadius).toBe(20);
    expect(styleOf(pressable(chooser, 'Camera')).minHeight).toBe(52);

    const prompt = render(
      <PromptDialog
        isDark={false}
        request={{
          title: 'Apply the template',
          message: 'Enter the target date (yyyy-MM-dd)',
          initialValue: '2026-11-02',
          cancelText: 'Cancel',
          confirmText: 'Apply template',
          validate: () => null,
          onCancel: () => undefined,
          onConfirm: () => undefined,
        }}
      />,
    );
    expect(styleOf(nodeWithTestID(prompt, 'prompt-dialog-card')).borderTopLeftRadius).toBe(20);
    expect(styleOf(pressable(prompt, 'Apply template')).minHeight).toBe(52);
  });
});

/**
 * The centered account card (`layout: 'card'`) is the surface of the two
 * questions about the whole account: the sign-out that uploads first, and the
 * "couldn't sync" card that replaces it when that upload is refused. Both are
 * the round-3 mockup: a raised card in the middle of the screen, a quiet badge
 * with the log-out glyph, centered copy, an optional tinted note and the two
 * answers side by side - and no close X, because the neutral answer and the
 * scrim are the only ways out.
 */
describe('the centered account card', () => {
  function styleOf(node: TestRenderer.ReactTestInstance): Record<string, unknown> {
    const style = node.props.style;
    const resolved = typeof style === 'function' ? style({ pressed: false }) : style;
    return (StyleSheet.flatten(resolved) ?? {}) as Record<string, unknown>;
  }

  function nodeWithTestID(renderer: Renderer, testID: string) {
    const found = renderer.root.findAll((node) => node.props?.testID === testID).pop();
    if (found === undefined) {
      throw new Error(`no node with testID ${testID}`);
    }
    return found;
  }

  function textOf(renderer: Renderer, value: string) {
    const found = renderer.root.findAllByType(Text).find((node) => node.props.children === value);
    if (found === undefined) {
      throw new Error(`no text "${value}"`);
    }
    return found;
  }

  function glyphsOf(renderer: Renderer): string[] {
    return [
      ...new Set(
        renderer.root
          .findAll(
            (node) =>
              typeof node.props?.accessibilityLabel === 'string' &&
              node.props.accessibilityLabel.startsWith('icon:'),
          )
          .map((node) => node.props.accessibilityLabel as string),
      ),
    ];
  }

  function renderSignOut(note?: { icon: 'cloud-offline-outline'; title: string; message: string }) {
    const onCancel = jest.fn();
    const onConfirm = jest.fn();
    const renderer = render(
      <ConfirmDialog
        isDark={false}
        request={{
          layout: 'card',
          title: 'Sign out?',
          message: "We'll sync your latest changes before signing you out.",
          cancelText: 'Cancel',
          confirmText: 'Sync & sign out',
          destructive: true,
          confirmIcon: 'log-out-outline',
          note,
          onCancel,
          onConfirm,
        }}
      />,
    );
    return { renderer, onCancel, onConfirm };
  }

  test('centers a raised card instead of rising from the bottom', () => {
    const { renderer } = renderSignOut();
    const scrimStyle = styleOf(nodeWithTestID(renderer, 'confirm-dialog-scrim'));
    expect(scrimStyle.justifyContent).toBe('center');
    expect(scrimStyle.alignItems).toBe('center');
    // All four corners round, unlike the bottom sheet's top-only corners.
    expect(styleOf(nodeWithTestID(renderer, 'confirm-dialog-card')).borderRadius).toBe(24);
    // The card still claims its own touches: only the scrim dismisses.
    const claim = renderer.root
      .findAll(
        (node) =>
          node.props?.testID === 'confirm-dialog-card' &&
          typeof node.props.onStartShouldSetResponder === 'function',
      )
      .pop();
    expect(claim?.props.onStartShouldSetResponder?.()).toBe(true);
  });

  test('carries the log-out badge, centered copy and two side-by-side answers', () => {
    const { renderer } = renderSignOut();

    // The decision's glyph sits in the badge above the title.
    expect(glyphsOf(renderer)).toEqual(['icon:log-out-outline']);
    expect(styleOf(textOf(renderer, 'Sign out?')).textAlign).toBe('center');
    expect(
      styleOf(textOf(renderer, "We'll sync your latest changes before signing you out.")).textAlign,
    ).toBe('center');

    // Both answers share one row, each filling half of it.
    const cancel = pressable(renderer, 'Cancel');
    const confirm = pressable(renderer, 'Sync & sign out');
    expect(styleOf(cancel).flex).toBe(1);
    expect(styleOf(confirm).flex).toBe(1);
    expect(styleOf(confirm).minHeight).toBe(48);
    // The neutral answer is quiet, the decision takes the red fill.
    expect(styleOf(cancel).backgroundColor).toBe(lightColors.surfaceVariant);
    expect(styleOf(confirm).backgroundColor).toBe(lightColors.error);
  });

  test('has no close X: the answers and dismissal are the only exits', () => {
    const { renderer, onCancel, onConfirm } = renderSignOut();

    expect(() => pressable(renderer, t('Common_Close'))).toThrow();
    act(() => scrim(renderer, 'confirm-dialog-scrim').props.onPress());
    // Android Back dismisses through the same action as the neutral answer.
    act(() => renderer.root.findByType(Modal).props.onRequestClose());
    act(() => pressable(renderer, 'Cancel').props.onPress());
    expect(onCancel).toHaveBeenCalledTimes(3);
    expect(onConfirm).not.toHaveBeenCalled();

    act(() => pressable(renderer, 'Sync & sign out').props.onPress());
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  test('the failure card names the failed sync in a tinted note and retries', () => {
    const onRetry = jest.fn();
    const renderer = render(
      <ConfirmDialog
        isDark={false}
        request={{
          layout: 'card',
          title: "Couldn't sync",
          message: "Your latest changes haven't synced yet.",
          note: {
            icon: 'cloud-offline-outline',
            title: 'Sync failed',
            message: "Check your connection and try again. You're still signed in.",
          },
          cancelText: 'Cancel',
          confirmText: 'Try again',
          destructive: true,
          confirmIcon: 'log-out-outline',
          onCancel: jest.fn(),
          onConfirm: onRetry,
        }}
      />,
    );

    // The note is a panel of its own, with the cloud-offline glyph...
    expect(glyphsOf(renderer)).toContain('icon:cloud-offline-outline');
    expect(styleOf(nodeWithTestID(renderer, 'confirm-dialog-note')).flexDirection).toBe('row');
    // ...its bold caption, its quiet line and the card's own copy.
    expect(styleOf(textOf(renderer, 'Sync failed')).fontFamily).toBe(fonts.bold);
    expect(
      textOf(renderer, "Check your connection and try again. You're still signed in."),
    ).toBeDefined();
    expect(textOf(renderer, "Couldn't sync")).toBeDefined();

    act(() => pressable(renderer, 'Try again').props.onPress());
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  test('a working card reports the upload in place of its answers', () => {
    const onCancel = jest.fn();
    const onConfirm = jest.fn();
    const renderer = render(
      <ConfirmDialog
        isDark={false}
        request={{
          layout: 'card',
          title: 'Syncing before sign-out',
          message: "You'll be signed out when syncing finishes.",
          cancelText: 'Cancel',
          confirmText: 'Sync & sign out',
          destructive: true,
          confirmIcon: 'log-out-outline',
          busy: {
            progress: 1 / 3,
            detail: '1 of 3 changes synced',
            hint: 'Please keep the app open.',
          },
          onCancel,
          onConfirm,
        }}
      />,
    );

    // The mockup's working card: it says what the wait is for, then the bar, the
    // counted line and the reassurance - the answers are gone.
    expect(textOf(renderer, 'Syncing before sign-out')).toBeDefined();
    expect(textOf(renderer, "You'll be signed out when syncing finishes.")).toBeDefined();
    expect(styleOf(textOf(renderer, '1 of 3 changes synced')).fontFamily).toBe(fonts.medium);
    expect(textOf(renderer, 'Please keep the app open.')).toBeDefined();
    // No spinner: the bar is the progress report.
    expect(renderer.root.findAllByType(ActivityIndicator)).toHaveLength(0);
    expect(() => pressable(renderer, 'Cancel')).toThrow();
    expect(() => pressable(renderer, 'Sync & sign out')).toThrow();

    // The bar is determinate: 1/3 = 33 % of its 10 pt track.
    const fills = renderer.root.findAll((node) => {
      const raw = node.props?.style;
      const resolved = typeof raw === 'function' ? raw({ pressed: false }) : raw;
      const style = (StyleSheet.flatten(resolved) ?? {}) as Record<string, unknown>;
      return style.width === '33%' && style.height === 10;
    });
    expect(fills.length).toBeGreaterThan(0);

    // A running sign-out cannot be dismissed: scrim and Android Back are inert.
    expect(() => scrim(renderer, 'confirm-dialog-scrim')).toThrow();
    act(() => renderer.root.findByType(Modal).props.onRequestClose());
    expect(onCancel).not.toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
  });
});



/**
 * The sign-in transfer sheet (the round-3 mockup): a headline naming the
 * transfer, the step underneath, a thick determinate bar, the counted line and
 * the "keep it open" reassurance - all left aligned, with no spinner, because the
 * bar itself is the progress report.
 */
describe('the account sync sheet', () => {
  function styleOf(node: TestRenderer.ReactTestInstance): Record<string, unknown> {
    const style = node.props.style;
    const resolved = typeof style === 'function' ? style({ pressed: false }) : style;
    return (StyleSheet.flatten(resolved) ?? {}) as Record<string, unknown>;
  }

  function textOf(renderer: Renderer, value: string) {
    const found = renderer.root.findAllByType(Text).find((node) => node.props.children === value);
    if (found === undefined) {
      throw new Error(`no text "${value}"`);
    }
    return found;
  }

  test('prints the headline, the step, a thick bar and the counted line', () => {
    const renderer = render(
      <LoadingSheet
        name="busy-dialog"
        isDark={false}
        message="Syncing your data"
        subtitle="Downloading your saved meals and photos"
        detail="66 of 73 items received"
        hint="Keep the app open until syncing finishes."
        progress={66 / 73}
      />,
    );

    // The headline is a page title; the step and the count sit under it.
    expect(styleOf(textOf(renderer, 'Syncing your data')).fontSize).toBe(typeScale.title);
    expect(styleOf(textOf(renderer, 'Downloading your saved meals and photos')).fontSize).toBe(
      typeScale.headline,
    );
    expect(styleOf(textOf(renderer, '66 of 73 items received')).fontSize).toBe(typeScale.headline);
    expect(styleOf(textOf(renderer, '66 of 73 items received')).fontFamily).toBe(fonts.medium);
    expect(textOf(renderer, 'Keep the app open until syncing finishes.')).toBeDefined();

    // No spinner: the 10 pt bar is the progress report (66/73 = 90 %).
    expect(renderer.root.findAllByType(ActivityIndicator)).toHaveLength(0);
    const fills = renderer.root.findAll((node) => {
      const raw = node.props?.style;
      const resolved = typeof raw === 'function' ? raw({ pressed: false }) : raw;
      const style = (StyleSheet.flatten(resolved) ?? {}) as Record<string, unknown>;
      return style.width === '90%' && style.height === 10;
    });
    expect(fills.length).toBeGreaterThan(0);
  });

  test('the other busy sheets keep their compact spinner row', () => {
    const renderer = render(
      <LoadingSheet
        name="busy-dialog"
        isDark={false}
        message="Synchronizing your data…"
        hint="This can take a few seconds."
      />,
    );
    expect(renderer.root.findAllByType(ActivityIndicator)).toHaveLength(1);
    expect(styleOf(textOf(renderer, 'Synchronizing your data…')).fontSize).toBe(15);
  });
});

/**
 * The compact Apply-template RANGE sheet (`layout: 'template-date'` plus a typed
 * `templateRange`) - used ONLY by Templates. It keeps the same sheet host, the
 * blue Apply and the outlined red Cancel; only the single typed date changed into
 * two INCLUSIVE calendar-only endpoints.
 *
 * Pinned here: both days start on the caller's today (so a one-day apply is still
 * two taps), choosing a day only fills a draft, the calendar is the ONLY input
 * (no typed fallback), a reversed End is an error rather than a silent swap,
 * nothing is written until the single final answer, a double tap cannot start a
 * second run, and a partial run is reported truthfully with one Close.
 */
describe('the Apply-template range sheet', () => {
  beforeEach(() => {
    mockWindow.width = 390;
    mockWindow.fontScale = 1;
  });

  function styleOf(node: TestRenderer.ReactTestInstance): Record<string, unknown> {
    const style = node.props.style;
    const resolved = typeof style === 'function' ? style({ pressed: false }) : style;
    return (StyleSheet.flatten(resolved) ?? {}) as Record<string, unknown>;
  }

  function texts(renderer: Renderer): string[] {
    return renderer.root
      .findAllByType(Text)
      .map((node) => node.props.children)
      .filter((value): value is string => typeof value === 'string');
  }

  const dateError = (value: string): string | null =>
    dateInputProblem(value) === null ? null : t('Rn_TemplateDateRequired');

  /** The visible 36 dp control INSIDE a labelled 48/44 dp target. */
  function visibleButton(renderer: Renderer, label: string) {
    const target = pressable(renderer, label);
    const visible = target
      .findAllByType(View)
      .map((node) => styleOf(node))
      .find((style) => style.borderRadius === 8 && style.borderWidth === 1);
    if (visible === undefined) {
      throw new Error(`no visible control inside "${label}"`);
    }
    return { target: styleOf(target), visible };
  }

  /** One day of the expanded calendar, by its full-date accessible name. */
  function dayIn(renderer: Renderer, iso: string) {
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

  const COMPLETE = (days: number, last: string): TemplateRangeResult => ({
    kind: 'complete',
    totalDays: days,
    completedDays: days,
    lastCompletedDate: last,
  });

  function renderSheet(
    options: {
      start?: string;
      end?: string;
      range?: (
        range: TemplateDateRange,
        onProgress: (done: number, total: number) => void,
      ) => Promise<TemplateRangeResult>;
    } = {},
  ) {
    const onCancel = jest.fn();
    const onConfirmRange = jest.fn(
      options.range ?? (async () => COMPLETE(1, options.start ?? '2026-11-02')),
    );
    const renderer = render(
      <PromptDialog
        isDark={false}
        request={{
          layout: 'template-date',
          title: t('Rn_TemplateApplyTitle'),
          message: t('Rn_TemplateDatePrompt'),
          contextLabel: 'Full day · 5 meals',
          initialValue: options.start ?? '2026-11-02',
          cancelText: t('Common_Cancel'),
          confirmText: t('Rn_TemplateApplyConfirm'),
          today: { label: t('Calendar_Today'), value: '2026-11-04' },
          validate: dateError,
          onCancel,
          onConfirm: jest.fn(),
          templateRange: {
            initialEndValue: options.end ?? options.start ?? '2026-11-02',
            onConfirmRange,
          },
        }}
      />,
    );
    return { renderer, onCancel, onConfirmRange };
  }

  test('asks for Start and End, states the inclusive count and names the days', () => {
    const { renderer } = renderSheet({ start: '2026-11-05', end: '2026-11-11' });
    const printed = texts(renderer);

    // The sheet's own chrome is unchanged: the real template above the title.
    expect(printed).toContain(t('Rn_TemplateApplyTitle'));
    expect(printed).toContain('Full day · 5 meals');
    // Two labelled endpoints, and the inclusive count in words.
    expect(printed).toContain(t('Rn_TemplateStartDate'));
    expect(printed).toContain(t('Rn_TemplateEndDate'));
    expect(printed).toContain('5 November 2026 – 11 November 2026 · 7 days');
    expect(printed).toContain(t('Rn_TemplateRangeSamePlan'));

    // The calendar is the ONLY input: no typed field and no Type date links.
    expect(renderer.root.findAllByType(TextInput)).toHaveLength(0);
    for (const banned of ['Type date', 'Type dates', 'Use calendar']) {
      expect(printed).not.toContain(banned);
      expect(
        renderer.root.findAll((node) => node.props?.accessibilityLabel === banned),
      ).toHaveLength(0);
    }

    // Each endpoint is a 36 dp control on a real 48/44 dp target.
    for (const label of [t('Rn_TemplateStartDate'), t('Rn_TemplateEndDate')]) {
      const field = visibleButton(renderer, label);
      expect(field.visible.minHeight).toBe(36);
      expect(field.target.minHeight).toBeGreaterThanOrEqual(44);
    }
    // The final answer names exactly how many days it will write.
    expect(pressable(renderer, tFmt('Rn_TemplateApplyRangeMany', 7))).toBeDefined();
  });

  test('choosing Start fills it, opens End and applies nothing', () => {
    const { renderer, onConfirmRange, onCancel } = renderSheet({
      start: '2026-11-02',
      end: '2026-11-06',
    });
    act(() => pressable(renderer, t('Rn_TemplateStartDate')).props.onPress());
    act(() => dayIn(renderer, '2026-11-05').props.onPress());

    // Start holds the chosen day...
    expect(pressable(renderer, t('Rn_TemplateStartDate')).props.accessibilityValue).toEqual({
      text: '5 November 2026',
    });
    // ...End is the active field now (its own month on screen)...
    expect(pressable(renderer, t('Rn_TemplateEndDate')).props.accessibilityState).toEqual({
      expanded: true,
      disabled: false,
    });
    expect(texts(renderer)).toContain(formatMonthLabel('2026-11'));
    // ...and nothing was written or dismissed.
    expect(onConfirmRange).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
  });

  test('both endpoints only fill drafts; the answer writes the range ONCE', async () => {
    const { renderer, onConfirmRange, onCancel } = renderSheet({
      start: '2026-11-02',
      end: '2026-11-02',
      range: async () => COMPLETE(4, '2026-11-08'),
    });
    act(() => pressable(renderer, t('Rn_TemplateStartDate')).props.onPress());
    act(() => dayIn(renderer, '2026-11-05').props.onPress());
    act(() => dayIn(renderer, '2026-11-08').props.onPress());

    // Both drafts are set and the calendar collapsed - still nothing written.
    expect(pressable(renderer, t('Rn_TemplateEndDate')).props.accessibilityValue).toEqual({
      text: '8 November 2026',
    });
    expect(
      renderer.root.findAll(
        (node) => node.props?.accessibilityLabel === t('Calendar_NextMonth'),
      ),
    ).toHaveLength(0);
    expect(onConfirmRange).not.toHaveBeenCalled();

    await act(async () => {
      pressable(renderer, tFmt('Rn_TemplateApplyRangeMany', 4)).props.onPress();
    });

    // ONE call, with both endpoints in order - and the sheet closed on success.
    expect(onConfirmRange).toHaveBeenCalledTimes(1);
    expect(onConfirmRange.mock.calls[0][0]).toEqual({
      startDate: '2026-11-05',
      endDate: '2026-11-08',
    });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  test('a reversed End is an error, never a silent swap', () => {
    const { renderer, onConfirmRange } = renderSheet({
      start: '2026-11-10',
      end: '2026-11-12',
    });
    act(() => pressable(renderer, t('Rn_TemplateEndDate')).props.onPress());
    act(() => dayIn(renderer, '2026-11-05').props.onPress());

    // The End keeps exactly what was chosen: no swap, no extension...
    expect(pressable(renderer, t('Rn_TemplateEndDate')).props.accessibilityValue).toEqual({
      text: '5 November 2026',
    });
    // ...the sheet says why, and End stays open to be corrected.
    expect(texts(renderer)).toContain(t('Rn_TemplateRangeOrder'));
    expect(pressable(renderer, t('Rn_TemplateEndDate')).props.accessibilityState).toEqual({
      expanded: true,
      disabled: false,
    });
    // Apply refuses as well: still zero writes.
    act(() => pressable(renderer, t('Rn_TemplateApplyConfirm')).props.onPress());
    expect(onConfirmRange).not.toHaveBeenCalled();
  });

  test('month navigation moves the grid only - even across a year', () => {
    const { renderer, onConfirmRange } = renderSheet({
      start: '2026-11-02',
      end: '2026-11-06',
    });
    act(() => pressable(renderer, t('Rn_TemplateStartDate')).props.onPress());
    act(() => pressable(renderer, t('Calendar_NextMonth')).props.onPress());
    expect(texts(renderer)).toContain(formatMonthLabel('2026-12'));
    act(() => pressable(renderer, t('Calendar_PreviousMonth')).props.onPress());
    expect(texts(renderer)).toContain(formatMonthLabel('2026-11'));

    // Twelve steps back lands in November 2025: a day there is still a real ISO
    // key, and no endpoint has moved on its own.
    for (let step = 0; step < 12; step += 1) {
      act(() => pressable(renderer, t('Calendar_PreviousMonth')).props.onPress());
    }
    expect(texts(renderer)).toContain(formatMonthLabel('2025-11'));
    expect(pressable(renderer, t('Rn_TemplateEndDate')).props.accessibilityValue).toEqual({
      text: '6 November 2026',
    });
    act(() => dayIn(renderer, '2025-11-20').props.onPress());
    expect(pressable(renderer, t('Rn_TemplateStartDate')).props.accessibilityValue).toEqual({
      text: '20 November 2025',
    });
    expect(onConfirmRange).not.toHaveBeenCalled();
  });

  test('the same Start and End is ONE day, not zero', () => {
    const { renderer } = renderSheet({ start: '2026-11-02', end: '2026-11-02' });
    expect(texts(renderer)).toContain('2 November 2026 – 2 November 2026 · 1 day');
    // One cell describes BOTH ends, so the range is never ambiguous to a reader.
    act(() => pressable(renderer, t('Rn_TemplateStartDate')).props.onPress());
    expect(dayIn(renderer, '2026-11-02').props.accessibilityLabel).toBe(
      `${formatLongDate('2026-11-02')}, ${t('Rn_TemplateRangeA11yStartEnd')}`,
    );
    // ...and the final answer says one day.
    expect(pressable(renderer, t('Rn_TemplateApplyRangeOne'))).toBeDefined();
  });

  test('locks every control while the days are written, and counts them', async () => {
    let settle: ((result: TemplateRangeResult) => void) | undefined;
    const pending = new Promise<TemplateRangeResult>((resolve) => {
      settle = resolve;
    });
    const { renderer, onCancel, onConfirmRange } = renderSheet({
      start: '2026-11-05',
      end: '2026-11-08',
      range: (_range, onProgress) => {
        onProgress(1, 4);
        return pending;
      },
    });

    await act(async () => {
      pressable(renderer, tFmt('Rn_TemplateApplyRangeMany', 4)).props.onPress();
    });
    // Progress counts DAYS (one of four), not meals.
    expect(texts(renderer)).toContain(tFmt('Rn_TemplateRangeProgress', 1, 4));
    // A second tap cannot start another range.
    await act(async () => {
      pressable(renderer, tFmt('Rn_TemplateApplyRangeMany', 4)).props.onPress();
    });
    expect(onConfirmRange).toHaveBeenCalledTimes(1);
    // Fields, answers and every dismissal are locked while the writes run.
    expect(pressable(renderer, t('Rn_TemplateStartDate')).props.disabled).toBe(true);
    expect(pressable(renderer, t('Common_Cancel')).props.disabled).toBe(true);
    act(() => pressable(renderer, t('Common_Close')).props.onPress());
    expect(onCancel).not.toHaveBeenCalled();

    await act(async () => {
      settle?.(COMPLETE(4, '2026-11-08'));
    });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  test('a partial run stops, reports it truthfully and offers only Close', async () => {
    const { renderer, onCancel, onConfirmRange } = renderSheet({
      start: '2026-11-05',
      end: '2026-11-09',
      range: async () => ({
        kind: 'partial',
        totalDays: 5,
        completedDays: 2,
        lastCompletedDate: '2026-11-06',
        failedDate: '2026-11-07',
        failedDayMayBePartial: true,
        unattemptedDays: 2,
        cause: new Error('disk on fire'),
      }),
    });

    await act(async () => {
      pressable(renderer, tFmt('Rn_TemplateApplyRangeMany', 5)).props.onPress();
    });
    const printed = texts(renderer);
    // What finished, what MAY be half-written, and what never ran.
    expect(printed).toContain(tFmt('Rn_TemplateRangePartial', 2, 5));
    expect(printed).toContain(
      tFmt('Rn_TemplateRangePartialFailed', formatLongDate('2026-11-07')),
    );
    expect(printed).toContain(tFmt('Rn_TemplateRangePartialUnattempted', 2));
    // No raw exception text, no rollback claim, no retry and no Cancel.
    expect(printed.join(' ')).not.toContain('disk on fire');
    expect(
      renderer.root.findAll(
        (node) => node.props?.accessibilityLabel === tFmt('Rn_TemplateApplyRangeMany', 5),
      ),
    ).toHaveLength(0);
    expect(
      renderer.root.findAll((node) => node.props?.accessibilityLabel === t('Common_Cancel')),
    ).toHaveLength(0);
    // Close is the ONE exit; it dismisses and writes nothing more.
    act(() => pressable(renderer, t('Rn_TemplateRangeClose')).props.onPress());
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirmRange).toHaveBeenCalledTimes(1);
  });

  test('Cancel and the close X dismiss without applying', () => {
    const { renderer, onCancel, onConfirmRange } = renderSheet();
    act(() => pressable(renderer, t('Common_Cancel')).props.onPress());
    act(() => pressable(renderer, t('Common_Close')).props.onPress());
    act(() => renderer.root.findByType(Modal).props.onRequestClose());
    expect(onCancel).toHaveBeenCalledTimes(3);
    expect(onConfirmRange).not.toHaveBeenCalled();
  });

  test('keeps the default prompt (template naming) on its own rows', () => {
    // The variant is opt-in: without `layout` the shared form is untouched.
    const renderer = render(
      <PromptDialog
        isDark={false}
        request={{
          title: t('Dashboard_SaveDayTemplate'),
          message: t('Common_EnterName'),
          initialValue: '',
          cancelText: t('Common_Cancel'),
          confirmText: t('Common_Save'),
          validate: () => null,
          onCancel: () => undefined,
          onConfirm: () => undefined,
        }}
      />,
    );
    expect(styleOf(pressable(renderer, t('Common_Save'))).minHeight).toBe(52);
    expect(styleOf(pressable(renderer, t('Common_Cancel'))).minHeight).toBe(52);
    // One typed field, and no range chrome leaks into it.
    expect(renderer.root.findAllByType(TextInput)).toHaveLength(1);
    expect(texts(renderer)).not.toContain(t('Rn_TemplateStartDate'));
    expect(texts(renderer)).not.toContain(t('Rn_TemplateRangeSamePlan'));
  });
});
