// The meal card's inline editor is COMPACT and bounded on purpose:
//
//  * two SHALLOW single-line fields (Meal name, Description) whose 10 pt label
//    and character counter ride the field's top border - the text scrolls
//    horizontally inside a 44 pt box, so typing never grows the card,
//  * the editor's own 40/80 character policy (see `mealEditorLimits`): an
//    over-limit keystroke or paste is refused AS A WHOLE and never sliced, while
//    an already-longer saved value opens intact and may be kept or shortened,
//  * the planned time stays the masked HH:MM chip of the footer, beside the two
//    neutral outlined answers (Cancel / Save) - no filled control anywhere,
//  * the header's duplicate time caption is hidden only while editing.
//
// The domain's own 120 / 2000 limits are untouched (see domain/validation.ts):
// this suite only pins down what the PHONE editor accepts.

import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { StyleSheet, Text } from 'react-native';

import { MealCategoryKey, MealStatus, SyncStatus } from '../src/domain/enums';
import { MealCategory, MealEntry } from '../src/domain/models';
import {
  EDITOR_FIELD_MIN_HEIGHT,
  EDITOR_TIME_WIDTH,
  MealCard,
  timeDraft,
} from '../src/ui/components/MealCard';
import {
  EDITOR_DESCRIPTION_LIMIT,
  EDITOR_TITLE_LIMIT,
  canAcceptTextChange,
  characterCount,
  isDraftLengthAllowed,
} from '../src/ui/components/mealEditorLimits';
import { t } from '../src/ui/strings';
import { darkColors, lightColors } from '../src/ui/theme';

/**
 * The "device" the card renders on. Jest's own `Dimensions` default reports a
 * font scale of 2, which would push every test into the editor's enlarged-text
 * fallbacks; a normal phone is the honest default, and the large-text test below
 * raises the scale explicitly. The mock exposes the SAME object every call so a
 * test can change it and re-render.
 */
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => {
  const window = { width: 360, height: 780, scale: 3, fontScale: 1 };
  return { __esModule: true, default: () => window, __window: window };
});

const deviceWindow = (
  jest.requireMock('react-native/Libraries/Utilities/useWindowDimensions') as {
    __window: { width: number; height: number; scale: number; fontScale: number };
  }
).__window;

beforeEach(() => {
  deviceWindow.width = 360;
  deviceWindow.fontScale = 1;
});

const NOW = new Date('2026-11-01T12:00:00.000Z');

const CATEGORY: MealCategory = {
  id: 'cat-lunch',
  fixedCategoryKey: MealCategoryKey.Lunch,
  name: 'Lunch',
  color: '#FFFF9500',
  icon: '🍲',
  defaultTime: '12:30:00',
  displayOrder: 3,
};

const MEAL: MealEntry = {
  id: 'meal-lunch',
  localProfileId: 'profile',
  date: '2026-11-01',
  mealCategoryId: CATEGORY.id,
  mealCategoryKey: MealCategoryKey.Lunch,
  title: 'Ciorbă',
  ingredients: 'legume',
  plannedTime: null,
  status: MealStatus.Pending,
  completedAt: null,
  createdAt: NOW.toISOString(),
  updatedAt: NOW.toISOString(),
  revision: 1,
  syncStatus: SyncStatus.PendingUpload,
  cloudRevision: null,
  contentHash: null,
};

/** The input rendered for one of the editor's floating captions. */
function field(renderer: TestRenderer.ReactTestRenderer, label: string) {
  const found = renderer.root
    .findAll(
      (node) =>
        node.props?.accessibilityLabel === label &&
        typeof node.props.onChangeText === 'function' &&
        typeof node.type !== 'string',
    )
    .pop();
  if (found === undefined) {
    throw new Error(`no field labelled "${label}"`);
  }
  return found;
}

/**
 * The flattened style of a node. `Pressable` receives a FUNCTION of the pressed
 * state, so it is resolved for the resting state first.
 */
function styleOf(node: TestRenderer.ReactTestInstance): Record<string, unknown> {
  const raw = typeof node.props.style === 'function' ? node.props.style({ pressed: false }) : node.props.style;
  return (StyleSheet.flatten(raw) ?? {}) as Record<string, unknown>;
}

/**
 * Host elements only: React Native wraps `View`/`Pressable` in composite
 * components that carry the SAME props, so a plain `findAll` would report every
 * node twice.
 */
