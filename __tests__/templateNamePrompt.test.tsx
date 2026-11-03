// "Save day as template" used to ask for a name the lazy way: the field opened
// with the day's `yyyy-MM-dd` already in it (the same text served as the
// placeholder), and an empty answer fell back to that date - so the Templates
// list filled up with rows named "2026-11-03" that nobody had chosen.
//
// Pinned here: the prompt opens EMPTY, suggests nothing (no date in grey, no
// "Today" shortcut), refuses an empty answer IN PLACE so nothing is saved, and
// saves the trimmed name the user actually typed.

import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { TextInput } from 'react-native';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { MAX_TEMPLATE_NAME_LENGTH } from '../src/domain/validation';
import { PromptDialog } from '../src/ui/components/dialogs';
import { t } from '../src/ui/strings';
import { TEMPLATE_NAME_START, templateNameProblem } from '../src/ui/templateName';

type Renderer = TestRenderer.ReactTestRenderer;

/** The refusal the dashboard maps a blank name to (see DashboardScreen). */
const nameError = (value: string): string | null =>
  templateNameProblem(value) === 'blank' ? t('Rn_TemplateNameRequired') : null;

/** The request the dashboard builds for the name prompt. */
function renderNamePrompt(onConfirm: (name: string) => void): Renderer {
  let renderer: Renderer | undefined;
  act(() => {
    renderer = TestRenderer.create(
      <PromptDialog
        isDark={false}
        request={{
          title: t('Dashboard_SaveDayTemplate'),
          message: t('Common_EnterName'),
          initialValue: TEMPLATE_NAME_START,
          cancelText: t('Common_Cancel'),
          confirmText: t('Common_Save'),
          maxLength: MAX_TEMPLATE_NAME_LENGTH,
          validate: nameError,
          onCancel: () => undefined,
          onConfirm,
        }}
      />,
    );
  });
  if (renderer === undefined) {
    throw new Error('the name prompt did not render');
  }
  return renderer;
}

function field(renderer: Renderer): TestRenderer.ReactTestInstance {
  return renderer.root.findByType(TextInput);
}

function button(renderer: Renderer, label: string): TestRenderer.ReactTestInstance {
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

function errorText(renderer: Renderer): TestRenderer.ReactTestInstance[] {
  return renderer.root.findAll((node) => node.props?.testID === 'prompt-dialog-error');
}

describe('the save-as-template name prompt', () => {
  test('opens empty and suggests nothing - above all not the day date', () => {
    const renderer = renderNamePrompt(() => undefined);
    expect(TEMPLATE_NAME_START).toBe('');
    expect(field(renderer).props.value).toBe('');
    // The placeholder follows `initialValue`, so an empty value means no grey
    // date is hinted either.
    expect(field(renderer).props.placeholder).toBe('');
    // The date prompt's "Today" shortcut has no business here: a name is not a
    // date, and one tap must not turn the day into the template's name.
    expect(button.bind(null, renderer, t('Calendar_Today'))).toThrow();
  });

  test('refuses an empty name IN PLACE and saves nothing', () => {
    const saved: string[] = [];
    const renderer = renderNamePrompt((name) => saved.push(name));

    act(() => button(renderer, t('Common_Save')).props.onPress());

    expect(saved).toHaveLength(0);
    // The form stays up with the reason beside it, so the answer can be typed.
    expect(renderer.root.findAllByType(TextInput)).toHaveLength(1);
    const shown = errorText(renderer);
    expect(shown.length).toBeGreaterThan(0);
    expect(shown[shown.length - 1].props.children).toBe(t('Rn_TemplateNameRequired'));

    // Whitespace is not a name either.
    act(() => field(renderer).props.onChangeText('   '));
    act(() => button(renderer, t('Common_Save')).props.onPress());
    expect(saved).toHaveLength(0);
    expect(errorText(renderer).length).toBeGreaterThan(0);
  });

  test('saves the name the user typed, trimmed', () => {
    const saved: string[] = [];
    const renderer = renderNamePrompt((name) => saved.push(name));

    act(() => field(renderer).props.onChangeText('  Workday  '));
    // Typing clears the refusal so the prompt never nags while the user fixes it.
    act(() => button(renderer, t('Common_Save')).props.onPress());

    expect(saved).toEqual(['Workday']);
    expect(errorText(renderer)).toHaveLength(0);
  });

  test('a date typed on purpose is still a name', () => {
    // The rule forbids EMPTY names, not dates: if the user really wants a day as
    // the name, that is their choice - it just is not automatic any more.
    expect(templateNameProblem('2026-11-03')).toBeNull();
    expect(templateNameProblem('')).toBe('blank');
    expect(templateNameProblem(' \n\t ')).toBe('blank');
    expect(templateNameProblem('Workday')).toBeNull();
  });

  test('the dashboard wires it that way (empty field, no date fallback)', () => {
    const source = readFileSync(join(__dirname, '..', 'src', 'ui', 'screens', 'DashboardScreen.tsx'), 'utf8');
    // The prompt is the REFUSING one, opened on the empty constant...
    expect(source).toContain('<PromptDialog');
    expect(source).toContain('initialValue: TEMPLATE_NAME_START');
    expect(source).toContain('validate: templateNameError');
    expect(source).toContain('maxLength: MAX_TEMPLATE_NAME_LENGTH');
    // ...and the day's date is not pre-filled, hinted or used as a fallback.
    expect(source).not.toContain('inputDefaultValue');
    expect(source).not.toMatch(/typedName[^\n]*\?\s*date\s*:/);
    expect(source).toContain('typedName.trim()');
  });
});
