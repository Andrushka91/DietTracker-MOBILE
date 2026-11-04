// Regression tests for the two dialogs that used to hide a defect:
//
//  * the photo-source question had only two buttons, and its "cancel" side meant
//    Gallery - so the backdrop and Android Back both launched the system picker.
//  * the template date prompt closed on confirm and had nowhere to show an
//    error, so an invalid date fell back to today and applied the template to
//    the wrong day.

import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { ActivityIndicator, Modal, StyleSheet, Text, TextInput } from 'react-native';

import { ChoiceDialog, ConfirmDialog, LoadingSheet, PromptDialog } from '../src/ui/components/dialogs';
import { dateDraft, dateInputProblem, DATE_INPUT_LENGTH } from '../src/ui/dates';
import { t } from '../src/ui/strings';
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
 * The compact Apply-template sheet (`layout: 'template-date'`) - the r3 reference
 * form, used ONLY by Templates. It is the SAME value/error state, mask, validator
 * and callbacks as the default prompt; only the chrome differs. These tests pin
 * that chrome (badge, real summary, labelled field, Today, hint, answers) and
 * re-check the semantics that must never regress: an invalid date keeps the sheet
 * open and applies nothing, Today only fills, and every dismissal applies nothing.
 */
describe('the compact Apply-template sheet', () => {
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

  function renderSheet(initialValue = '2026-11-02') {
    const onCancel = jest.fn();
    const onConfirm = jest.fn();
    const renderer = render(
      <PromptDialog
        isDark={false}
        request={{
          layout: 'template-date',
          title: t('Template_ApplyTitle'),
          message: t('Rn_TemplateDatePrompt'),
          contextLabel: 'Full day · 5 meals',
          fieldLabel: t('Rn_TemplateDateLabel'),
          formatHint: t('Rn_TemplateDateFormatHint'),
          initialValue,
          cancelText: t('Common_Cancel'),
          confirmText: t('Rn_TemplateApplyConfirm'),
          today: { label: t('Calendar_Today'), value: '2026-11-04' },
          keyboardType: 'number-pad',
          sanitize: dateDraft,
          maxLength: DATE_INPUT_LENGTH,
          validate: dateError,
          onCancel,
          onConfirm,
        }}
      />,
    );
    return { renderer, onCancel, onConfirm };
  }

  test('draws the badge, the real summary, the labelled field and the answers', () => {
    const { renderer } = renderSheet();
    const printed = texts(renderer);

    // Title, the REAL template summary, the field label, Today and the hint.
    expect(printed).toContain(t('Template_ApplyTitle'));
    expect(printed).toContain('Full day · 5 meals');
    expect(printed).toContain(t('Rn_TemplateDateLabel'));
    expect(printed).toContain(t('Calendar_Today'));
    expect(printed).toContain(t('Rn_TemplateDateFormatHint'));
    expect(printed).not.toContain(t('Rn_TemplateDatePrompt'));

    // The compact sheet: 520 dp cap, 24 pt corners.
    const card = styleOf(
      renderer.root.findAll((node) => node.props?.testID === 'prompt-dialog-card').pop()!,
    );
    expect(card.maxWidth).toBe(520);
    expect(card.borderTopLeftRadius).toBe(24);

    // The date field: 48 pt tall, 12 pt corners, a 1 pt frame with the calendar
    // glyph and the editable ISO value inside it.
    const input = renderer.root.findByType(TextInput);
    const field = styleOf(input.parent!);
    expect(field.minHeight).toBe(48);
    expect(field.borderRadius).toBe(12);
    expect(field.borderWidth).toBe(1);
    expect(field.borderColor).toBe(lightColors.border);
    expect(styleOf(input).fontSize).toBe(17);
    expect(input.props.keyboardType).toBe('number-pad');
    expect(input.props.maxLength).toBe(DATE_INPUT_LENGTH);

    // Cancel is outlined on the left, Apply is filled and wider (1 : 1.8).
    const cancel = styleOf(pressable(renderer, t('Common_Cancel')));
    const apply = styleOf(pressable(renderer, t('Rn_TemplateApplyConfirm')));
    expect(cancel.minHeight).toBe(48);
    expect(cancel.borderRadius).toBe(12);
    expect(cancel.borderWidth).toBe(1);
    expect(cancel.borderColor).toBe(lightColors.border);
    expect(cancel.backgroundColor).toBe(lightColors.surface);
    expect(apply.minHeight).toBe(48);
    expect(apply.backgroundColor).toBe(lightColors.accentFill);
    expect(cancel.width).toBe(121.43);
    expect(apply.width).toBe(218.57);
    expect((cancel.width as number) + (apply.width as number)).toBeCloseTo(340, 5);
  });

  test('an invalid date keeps the sheet open, explains why and applies nothing', () => {
    const { renderer, onCancel, onConfirm } = renderSheet('');
    act(() => pressable(renderer, t('Rn_TemplateApplyConfirm')).props.onPress());

    expect(onConfirm).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
    // The form is still there, with the reason beside the field.
    expect(renderer.root.findAllByType(TextInput)).toHaveLength(1);
    expect(
      renderer.root.findAll((node) => node.props?.testID === 'prompt-dialog-error').length,
    ).toBeGreaterThan(0);
    expect(texts(renderer)).toContain(t('Rn_TemplateDateRequired'));
    // ...and the hint gives way to the error, so only one line is shown.
    expect(texts(renderer)).not.toContain(t('Rn_TemplateDateFormatHint'));
  });



  test('Today only fills the field; the user still applies it', () => {
    const { renderer, onConfirm } = renderSheet('');
    act(() => pressable(renderer, t('Calendar_Today')).props.onPress());
    expect(renderer.root.findByType(TextInput).props.value).toBe('2026-11-04');
    expect(onConfirm).not.toHaveBeenCalled();

    act(() => pressable(renderer, t('Rn_TemplateApplyConfirm')).props.onPress());
    expect(onConfirm).toHaveBeenCalledWith('2026-11-04');
  });

  test('Cancel and the close X dismiss without applying', () => {
    const { renderer, onCancel, onConfirm } = renderSheet();
    act(() => pressable(renderer, t('Common_Cancel')).props.onPress());
    act(() => pressable(renderer, t('Common_Close')).props.onPress());
    act(() => renderer.root.findByType(Modal).props.onRequestClose());

    expect(onCancel).toHaveBeenCalledTimes(3);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  test('stacks both answers at full width on a narrow screen or large text', () => {
    mockWindow.width = 320;
    const narrow = renderSheet();
    expect(styleOf(pressable(narrow.renderer, t('Common_Cancel'))).width).toBe('100%');
    expect(styleOf(pressable(narrow.renderer, t('Rn_TemplateApplyConfirm'))).width).toBe('100%');

    mockWindow.width = 390;
    mockWindow.fontScale = 1.5;
    const large = renderSheet();
    expect(styleOf(pressable(large.renderer, t('Common_Cancel'))).width).toBe('100%');

    // Back at a phone width with normal text, they sit side by side again and
    // share the row as the reference's 1 : 1.8.
    mockWindow.fontScale = 1;
    const wide = renderSheet();
    const wideCancel = styleOf(pressable(wide.renderer, t('Common_Cancel'))).width as number;
    const wideApply = styleOf(pressable(wide.renderer, t('Rn_TemplateApplyConfirm'))).width as number;
    expect(wideCancel).toBe(121.43);
    expect(wideApply).toBe(218.57);
    expect(wideApply / wideCancel).toBeCloseTo(1.8, 2);
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
    // No date chrome leaks into it: no field label, no format hint.
    expect(texts(renderer)).not.toContain(t('Rn_TemplateDateLabel'));
    expect(texts(renderer)).not.toContain(t('Rn_TemplateDateFormatHint'));
  });
});