function hosts(
  renderer: TestRenderer.ReactTestRenderer,
  match: (style: Record<string, unknown>) => boolean,
): TestRenderer.ReactTestInstance[] {
  return renderer.root.findAll(
    (node) => typeof node.type === 'string' && match(styleOf(node)),
  );
}

/** Every string drawn inside the editor body (its own 12 pt top gap). */
function editorTexts(renderer: TestRenderer.ReactTestRenderer): string[] {
  const editor = renderer.root
    .findAll((node) => styleOf(node).marginTop === 12 && styleOf(node).rowGap === undefined)
    .pop();
  if (editor === undefined) {
    throw new Error('the editor is not open');
  }
  return (editor as TestRenderer.ReactTestInstance)
    .findAllByType(Text)
    .map((node) => node.props.children)
    .filter((value): value is string => typeof value === 'string');
}

/** The pressable element rendered with a given accessibility label. */
function pressable(renderer: TestRenderer.ReactTestRenderer, label: string) {
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

/**
 * The VISIBLE control inside one answer's 44 pt pressable: the neutral outline
 * the footer actually draws (36 pt tall, 8 pt corners, card surface inside a thin
 * border). The pressable itself is only the touch target.
 */
function compactControl(renderer: TestRenderer.ReactTestRenderer, label: string) {
  const found = pressable(renderer, label)
    .findAll((node) => styleOf(node).minHeight === 36)
    .pop();
  if (found === undefined) {
    throw new Error(`no visible control inside "${label}"`);
  }
  return found;
}

async function renderEditor(
  meal: MealEntry = MEAL,
  onSave: (draft: MealEntry) => Promise<string | null> = async () => null,
): Promise<TestRenderer.ReactTestRenderer> {
  let renderer: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(
      <MealCard
        meal={meal}
        category={CATEGORY}
        photos={[]}
        use12HourClock={false}
        now={NOW}
        isDark={false}
        forceEditing
        onSave={onSave}
        onComplete={async () => undefined}
        onMissed={async () => undefined}
        onClear={() => undefined}
        onAddPhoto={() => undefined}
        onRemovePhoto={() => undefined}
        onOpenPhoto={() => undefined}
      />,
    );
  });
  return renderer!;
}

/** Types one change into a field and lets React settle. */
async function type(
  renderer: TestRenderer.ReactTestRenderer,
  label: string,
  value: string,
): Promise<void> {
  await act(async () => {
    field(renderer, label).props.onChangeText(value);
  });
}

describe('the editor character policy', () => {
  test('counts code points, not UTF-16 units', () => {
    // The counter and the guards must agree on every character, so both use
    // Array.from(): an emoji is ONE character even though it is two code units.
    expect(characterCount('')).toBe(0);
    expect(characterCount('Ciorbă')).toBe(6);
    expect(characterCount('🍲')).toBe(1);
    expect('🍲'.length).toBe(2);
    // A base glyph plus a skin-tone modifier is two code points - and the limit
    // counts them as two, exactly as the user sees two marks.
    expect(characterCount('👍🏽')).toBe(2);
    expect('👍🏽'.length).toBe(4);
  });

  test('accepts the exact 40 / 80 boundary and nothing beyond it', () => {
    expect(EDITOR_TITLE_LIMIT).toBe(40);
    expect(EDITOR_DESCRIPTION_LIMIT).toBe(80);
    expect(canAcceptTextChange('', 'a'.repeat(40), EDITOR_TITLE_LIMIT)).toBe(true);
    expect(canAcceptTextChange('', 'a'.repeat(41), EDITOR_TITLE_LIMIT)).toBe(false);
    expect(canAcceptTextChange('', 'a'.repeat(80), EDITOR_DESCRIPTION_LIMIT)).toBe(true);
    expect(canAcceptTextChange('', 'a'.repeat(81), EDITOR_DESCRIPTION_LIMIT)).toBe(false);
    // Emoji count the same way here: 40 fit, 41 do not.
    expect(canAcceptTextChange('', '🍲'.repeat(40), EDITOR_TITLE_LIMIT)).toBe(true);
    expect(canAcceptTextChange('', '🍲'.repeat(41), EDITOR_TITLE_LIMIT)).toBe(false);
  });

  test('lets an existing longer value stay or shrink, never grow', () => {
    const legacy = 'x'.repeat(60);
    expect(canAcceptTextChange(legacy, legacy, EDITOR_TITLE_LIMIT)).toBe(true);
    expect(canAcceptTextChange(legacy, 'x'.repeat(39), EDITOR_TITLE_LIMIT)).toBe(true);
    expect(canAcceptTextChange(legacy, 'x'.repeat(45), EDITOR_TITLE_LIMIT)).toBe(true);
    expect(canAcceptTextChange(legacy, 'x'.repeat(61), EDITOR_TITLE_LIMIT)).toBe(false);
  });

  test('the save-side guard allows unchanged/shortened legacy text only', () => {
    expect(isDraftLengthAllowed('', 'a'.repeat(40), EDITOR_TITLE_LIMIT)).toBe(true);
    expect(isDraftLengthAllowed('', 'a'.repeat(41), EDITOR_TITLE_LIMIT)).toBe(false);
    // A longer saved value may be saved as it is, or shortened...
    expect(isDraftLengthAllowed('x'.repeat(60), 'x'.repeat(60), EDITOR_TITLE_LIMIT)).toBe(true);
    expect(isDraftLengthAllowed('x'.repeat(60), 'x'.repeat(41), EDITOR_TITLE_LIMIT)).toBe(true);
    // ...but never grown, and a short value can never jump over the limit.
    expect(isDraftLengthAllowed('x'.repeat(60), 'x'.repeat(61), EDITOR_TITLE_LIMIT)).toBe(false);
    expect(isDraftLengthAllowed('short', 'a'.repeat(41), EDITOR_TITLE_LIMIT)).toBe(false);
  });
});

describe('the planned-time field', () => {
  test('keeps a time and drops everything else', () => {
    expect(timeDraft('12:30')).toBe('12:30');
    expect(timeDraft('9:30')).toBe('9:30');
    // A number pad without a colon: the mask inserts the separator.
    expect(timeDraft('1230')).toBe('12:30');
    expect(timeDraft('123')).toBe('12:3');
    // Three digits that cannot start with a two-digit hour are a one-digit hour.
    expect(timeDraft('930')).toBe('9:30');
    expect(timeDraft('253')).toBe('2:53');
    // Letters, spaces and symbols never reach the save validation.
    expect(timeDraft('ab12h30!')).toBe('12:30');
    expect(timeDraft('')).toBe('');
    // Five characters at most: the third digit block is dropped.
    expect(timeDraft('12345')).toBe('12:34');
  });

  test('is a compact clock chip, five characters and time-only on the keyboard', async () => {
    const renderer = await renderEditor();
    const time = field(renderer, t('Rn_FieldPlannedTime'));
    expect(time.props.maxLength).toBe(5);
    expect(time.props.keyboardType).toBeDefined();
    expect(time.props.keyboardType).not.toBe('default');
    // The chip is 84 pt at the default scale; the 44 pt target is its wrapper and
    // the visible outline inside it is 36 pt tall with 8 pt corners.
    expect(EDITOR_TIME_WIDTH).toBe(84);
    const compact = hosts(renderer, (style) => style.borderRadius === 8 && style.minHeight === 36);
    // The clock and the two answers share the one compact control shape.
    expect(compact).toHaveLength(3);
    expect(styleOf(compact[0]).width).toBe(84);

    // Typing digits produces the masked value.
    await type(renderer, t('Rn_FieldPlannedTime'), '1230');
    expect(field(renderer, t('Rn_FieldPlannedTime')).props.value).toBe('12:30');
  });

  test('is no longer a separate labelled row: the time is edited in the footer', async () => {
    const renderer = await renderEditor();
    // The caption survives as the input's ACCESSIBLE name only - the footer has
    // no "Planned time" label of its own any more.
    expect(field(renderer, t('Rn_FieldPlannedTime')).props.accessibilityLabel).toBe(
      t('Rn_FieldPlannedTime'),
    );
    expect(editorTexts(renderer)).not.toContain(t('Rn_FieldPlannedTime'));
  });
});

describe('the title and description fields', () => {
  test('are single-line and carry no native character cap', async () => {
    const renderer = await renderEditor();
    for (const label of [t('Rn_FieldMealName'), t('Rn_FieldDescription')]) {
      const input = field(renderer, label);
      // One line: the text scrolls horizontally instead of adding a row.
      expect(input.props.multiline).toBe(false);
      // No native maxLength: it counts UTF-16, would disagree with the code-point
      // guard and could cut a paste before the guard ever sees it.
      expect(input.props.maxLength).toBeUndefined();
      // The 44 pt floor is the shallow chip and the minimum touch target at once.
      expect(styleOf(input).minHeight).toBe(EDITOR_FIELD_MIN_HEIGHT);
    }
  });

  test('float their label and counter on the top border', async () => {
    const renderer = await renderEditor();
    const captions = hosts(
      renderer,
      (style) => style.top === -7 && style.position === 'absolute',
    );
    // One floating caption row per field, 10 pt type, on the border.
    expect(captions).toHaveLength(2);
    for (const row of captions) {
      const texts = row
        .findAllByType(Text)
        .map((node) => node.props.children)
        .filter((value): value is string => typeof value === 'string');
      expect(texts).toHaveLength(2);
      // The counter is the ACTUAL value over the limit, in code points.
      expect(texts[1]).toMatch(/^\d+\/(40|80)$/);
      expect(styleOf(row.findAllByType(Text)[0]).fontSize).toBe(10);
      // The caption wears the card's own fill, which is what lets it sit on the
      // border without a second row of chrome.
      expect(styleOf(row.findAllByType(Text)[0]).backgroundColor).toBe(lightColors.cardFill);
    }
    // 'Ciorbă' is 6 code points, 'legume' 6.
    expect(editorTexts(renderer)).toEqual(
      expect.arrayContaining([`6/${EDITOR_TITLE_LIMIT}`, `6/${EDITOR_DESCRIPTION_LIMIT}`]),
    );
  });

  test('accept 40 / 80 characters and refuse the next one INTACT', async () => {
    const renderer = await renderEditor({ ...MEAL, title: '', ingredients: '' });

    await type(renderer, t('Rn_FieldMealName'), 'a'.repeat(40));
    expect(field(renderer, t('Rn_FieldMealName')).props.value).toBe('a'.repeat(40));

    // The 41st character is refused as a whole: the draft keeps its 40 and the
    // concise reason is shown.
    await type(renderer, t('Rn_FieldMealName'), 'a'.repeat(41));
    expect(field(renderer, t('Rn_FieldMealName')).props.value).toBe('a'.repeat(40));
    expect(editorTexts(renderer)).toContain(t('Rn_EditorTitleLimit'));

    await type(renderer, t('Rn_FieldDescription'), 'b'.repeat(80));
    expect(field(renderer, t('Rn_FieldDescription')).props.value).toBe('b'.repeat(80));
    await type(renderer, t('Rn_FieldDescription'), 'b'.repeat(81));
    expect(field(renderer, t('Rn_FieldDescription')).props.value).toBe('b'.repeat(80));
    expect(editorTexts(renderer)).toContain(t('Rn_EditorDescriptionLimit'));

    // An accepted change clears the note again.
    await type(renderer, t('Rn_FieldMealName'), 'a'.repeat(12));
    expect(editorTexts(renderer)).not.toContain(t('Rn_EditorTitleLimit'));
    expect(field(renderer, t('Rn_FieldMealName')).props.value).toBe('a'.repeat(12));
  });

  test('count emoji as one character each, so 40 fit and 41 do not', async () => {
    const renderer = await renderEditor({ ...MEAL, title: '' });
    await type(renderer, t('Rn_FieldMealName'), '🍲'.repeat(40));
    expect(field(renderer, t('Rn_FieldMealName')).props.value).toBe('🍲'.repeat(40));
    // A 41st emoji is refused whole - no half of a surrogate pair is kept.
    await type(renderer, t('Rn_FieldMealName'), '🍲'.repeat(41));
    expect(field(renderer, t('Rn_FieldMealName')).props.value).toBe('🍲'.repeat(40));
    expect(editorTexts(renderer)).toContain(`40/${EDITOR_TITLE_LIMIT}`);
  });

  test('open an existing longer value intact, with its real count', async () => {
    const longTitle = 'T'.repeat(60);
    const longDescription = 'd'.repeat(120);
    const renderer = await renderEditor({
      ...MEAL,
      title: longTitle,
      ingredients: longDescription,
    });
    // Nothing is cut on the way in: the saved text opens exactly as it was.
    expect(field(renderer, t('Rn_FieldMealName')).props.value).toBe(longTitle);
    expect(field(renderer, t('Rn_FieldDescription')).props.value).toBe(longDescription);
    // The counters tell the truth about the over-limit value...
    expect(editorTexts(renderer)).toEqual(
      expect.arrayContaining([`60/${EDITOR_TITLE_LIMIT}`, `120/${EDITOR_DESCRIPTION_LIMIT}`]),
    );
    // ...and the quiet hint says it may be kept or shortened.
    expect(editorTexts(renderer)).toContain(t('Rn_EditorLegacyHint'));

    // It may not grow any further, and it may be shortened.
    await type(renderer, t('Rn_FieldMealName'), 'T'.repeat(61));
    expect(field(renderer, t('Rn_FieldMealName')).props.value).toBe(longTitle);
    await type(renderer, t('Rn_FieldMealName'), 'T'.repeat(39));
    expect(field(renderer, t('Rn_FieldMealName')).props.value).toBe('T'.repeat(39));
    // The description is still longer than 80, so the hint stays until BOTH
    // values are back inside the policy.
    expect(editorTexts(renderer)).toContain(t('Rn_EditorLegacyHint'));
    await type(renderer, t('Rn_FieldDescription'), 'd'.repeat(20));
    expect(editorTexts(renderer)).not.toContain(t('Rn_EditorLegacyHint'));
  });
});

describe('the editor layout', () => {
  test('hides the duplicate header time only while editing', async () => {
    const renderer = await renderEditor();
    const headerTexts = () =>
      renderer.root
        .findAllByType(Text)
        .map((node) => node.props.children)
        .filter((value): value is string => typeof value === 'string');
    // The saved time (the category's 12:30 default) is not repeated in the header
    // while the footer owns it.
    expect(headerTexts()).not.toContain('12:30');

    await act(async () => {
      pressable(renderer, t('Common_Cancel')).props.onPress();
    });
    // Read mode keeps the caption, exactly as before this refinement.
    expect(headerTexts()).toContain('12:30');
  });

  test('the card keeps its icon, name and status pill while editing', async () => {
    const renderer = await renderEditor();
    const glyphs = renderer.root
      .findAll((node) => typeof node.props?.accessibilityLabel === 'string')
      .map((node) => node.props.accessibilityLabel as string);
    expect(glyphs).toContain('material:silverware-fork-knife');
    // The footer's clock: the time is still recognisably a time.
    expect(glyphs).toContain('icon:time-outline');
    const texts = renderer.root.findAllByType(Text).map((node) => node.props.children);
    expect(texts).toContain(t('Status_Pending'));
    expect(texts).toContain('Lunch');
  });

  test('the editor carries no heading and no separate label row', async () => {
    const renderer = await renderEditor();
    // Two floating captions with their counters, then the two answers - nothing
    // to read twice (the card's header already names the meal).
    expect(editorTexts(renderer)).toEqual([
      t('Rn_FieldMealName'),
      `6/${EDITOR_TITLE_LIMIT}`,
      t('Rn_FieldDescription'),
      `6/${EDITOR_DESCRIPTION_LIMIT}`,
      t('Common_Cancel'),
      t('Common_Save'),
    ]);
  });

  test('the footer sits on the card surface: time chip left, two answers right', async () => {
    const renderer = await renderEditor();
    const footer = renderer.root
      .findAll(
        (node) => styleOf(node).marginTop === 6 && styleOf(node).justifyContent === 'space-between',
      )
      .pop();
    expect(footer).toBeDefined();
    const footerStyle = styleOf(footer as TestRenderer.ReactTestInstance);
    // No tinted band: a row on the card's own surface.
    expect(footerStyle.flexDirection).toBe('row');
    expect(footerStyle.backgroundColor).toBeUndefined();
    expect(footerStyle.borderRadius).toBeUndefined();

    // Both answers are real 44 pt targets around a smaller NEUTRAL outline.
    expect(styleOf(pressable(renderer, t('Common_Cancel'))).minWidth).toBe(64);
    expect(styleOf(pressable(renderer, t('Common_Save'))).minWidth).toBe(56);
    expect(styleOf(pressable(renderer, t('Common_Cancel'))).minHeight).toBe(44);
    expect(styleOf(pressable(renderer, t('Common_Save'))).minHeight).toBe(44);
    for (const label of [t('Common_Cancel'), t('Common_Save')]) {
      const visible = styleOf(compactControl(renderer, label));
      // The card's own surface inside a thin border, 8 pt corners: no accent fill.
      expect(visible.backgroundColor).toBe(lightColors.cardFill);
      expect(visible.borderColor).toBe(lightColors.border);
      expect(visible.borderRadius).toBe(8);
    }
  });

  test('moves the floating captions into flow and stacks the footer at large text', async () => {
    // Large accessibility text: the caption cannot sit on the border any more, so
    // it becomes a normal row above the box, and the two answers drop under the
    // time chip instead of squeezing it. Nothing is clipped or shrunk.
    deviceWindow.fontScale = 2;
    const renderer = await renderEditor();

    const floating = hosts(renderer, (style) => style.top === -7);
    expect(floating).toHaveLength(0);
    // The caption row is in normal flow now (relative, with air below it).
    const captions = hosts(
      renderer,
      (style) => style.position === 'relative' && style.marginBottom === 4,
    );
    expect(captions).toHaveLength(2);

    // The footer stacks, and every target keeps its 44 pt floor.
    const footer = renderer.root
      .findAll(
        (node) => styleOf(node).marginTop === 6 && styleOf(node).alignItems === 'stretch',
      )
      .pop();
    expect(footer).toBeDefined();
    expect(styleOf(footer as TestRenderer.ReactTestInstance).flexDirection).toBe('column');
    for (const label of [t('Common_Cancel'), t('Common_Save')]) {
      expect(styleOf(pressable(renderer, label)).minHeight).toBe(44);
    }
    // The field's floor grows with the text instead of clipping it.
    expect(styleOf(field(renderer, t('Rn_FieldMealName'))).minHeight).toBeGreaterThan(44);
  });

  test('stacks the footer on a narrow card', async () => {
    deviceWindow.width = 320;
    const renderer = await renderEditor();
    const footer = renderer.root
      .findAll(
        (node) => styleOf(node).marginTop === 6 && styleOf(node).alignItems === 'stretch',
      )
      .pop();
    expect(footer).toBeDefined();
    expect(styleOf(footer as TestRenderer.ReactTestInstance).flexDirection).toBe('column');
  });

  test('dark mode draws the same anatomy from the dark theme', async () => {
    let renderer: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(
        <MealCard
          meal={MEAL}
          category={CATEGORY}
          photos={[]}
          use12HourClock={false}
          now={NOW}
          isDark
          forceEditing
          onSave={async () => null}
          onComplete={async () => undefined}
          onMissed={async () => undefined}
          onClear={() => undefined}
          onAddPhoto={() => undefined}
          onRemovePhoto={() => undefined}
          onOpenPhoto={() => undefined}
        />,
      );
    });

    // The field is the dark CARD's own surface inside the dark border, and the
    // floating caption wears that same fill so it can sit on the border.
    const outline = hosts(renderer!, (style) => style.borderRadius === 10 && style.minHeight === 44)[0];
    expect(styleOf(outline).borderColor).toBe(darkColors.border);
    expect(styleOf(outline).backgroundColor).toBe(darkColors.cardFill);
    const label = renderer!.root
      .findAllByType(Text)
      .find((node) => node.props.children === t('Rn_FieldMealName'));
    expect(styleOf(label as TestRenderer.ReactTestInstance).backgroundColor).toBe(
      darkColors.cardFill,
    );
    // The answers are the dark card's own surface inside the dark border too:
    // there is no filled accent anywhere on this card.
    for (const label of [t('Common_Cancel'), t('Common_Save')]) {
      const visible = styleOf(compactControl(renderer!, label));
      expect(visible.backgroundColor).toBe(darkColors.cardFill);
      expect(visible.borderColor).toBe(darkColors.border);
    }
  });

  test('the action strip is hidden while the editor is open', async () => {
    const renderer = await renderEditor();
    const labels = renderer.root
      .findAll(
        (node) =>
          typeof node.props?.accessibilityLabel === 'string' &&
          typeof node.props.onPress === 'function',
      )
      .map((node) => node.props.accessibilityLabel as string);
    // None of the five tools exists: the editor replaces the strip, it does not
    // stack above it.
    for (const label of [
      t('Photo_Add'),
      t('Common_Edit'),
      t('Meal_Clear'),
      t('Meal_MarkMissed'),
      t('Meal_MarkDone'),
    ]) {
      expect(labels).not.toContain(label);
    }
  });
});
