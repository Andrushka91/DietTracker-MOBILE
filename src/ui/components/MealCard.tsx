// Meal card (spec 8.3) - identical anatomy in read and edit mode:
//
//  header: the category's LINE ICON in a 36 pt tile (see `../mealGlyphs`), the
//          fixed category name, the effective planned time caption, the status
//          pill (Pending gray / Done green / Missed red)
//  read:   title (2 lines), description (3 lines), closable error banner,
//          photo gallery (right of the text)
//  bar:    ONE full-width hairline under the meal, then the five tools in two
//          groups - Add photo / Edit / Clear on the left, Mark MISSED / Mark DONE
//          on the right, separated by one divider that sits one strip padding
//          (10 pt) from the ✕, all on a tinted strip. Clear
//          wears the mockup's flat-lidded, twin-bar bin in the card's ink (never
//          the missed red) and is disabled when the card is empty; the state mark
//          that matches the meal's CURRENT status keeps a ring. The five glyphs
//          are drawn at 20 pt on visible 40 pt tiles 6 pt apart, each with a 44 pt
//          touch target.
//  editor: no heading of its own - two full-width shallow outlined fields
//          (Meal name, Description) whose floating 10 pt label and character
//          counter sit ON the top border, then one footer holding a compact
//          clock + time chip on the left and Cancel / Save on the right. The
//          fields are SINGLE-LINE: the text scrolls horizontally inside a 44 pt
//          box instead of growing the card, and the editor's own 40/80 policy
//          (see `mealEditorLimits.ts`) refuses an over-limit change as a whole
//          rather than cutting it. Validation failures land on the card error
//          line and Cancel resets only this card's draft. The action strip is
//          not drawn while the editor is open.

import React, { useEffect, useRef, useState } from 'react';
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
  type ViewStyle,
} from 'react-native';

import { MealStatus } from '../../domain/enums';
import { MealCategory, MealEntry, MealPhoto } from '../../domain/models';
import { isFutureMeal } from '../../domain/rules/completionRules';
import { hasMealText, hasUserContent } from '../../domain/rules/mealContentRules';
import { MAX_PHOTOS_PER_MEAL } from '../../domain/rules/photoRules';
import { validateMealEntry } from '../../domain/validation';
import { accentActionColors, cancelActionColors } from '../accentActions';
import { formatTime, mealNameKey, t } from '../strings';
import { argb, fonts, metrics, softPillColors, themeColors, tintAlpha } from '../theme';
import { localizedCode } from './buttons';
import { FeatherIcon, Icon, MaterialIcon, type IconName } from './icons';
import { MEAL_GLYPH_SIZE, mealCategoryGlyph } from '../mealGlyphs';
import {
  EDITOR_DESCRIPTION_LIMIT,
  EDITOR_TITLE_LIMIT,
  canAcceptTextChange,
  characterCount,
  isDraftLengthAllowed,
} from './mealEditorLimits';
import { PHOTO_GAP, PHOTO_TILE, PhotoGallery } from './PhotoGallery';

/**
 * Geometry of the compact inline editor (dp / sp), scoped to this card so no
 * other screen changes: 12 pt card inset, two 44 pt shallow fields 12 pt apart,
 * then a footer 6 pt below them. Every footer control is a real 48/44 dp target
 * around a SMALLER 30 dp visible face (equal across Save / Cancel / time), so
 * the answers stay quiet on the card's own surface while remaining comfortable
 * to tap. Time shares the exact same resting fill family as Save via accentActionColors.
 */
const EDITOR_TOP_GAP = 12;
const EDITOR_FIELD_GAP = 12;
/** 44 pt: the shallow chip, and the app's minimum touch target. */
export const EDITOR_FIELD_MIN_HEIGHT = 44;
const EDITOR_FIELD_RADIUS = 10;
const EDITOR_FIELD_PADDING = 10;
const EDITOR_FIELD_TEXT_SIZE = 14;
const EDITOR_FIELD_LINE_HEIGHT = 20;
/** The floating label / counter: 10 pt on the field's top border. */
const EDITOR_LABEL_SIZE = 10;
const EDITOR_LABEL_TOP = -7;
/**
 * Air above the footer row: 2 dp. The row's own 48/44 dp targets already leave
 * ~9/7 dp of transparent slack around the 30 dp faces, so the old 6 dp margin
 * doubled the gap on an open editor.
 */
const EDITOR_FOOTER_GAP = 2;
const EDITOR_TIME_TEXT_SIZE = 12;
/** The clock glyph and its gap are the ONLY additions to the measured time text. */
const EDITOR_TIME_ICON_SIZE = 12;
const EDITOR_TIME_ICON_GAP = 2;
/** "HH:MM" width assumed until the displayed value has really been measured. */
const EDITOR_TIME_TEXT_FALLBACK = 36;
/** Side padding shared by the four action faces AND the time chip: 5 dp. */
const EDITOR_CONTROL_PADDING_X = 5;
const EDITOR_BUTTON_GAP = 8;
/** The real touch target around every footer control. */
export const EDITOR_BUTTON_MIN_HEIGHT_ANDROID = 48;
export const EDITOR_BUTTON_MIN_HEIGHT_IOS = 44;
/** The real touch target is at least 48 dp (Android) / 44 dp (iOS) in BOTH axes. */
const EDITOR_TARGET_MIN =
  Platform.OS === 'ios' ? EDITOR_BUTTON_MIN_HEIGHT_IOS : EDITOR_BUTTON_MIN_HEIGHT_ANDROID;
/** The visible face height for every footer control: 30 dp. */
const EDITOR_CONTROL_MIN_HEIGHT = 30;
const EDITOR_CONTROL_RADIUS = 8;
const EDITOR_CONTROL_TEXT_SIZE = 12;
const EDITOR_CONTROL_LINE_HEIGHT = 18;
/** Above this system font scale the floating labels move into normal flow. */
const EDITOR_LABEL_FLOW_SCALE = 1.2;
/** Above this scale (or under this card width) the footer stacks. */
const EDITOR_FOOTER_STACK_SCALE = 1.3;
const EDITOR_FOOTER_STACK_WIDTH = 350;

/** Longest accepted text in the planned-time field: "HH:MM". */
const TIME_MAX_LENGTH = 5;

/**
 * Masks the planned-time draft to a time and nothing else.
 *
 * The field accepts DIGITS and ONE COLON - letters, spaces, a second colon and a
 * third digit block can never reach the save validation. Android's number pad
 * offers no colon key, so the separator is inserted automatically after the
 * second digit ("1230" → "12:30"). A colon the user typed is honoured where the
 * keyboard has one (iOS numbers-and-punctuation), which keeps the short form
 * "9:30" available. Three digits without a colon are read as the only time they
 * can be - "930" → "9:30", because a two-digit hour above 23 cannot exist -
 * while "123" stays "12:3" and completes to "12:30".
 */
export function timeDraft(raw: string): string {
  const cleaned = raw.replace(/[^0-9:]/g, '');
  const colon = cleaned.indexOf(':');
  if (colon >= 0) {
    const hours = cleaned.slice(0, colon).replace(/\D/g, '').slice(0, 2);
    const minutes = cleaned.slice(colon + 1).replace(/\D/g, '').slice(0, 2);
    return `${hours}:${minutes}`;
  }
  const digits = cleaned.slice(0, 4);
  if (digits.length <= 2) {
    return digits;
  }
  if (digits.length === 3 && Number(digits.slice(0, 2)) > 23) {
    return `${digits[0]}:${digits.slice(1)}`;
  }
  return `${digits.slice(0, 2)}:${digits.slice(2)}`;
}

/**
 * The meal card's ACTION TOOLBAR, measured off the reference card: the same five
 * tools (camera, edit, clear, missed, done) as 20 pt glyphs on VISIBLE 36 pt
 * outlined tiles, each inside a REAL 44 pt pressable - so the tile reads as a
 * compact chip while the thumb gets the full target with no overlapping hit slop
 * between two neighbours. Tiles sit 2 pt apart inside a group.
 *
 * Three of the five are Ionicons. The other two are the mockup's own shapes, both
 * from Feather - the one font that draws them:
 *
 *   edit   `edit`    - a square open at the top-right with a plain pencil through
 *                      the gap (Ionicons' `create-outline` adds a nib and a
 *                      collar, so it reads as a fountain pen).
 *   clear  `trash-2` - a thin lid line overhanging the body, an arched handle,
 *                      rounded body corners and TWO short bars inside (Ionicons'
 *                      `trash-outline` tapers its body and draws three bars;
 *                      Material's can has a thick filled lid band).
 *
 * The Ionicons bin stays for the photo viewer and the confirm sheets.
 */
export const CARD_TOOL_GLYPH = 20;
/** The visible outlined tile: 36 pt with a 10 pt corner (the reference chip). */
export const CARD_TOOL_SIZE = 36;
/** The real, non-overlapping pressable around it - the 44 pt touch target. */
export const CARD_TOOL_TOUCH = 44;
/** Air between two tiles of one group (camera / edit / clear, missed / done). */
export const CARD_TOOL_GAP = 2;
/** Corner of the visible tile. */
export const CARD_TOOL_RADIUS = 10;
/**
 * The toolbar's own side padding: 10 pt on both edges, and exactly the air the
 * single group separator keeps on either side (see `CARD_TOOLBAR_GAP`).
 */
export const CARD_STRIP_PADDING = 10;
/** Air around the short separator, before the status tools. */
export const CARD_TOOLBAR_GAP = 8;
/** Height of that separator: a short mark, not a full-height wall. */
export const CARD_TOOLBAR_SEPARATOR_HEIGHT = 24;

/** Text column floor before the photo strip drops below it (reference: 120 dp). */
export const TEXT_MIN_WIDTH = 120;
/** Air between the text column and the photo strip. */
export const TEXT_GALLERY_GAP = 12;
/** Above this system font scale the card uses its stacked fallback. */
export const LARGE_TEXT_SCALE = 1.4;

export interface MealCardProps {
  meal: MealEntry;
  category: MealCategory;
  photos: MealPhoto[];
  use12HourClock: boolean;
  now: Date;
  /** Opens the inline editor on mount/update (deep link / empty-DONE dialog). */
  forceEditing?: boolean;
  /**
   * Dashboard "Save all" (spec 8.2): every increment asks the card to save its
   * open editor. Cards that are not editing ignore it; a card whose editor
   * fails validation keeps the editor open and reports `saved = false`.
   */
  saveAllTick?: number;
  /** Reports whether this card's inline editor is open (enables "Save all"). */
  onEditingChange?: (mealId: string, editing: boolean) => void;
  /** Result of a batch save so the dashboard can report saved/total. */
  onBatchResult?: (mealId: string, saved: boolean) => void;
  /** Persists an edited card; returns an error message or null on success. */
  onSave: (draft: MealEntry) => Promise<string | null>;
  onComplete: (entry: MealEntry) => Promise<void>;
  onMissed: (entry: MealEntry) => Promise<void>;
  onClear: (entry: MealEntry) => void;
  onAddPhoto: (entry: MealEntry) => void;
  onRemovePhoto: (photo: MealPhoto) => void;
  onOpenPhoto: (photo: MealPhoto) => void;
  /** A photograph of this meal is being saved (spinner tile in the gallery). */
  uploadingPhoto?: boolean;
  isDark: boolean;
  /**
   * Registry callback from Dashboard: inserts a command object into the parent's
   * registry so Cancel all can discard this card's open draft synchronously.
   * Returns a cleanup function called on unmount / identity change.
   */
  registerEditor?: (id: string, commands: {
    isEditing: () => boolean;
    isSaving: () => boolean;
    cancel: () => void;
  }) => (() => void) | void;
  /** Called when this card's saving state changes (true → false transitions). */
  onSavingChange?: (mealId: string, busy: boolean) => void;
}

export function MealCard(props: MealCardProps): React.JSX.Element {
  const { meal, category, photos, use12HourClock, now, isDark } = props;
  const colors = themeColors(isDark);
  const { width, fontScale } = useWindowDimensions();
  /** Very large system text: the header and the content row stack (reference). */
  const largeText = fontScale > LARGE_TEXT_SCALE;
  /**
   * Editor-only fallbacks. At enlarged text the floating label/counter would
   * collide with the value, so they move into normal flow above the box; on a
   * narrow card or at the largest sizes the footer stacks instead of squeezing
   * the time chip against the two answers.
   */
  const editorLabelsInFlow = fontScale > EDITOR_LABEL_FLOW_SCALE;
  /**
   * The footer stacks only once the card's width is actually known (0 until the
   * first layout pass, when the normal row is the honest default).
   */
  const editorFooterStacked =
    (width > 0 && width < EDITOR_FOOTER_STACK_WIDTH) || fontScale > EDITOR_FOOTER_STACK_SCALE;
  /**
   * Measured width of the content row. It is 0 until the first layout pass, so
   * the card draws the approved side-by-side layout and only falls back once it
   * really knows the text would be squeezed.
   */
  const [contentWidth, setContentWidth] = useState(0);
  const [editing, setEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState(meal.title);
  const [draftIngredients, setDraftIngredients] = useState(meal.ingredients);
  const [draftTime, setDraftTime] = useState('');
  /**
   * Content-fit geometry for the time chip. The face is only as wide as the
   * displayed value plus the clock, its 2 dp gap, the shared 5 dp side padding
   * and the border — never a fixed 64 dp slot, so nothing around it is padded by
   * accident. The value is measured from a hidden copy of the same 12 sp text.
   */
  const [timeTextWidth, setTimeTextWidth] = useState<number | null>(null);
  /** The chip thickens its border while the input is focused (focus indication). */
  const [timeFocused, setTimeFocused] = useState(false);
  /**
   * Content-fit geometry for the time chip and its input. The face is measured
   * text + clock + its 2 dp gap + the shared 5 dp side padding + the border —
   * never a fixed 64 dp slot. A very large system font can never push the footer
   * off the card: the face is clamped to the window and the footer stacks long
   * before this clamp matters.
   */
  const timeBorderWidth = timeFocused ? 2 : 1;
  const timeDisplayed = draftTime === '' ? 'HH:MM' : draftTime;
  const timeInputWidth = Math.ceil(timeTextWidth ?? EDITOR_TIME_TEXT_FALLBACK * fontScale);
  const timeFaceWidth = Math.min(
    width > 0 ? width : Number.MAX_SAFE_INTEGER,
    timeInputWidth +
      EDITOR_TIME_ICON_SIZE +
      EDITOR_TIME_ICON_GAP +
      2 * EDITOR_CONTROL_PADDING_X +
      2 * timeBorderWidth,
  );
  /**
   * The concise reason an over-limit keystroke or paste was refused. It is local
   * feedback for THIS editor - not a global status - and disappears with the next
   * accepted change, Cancel or a successful save.
   */
  const [limitNotice, setLimitNotice] = useState<string | null>(null);
  const [errorLine, setErrorLine] = useState<string | null>(null);
  /** True while this card's save is in flight (the Save button is disabled). */
  const [saving, setSaving] = useState(false);
  /**
   * Re-entry guard for the save itself. React state is asynchronous, so two
   * taps landing in the same frame would both pass a `saving === false` check;
   * this ref is already true for the second one.
   */
  const saveBusyRef = useRef(false);
  /**
   * The text this EDIT SESSION opened with - the baseline of the 40/80 save
   * policy. It is captured once when the editor opens (button or `forceEditing`)
   * and never re-read from the props while the session runs: a background
   * refresh must neither reset the drafts nor move the goalposts under a save.
   */
  const editStartRef = useRef({ title: meal.title, ingredients: meal.ingredients });
  /** Mutable editing flag for synchronous Cancel all access. */
  const editingRef = useRef(false);
  /** Mutable saving flag for synchronous Cancel all guard. */
  const savingRef = useRef(false);
  /** The three editor inputs, so a tap on a field's frame focuses its input. */
  const titleRef = useRef<React.ElementRef<typeof TextInput> | null>(null);
  const descriptionRef = useRef<React.ElementRef<typeof TextInput> | null>(null);
  const timeRef = useRef<React.ElementRef<typeof TextInput> | null>(null);

  const future = isFutureMeal(meal, now);
  /** Nothing at all: the Clear button is dead and the card is a placeholder. */
  const empty = !hasUserContent(meal, photos.length);
  /**
   * A title or a description exists - the only content the DONE rule accepts. A
   * card with just a photograph, a planned time or an old state keeps its ✓
   * disabled: confirming a meal that was never described is what flipped
   * untouched cards to green.
   */
  const canConfirm = hasMealText(meal);
  const statusLabel =
    meal.status === MealStatus.Done
      ? t('Status_Done')
      : meal.status === MealStatus.Missed
        ? t('Status_Missed')
        : t('Status_Pending');
  const statusColor =
    meal.status === MealStatus.Done
      ? colors.done
      : meal.status === MealStatus.Missed
        ? colors.missed
        : colors.pending;
  /**
   * The state cue next to the word: ✓ done, ✕ missed, CLOCK pending - the pill
   * always spells the state out, so the glyph repeats it and the colour is never
   * the only signal. Pending used to draw a bare dot, which read as decoration
   * rather than as "not decided yet".
   */
  const statusIcon: IconName =
    meal.status === MealStatus.Done
      ? 'checkmark'
      : meal.status === MealStatus.Missed
        ? 'close'
        : 'time-outline';
  /** Fill + ink of the pill: the state colour on a wash of itself. */
  const pill = softPillColors(colors, meal.status);
  /**
   * The two state marks of the action strip. The button that matches the meal's
   * CURRENT state is disabled (pressing it again changes nothing) but keeps a
   * ring and a stronger wash, so the strip always shows which state the meal is in.
   */
  const missedSelected = meal.status === MealStatus.Missed;
  const doneSelected = meal.status === MealStatus.Done;
  const effectiveTime =
    meal.plannedTime ?? (category.defaultTime !== '' ? category.defaultTime : null);
  /** The photo strip's real width: 48 pt tiles and 4 pt gaps (see `PhotoGallery`). */
  const galleryWidth =
    photos.length * PHOTO_TILE + Math.max(0, photos.length - 1) * PHOTO_GAP;
  /**
   * Side-by-side is the approved phone layout. Only a genuinely narrow content
   * row - where the text column would drop under 120 pt - or very large text
   * moves the SAME horizontal strip below the text; it never becomes a vertical
   * stack, never hides the third photograph and never shrinks a target.
   */
  const stackGallery =
    photos.length > 0 &&
    (largeText ||
      (contentWidth > 0 && contentWidth < TEXT_MIN_WIDTH + TEXT_GALLERY_GAP + galleryWidth));

  /**
   * Chrome of the two editor fields: the CARD's own surface inside one 1 pt
   * outline, so the shallow box reads as a field on the white card (and on the
   * dark one) without a second grey fill. The floating label and its counter wear
   * the same fill, which is what lets them sit ON the border.
   */
  const fieldChrome = {
    borderColor: colors.border,
    backgroundColor: colors.cardFill,
  };
  /** Code-point counts - the same measure the guards use, never UTF-16. */
  const titleCount = characterCount(draftTitle);
  const descriptionCount = characterCount(draftIngredients);
  /**
   * The meal opened with text longer than this editor accepts (saved by Windows
   * or an older build). It stays INTACT; the hint only explains that it may be
   * kept or shortened, never that it must be rewritten to save a time change.
   */
  const overLimitText =
    titleCount > EDITOR_TITLE_LIMIT || descriptionCount > EDITOR_DESCRIPTION_LIMIT;

  /**
   * One accepted edit of a text field. An over-limit change - a keystroke or a
   * whole paste - is refused AS A WHOLE: the draft keeps its previous value and
   * the concise reason is shown. A change that merely keeps an existing longer
   * value, or shortens it, is accepted.
   */
  const changeText = (
    previous: string,
    next: string,
    limit: number,
    onChange: (value: string) => void,
    limitMessage: string,
  ): void => {
    if (!canAcceptTextChange(previous, next, limit)) {
      setLimitNotice(limitMessage);
      return;
    }
    setLimitNotice(null);
    onChange(next);
  };

  /**
   * The toolbar's tint: the reference's "nearly white" band - the CARD's own fill
   * with a whisper of the ink, far lighter than the control wash the old
   * full-bleed strip used. Scoped to the card; global buttons are untouched.
   */
  const toolbarFill = tintAlpha(colors.text, isDark ? '06' : '04');
  /**
   * Fill of the three "change the meal" tiles: a raised chip - card white in
   * light mode, the control wash on the dark card (where pure card fill would
   * disappear into the toolbar).
   */
  const toolFill = isDark ? colors.surfaceVariant : colors.cardFill;

  /**
   * Opens the editor on a FRESH session: the drafts come from the saved meal and
   * the 40/80 baseline snapshot is taken here - before a single keystroke - so a
   * longer saved value can later be saved unchanged or shortened, and a save can
   * always be judged against what the user actually opened.
   */
  const beginEdit = (): void => {
    editStartRef.current = { title: meal.title, ingredients: meal.ingredients };
    setDraftTitle(meal.title);
    setDraftIngredients(meal.ingredients);
    setDraftTime(effectiveTime !== null ? effectiveTime.slice(0, 5) : '');
    setLimitNotice(null);
    setErrorLine(null);
    setEditing(true);
    props.onEditingChange?.(meal.id, true);
  };

  // Opens the editor when the parent requests it (deep link from a
  // notification or the empty-content DONE dialog's Edit button).
  useEffect(() => {
    if (props.forceEditing === true) {
      beginEdit();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.forceEditing]);

  /**
   * The LATEST cancelEdit. The Cancel all registry is created once per meal
   * identity, so it must call through a ref - a captured `cancelEdit` would
   * restore the values the meal had when the card first mounted instead of the
   * ones it has now.
   */
  const cancelEditRef = useRef<() => void>(() => undefined);

  const cancelEdit = (): void => {
    setDraftTitle(meal.title);
    setDraftIngredients(meal.ingredients);
    setDraftTime(effectiveTime !== null ? effectiveTime.slice(0, 5) : '');
    setLimitNotice(null);
    setErrorLine(null);
    setEditing(false);
    props.onEditingChange?.(meal.id, false);
  };
  cancelEditRef.current = cancelEdit;

  /** Validates + persists the draft. Returns true when the card was written. */
  const runSave = async (): Promise<boolean> => {
    // ONE write at a time. A save that is already running finishes normally and
    // the duplicate tap is simply dropped, so a double press can never write the
    // record twice or interleave two validations of the same draft.
    if (saveBusyRef.current) {
      return true;
    }
    saveBusyRef.current = true;
    setSaving(true);
    props.onSavingChange?.(meal.id, true);
    try {
      const timeValue = draftTime.trim();
      let plannedTime: string | null = null;
      if (timeValue !== '') {
        const match = /^(\d{1,2}):(\d{2})$/.exec(timeValue);
        if (match === null || Number(match[1]) > 23 || Number(match[2]) > 59) {
          setErrorLine(t('Meal_InvalidTime'));
          return false;
        }
        plannedTime = `${match[1].padStart(2, '0')}:${match[2]}:00`;
      }
      const draft: MealEntry = {
        ...meal,
        title: draftTitle,
        ingredients: draftIngredients,
        plannedTime,
      };
      /**
       * The editor's 40/80 policy, enforced HERE as well as in the inputs so a
       * single Save and a dashboard "Save all" apply the same rule. It sits
       * BEFORE the domain validation on purpose: the domain keeps its wide
       * 120 / 2000 limits for imported and synced data, while this narrows only
       * what the phone writes. Unchanged or shortened longer text passes, so a
       * time-only edit never forces the user to rewrite a saved meal.
       */
      const opened = editStartRef.current;
      if (!isDraftLengthAllowed(opened.title, draftTitle, EDITOR_TITLE_LIMIT)) {
        setErrorLine(t('Rn_EditorTitleLimit'));
        return false;
      }
      if (!isDraftLengthAllowed(opened.ingredients, draftIngredients, EDITOR_DESCRIPTION_LIMIT)) {
        setErrorLine(t('Rn_EditorDescriptionLimit'));
        return false;
      }
      const validation = validateMealEntry(draft, true);
      if (!validation.isValid) {
        setErrorLine(localizedCode(validation.failures[0].code));
        return false;
      }
      const saveError = await props.onSave(draft);
      if (saveError !== null) {
        setErrorLine(saveError);
        return false;
      }
      setLimitNotice(null);
      setErrorLine(null);
      setEditing(false);
      props.onEditingChange?.(meal.id, false);
      return true;
    } catch (error) {
      // A rejected write (a database constraint, a full disk) must never look
      // like a dead button: the editor stays open, the reason is on the card and
      // the next tap can try again.
      console.warn('[meal card] the save was rejected', error);
      setErrorLine(t('Settings_SaveFailed'));
      return false;
    } finally {
      saveBusyRef.current = false;
      setSaving(false);
      props.onSavingChange?.(meal.id, false);
    }
  };

  const saveEdit = async (): Promise<void> => {
    await runSave();
  };

  // "Save all" from the dashboard: bump → save this card's open editor.
  editingRef.current = editing;
  savingRef.current = saving;

  // Register this card with the dashboard's Cancel all registry. Cleanup on
  // unmount or when meal identity changes (browsing to another day).
  useEffect(() => {
    if (!props.registerEditor) {
      return;
    }
    const commands = {
      id: meal.id,
      isEditing: () => editingRef.current,
      isSaving: () => savingRef.current,
      cancel: () => {
        // Update the ref synchronously BEFORE the callback so Cancel all's
        // synchronous protocol can never see a reopened draft. The write guard is
        // deliberately untouched: cancelOpenDrafts already refuses while a save is
        // in flight, so a RESTORE here could only mask a running write.
        editingRef.current = false;
        // Through the ref: the registry outlives this render, so the LATEST
        // persisted values are restored, never a stale closure's.
        cancelEditRef.current();
      },
    };
    const cleanup = props.registerEditor(meal.id, commands);
    return () => {
      if (cleanup !== undefined) {
        cleanup();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meal.id]);

  // "Save all" from the dashboard: bump → save this card's open editor.
  const saveAllSeen = useRef(props.saveAllTick ?? 0);
  useEffect(() => {
    const tick = props.saveAllTick ?? 0;
    if (tick === saveAllSeen.current) {
      return;
    }
    saveAllSeen.current = tick;
    if (!editingRef.current) {
      return;
    }
    void (async () => {
      const saved = await runSave();
      props.onBatchResult?.(meal.id, saved);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.saveAllTick]);

  return (
    <View
      style={[
        styles.card,
        mealCardShadow,
        {
          backgroundColor: colors.cardFill,
          borderColor: colors.border,
          minHeight: metrics.cardMinHeight,
        },
      ]}>
      {/*
       * The state rail: one 3 pt strip on the leading edge in the state colour.
       * The old card was framed by a full 1.5 pt green/red box, so five meals in
       * a row read as five alert boxes and the meat of the card - the meal - was
       * the quietest thing in it. The rail keeps the state at a glance, the pill
       * keeps it in words, and the card itself stays a calm white surface.
       */}
      {meal.status !== MealStatus.Pending && (
        <View style={[styles.rail, { backgroundColor: statusColor }]} />
      )}
      <View style={[styles.cardBody, editing && styles.cardBodyEditing]}>
      {/* header - no fill: the card keeps its surface and only the rail and the
          pill carry the state. Compact: a 36 pt glyph tile, the category at
          16 pt over a 12 pt time, and an 11 pt badge on the trailing edge. */}
      <View style={[styles.header, largeText && styles.headerStacked]}>
        <View style={[styles.identity, largeText && styles.identityStacked]}>
          <View style={[styles.iconTile, { backgroundColor: colors.surfaceVariant }]}>
            {/* The mockup's line icon for this meal, in the theme's ink - never the
                category's emoji, which every Android skin drew differently. */}
            <MaterialIcon
              name={mealCategoryGlyph(category.fixedCategoryKey)}
              size={MEAL_GLYPH_SIZE}
              color={colors.textSecondary}
            />
          </View>
          <View style={styles.headerText}>
            <Text style={[styles.headerTitle, { color: colors.text }]} numberOfLines={1}>
              {category.name !== '' ? category.name : t(mealNameKey(category.fixedCategoryKey))}
            </Text>
            {/* The planned time is the footer's job while the editor is open: the
                duplicate caption is hidden only for the edit session, so read mode
                keeps showing it and the header keeps its height. */}
            {!editing && (
              <Text style={[styles.headerTime, { color: colors.textMuted }]}>
                {formatTime(effectiveTime, use12HourClock)}
              </Text>
            )}
          </View>
        </View>
        <View style={[styles.pill, largeText && styles.pillStacked, { backgroundColor: pill.fill }]}>
          {/* The word is repeated by its glyph: clock pending, ✓ done, ✕ missed. */}
          <Icon name={statusIcon} size={14} color={pill.ink} />
          <Text style={[styles.pillText, { color: pill.ink }]}>{statusLabel}</Text>
        </View>
      </View>

      {errorLine !== null && (
        <Pressable
          accessibilityRole="button"
          onPress={() => setErrorLine(null)}
          style={[styles.error, { backgroundColor: colors.error }]}>
          <Text style={styles.errorText}>{errorLine}</Text>
        </Pressable>
      )}

      {editing ? (
        <View style={styles.editor}>
          {/* Compact editor: no heading of its own (the card's header keeps the
              category icon, the meal's name, the status pill and the rail - only
              its duplicate time caption is hidden while editing, because the time
              is edited in the footer), then two SHALLOW outlined fields whose
              label and counter ride the top border, then one footer on the card
              surface with the time chip and the two answers. The card's action
              strip is NOT drawn while the editor is open. */}
          <View style={styles.editorFields}>
            <View style={styles.fieldGroup}>
              {/* Floating caption: it sits ON the border, so the field needs no
                  label row of its own at normal text sizes. */}
              <View
                pointerEvents="none"
                style={[styles.fieldLabels, editorLabelsInFlow && styles.fieldLabelsInFlow]}>
                <Text
                  style={[
                    styles.fieldLabel,
                    { color: colors.textMuted, backgroundColor: colors.cardFill },
                  ]}>
                  {t('Rn_FieldMealName')}
                </Text>
                <Text
                  style={[
                    styles.fieldCounter,
                    {
                      color: titleCount > EDITOR_TITLE_LIMIT ? colors.warning : colors.textMuted,
                      backgroundColor: colors.cardFill,
                    },
                  ]}>
                  {`${titleCount}/${EDITOR_TITLE_LIMIT}`}
                </Text>
              </View>
              <Pressable
                accessible={false}
                onPress={() => titleRef.current?.focus()}
                style={[styles.fieldOutline, fieldChrome]}>
                <TextInput
                  ref={titleRef}
                  accessibilityLabel={t('Rn_FieldMealName')}
                  value={draftTitle}
                  editable={!saving}
                  onChangeText={(next) =>
                    changeText(
                      draftTitle,
                      next,
                      EDITOR_TITLE_LIMIT,
                      setDraftTitle,
                      t('Rn_EditorTitleLimit'),
                    )
                  }
                  // ONE line, natively scrolling: the text slides inside the
                  // shallow box instead of growing the card. There is deliberately
                  // no native maxLength - it counts UTF-16, disagrees with the
                  // code-point guard above and could cut a paste before the guard
                  // ever sees it.
                  multiline={false}
                  autoCorrect
                  returnKeyType="next"
                  onSubmitEditing={() => descriptionRef.current?.focus()}
                  placeholder={t('Rn_FieldMealName')}
                  placeholderTextColor={colors.textMuted}
                  style={[
                    styles.fieldInput,
                    { color: colors.text },
                    { minHeight: Math.max(EDITOR_FIELD_MIN_HEIGHT, Math.ceil(32 * fontScale)) },
                  ]}
                />
              </Pressable>
            </View>
            <View style={styles.fieldGroup}>
              <View
                pointerEvents="none"
                style={[styles.fieldLabels, editorLabelsInFlow && styles.fieldLabelsInFlow]}>
                <Text
                  style={[
                    styles.fieldLabel,
                    { color: colors.textMuted, backgroundColor: colors.cardFill },
                  ]}>
                  {t('Rn_FieldDescription')}
                </Text>
                <Text
                  style={[
                    styles.fieldCounter,
                    {
                      color:
                        descriptionCount > EDITOR_DESCRIPTION_LIMIT
                          ? colors.warning
                          : colors.textMuted,
                      backgroundColor: colors.cardFill,
                    },
                  ]}>
                  {`${descriptionCount}/${EDITOR_DESCRIPTION_LIMIT}`}
                </Text>
              </View>
              <Pressable
                accessible={false}
                onPress={() => descriptionRef.current?.focus()}
                style={[styles.fieldOutline, fieldChrome]}>
                <TextInput
                  ref={descriptionRef}
                  accessibilityLabel={t('Rn_FieldDescription')}
                  value={draftIngredients}
                  editable={!saving}
                  onChangeText={(next) =>
                    changeText(
                      draftIngredients,
                      next,
                      EDITOR_DESCRIPTION_LIMIT,
                      setDraftIngredients,
                      t('Rn_EditorDescriptionLimit'),
                    )
                  }
                  multiline={false}
                  autoCorrect
                  returnKeyType="done"
                  onSubmitEditing={() => timeRef.current?.focus()}
                  placeholder={t('Rn_FieldDescription')}
                  placeholderTextColor={colors.textMuted}
                  style={[
                    styles.fieldInput,
                    { color: colors.text },
                    { minHeight: Math.max(EDITOR_FIELD_MIN_HEIGHT, Math.ceil(32 * fontScale)) },
                  ]}
                />
              </Pressable>
            </View>
          </View>
          {/* The editor's own feedback: a refused change first, otherwise the
              quiet note that an already-longer value is being preserved. Both are
              one short line under the fields - never a second status flow. */}
          {limitNotice !== null && (
            <Text
              accessibilityRole="alert"
              accessibilityLiveRegion="polite"
              style={[styles.editorHint, { color: colors.error }]}>
              {limitNotice}
            </Text>
          )}
          {limitNotice === null && overLimitText && (
            <Text style={[styles.editorHint, { color: colors.warning }]}>
              {t('Rn_EditorLegacyHint')}
            </Text>
          )}
          {/* Footer on the CARD's own surface (no tinted band): the clock + time
              chip on the LEFT, Cancel / Save on the RIGHT, 8 pt apart. Every
              control is a real 48/44 dp target around a 30 dp visible face whose
              WIDTH is its own content plus the shared 5 dp side padding — so a
              short label keeps a short face and the lower pair stays narrower
              than the top one. Save and Save all use the accent family (the same
              resting wash as time), Cancel uses the red cancel family. A narrow
              card or the largest text sizes stack the answers under the time
              instead of squeezing it. */}
          <View style={[styles.editorFoot, editorFooterStacked && styles.editorFootStacked]}>
            {/* Hidden measuring copy of the value: the chip is sized to what the
                user actually sees ("HH:MM" while the field is empty) instead of a
                fixed slot. Absolutely positioned, so it reserves no space. */}
            <View
              pointerEvents="none"
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              style={styles.timeMeasure}>
              <View style={styles.timeMeasureInner}>
                <Text
                  key={`${timeDisplayed}:${fontScale}`}
                  accessible={false}
                  style={[styles.timeMeasureText, { color: colors.text }]}
                  onLayout={(event) => {
                    const next = Math.ceil(event.nativeEvent.layout.width);
                    if (next > 0) {
                      setTimeTextWidth((old) => (old === next ? old : next));
                    }
                  }}>
                  {timeDisplayed}
                </Text>
              </View>
            </View>
            <Pressable
              accessible={false}
              onPress={() => timeRef.current?.focus()}
              style={[
                styles.timeTarget,
                { minHeight: Platform.OS === 'ios' ? EDITOR_BUTTON_MIN_HEIGHT_IOS : EDITOR_BUTTON_MIN_HEIGHT_ANDROID },
              ]}>
              <View
                style={[
                  styles.timeChip,
                  {
                    borderColor: accentActionColors(colors).border,
                    backgroundColor: accentActionColors(colors).fill,
                    // Focus indication without moving the row: the border thickens.
                    borderWidth: timeBorderWidth,
                    width: timeFaceWidth,
                  },
                ]}>
                <Icon
                  name="time-outline"
                  size={EDITOR_TIME_ICON_SIZE}
                  color={accentActionColors(colors).foreground}
                />
                <TextInput
                  ref={timeRef}
                  accessibilityLabel={t('Rn_FieldPlannedTime')}
                  // The mask below makes the value a time and nothing else, and the
                  // field is exactly as wide as the measured value, so the chip
                  // never stretches the row.
                  style={[
                    styles.timeInput,
                    {
                      color: colors.text,
                      width: timeInputWidth,
                      // Grows with the system text instead of clipping it.
                      minHeight: Math.max(
                        EDITOR_CONTROL_MIN_HEIGHT - 2,
                        Math.ceil(24 * fontScale),
                      ),
                    },
                  ]}
                  value={draftTime}
                  editable={!saving}
                  onChangeText={(text) => setDraftTime(timeDraft(text))}
                  onFocus={() => setTimeFocused(true)}
                  onBlur={() => setTimeFocused(false)}
                  placeholder="HH:MM"
                  placeholderTextColor={colors.textMuted}
                  // iOS can type the colon (numbers-and-punctuation); Android's number
                  // pad cannot, so the mask inserts it automatically.
                  keyboardType={Platform.OS === 'ios' ? 'numbers-and-punctuation' : 'number-pad'}
                  maxLength={TIME_MAX_LENGTH}
                  autoCorrect={false}
                />
              </View>
            </Pressable>
            <View style={[styles.editorActions, editorFooterStacked && styles.editorActionsStacked]}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('Common_Cancel')}
                accessibilityState={{ disabled: saving }}
                disabled={saving}
                onPress={cancelEdit}
                style={[styles.controlTarget, saving && styles.subdued]}>
                {({ pressed }) => {
                  const cancel = cancelActionColors(colors, pressed);
                  return (
                    <View
                      style={[
                        styles.control,
                        !editorFooterStacked && styles.controlToTrailing,
                        {
                          borderColor: cancel.border,
                          backgroundColor: cancel.fill,
                        },
                      ]}>
                      <Text style={[styles.controlLabel, { color: cancel.foreground }]}>
                        {t('Common_Cancel')}
                      </Text>
                    </View>
                  );
                }}
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('Common_Save')}
                accessibilityState={{ disabled: saving, busy: saving }}
                disabled={saving}
                onPress={() => void saveEdit()}
                style={[styles.controlTarget, saving && styles.subdued]}>
                {({ pressed }) => {
                  const action = accentActionColors(colors, pressed);
                  return (
                    <View
                      style={[
                        styles.control,
                        !editorFooterStacked && styles.controlToLeading,
                        {
                          borderColor: action.border,
                          backgroundColor: action.fill,
                        },
                      ]}>
                      <Text style={[styles.controlLabel, { color: action.foreground }]}>
                        {t('Common_Save')}
                      </Text>
                    </View>
                  );
                }}
              </Pressable>
            </View>
          </View>
        </View>
      ) : (
        /* Read mode: the meal text on the LEFT and the SAME horizontal photo
           strip on the RIGHT. The row measures itself, and only a genuinely
           squeezed text column (or very large text) drops the strip below. */
        <View
          onLayout={(event) => setContentWidth(event.nativeEvent.layout.width)}
          style={[styles.content, stackGallery && styles.contentStacked]}>
          <View style={[styles.textColumn, stackGallery && styles.textColumnStacked]}>
            {meal.title !== '' && (
              <Text
                style={[styles.title, { color: colors.text }]}
                numberOfLines={largeText ? undefined : 2}>
                {meal.title}
              </Text>
            )}
            {meal.ingredients !== '' && (
              <Text
                style={[styles.description, { color: colors.textMuted }]}
                numberOfLines={largeText ? undefined : 3}>
                {meal.ingredients}
              </Text>
            )}
            {/* Nothing typed yet: the quiet placeholder says why. A card that
                already HAS photographs is not "empty", so it says so instead of
                claiming no meal was recorded. */}
            {meal.title === '' && meal.ingredients === '' && (
              <Text style={[styles.emptyText, { color: colors.textMuted }]}>
                {photos.length > 0 ? t('Rn_MealPhotoOnly') : t('Rn_MealEmpty')}
              </Text>
            )}
          </View>
          <PhotoGallery
            photos={photos}
            colors={colors}
            uploading={props.uploadingPhoto === true}
            onOpen={props.onOpenPhoto}
          />
        </View>
      )}
      </View>
      {/* ONE 1 pt rule, inset 14 pt from both card edges, immediately before the
          toolbar - never a full-bleed band and never a doubled line. */}
      {!editing && (
        <View style={[styles.divider, { backgroundColor: colors.cardDivider }]} />
      )}
      {/* The toolbar: the five tools on a nearly-white tint (lighter than the old
          gray band), grouped camera / edit / clear | missed / done behind one
          short separator. Every tool is a real 44 pt pressable. */}
      {!editing && (
        <View style={[styles.toolbar, { backgroundColor: toolbarFill }]}>
          <View style={styles.toolGroup}>
            <CardTool
              label={t('Photo_Add')}
              onPress={() => props.onAddPhoto(meal)}
              disabled={photos.length >= MAX_PHOTOS_PER_MEAL || props.uploadingPhoto === true}
              fill={toolFill}
              borderColor={colors.cardDivider}>
              <Icon name="camera-outline" size={CARD_TOOL_GLYPH} color={colors.text} />
            </CardTool>
            <CardTool
              label={t('Common_Edit')}
              onPress={beginEdit}
              fill={toolFill}
              borderColor={colors.cardDivider}>
              <FeatherIcon name="edit" size={CARD_TOOL_GLYPH} color={colors.text} />
            </CardTool>
            <CardTool
              label={t('Meal_Clear')}
              onPress={() => props.onClear(meal)}
              disabled={empty}
              fill={toolFill}
              borderColor={colors.cardDivider}>
              <FeatherIcon name="trash-2" size={CARD_TOOL_GLYPH} color={colors.text} />
            </CardTool>
          </View>
          {/* The short separator: "change the meal" | "decide it". */}
          <View style={[styles.toolSeparator, { backgroundColor: colors.cardDivider }]} />
          <View style={styles.markGroup}>
            <CardTool
              label={t('Meal_MarkMissed')}
              onPress={() => void props.onMissed(meal)}
              disabled={future || missedSelected || !canConfirm}
              fill={stateWash(colors.missed, missedSelected, isDark)}
              borderColor={colors.cardDivider}
              ring={missedSelected ? colors.missed : undefined}>
              <Icon name="close" size={CARD_TOOL_GLYPH} color={colors.missed} />
            </CardTool>
            <CardTool
              label={t('Meal_MarkDone')}
              onPress={() => void props.onComplete(meal)}
              disabled={future || doneSelected || !canConfirm}
              fill={stateWash(colors.done, doneSelected, isDark)}
              borderColor={colors.cardDivider}
              ring={doneSelected ? colors.done : undefined}>
              <Icon name="checkmark" size={CARD_TOOL_GLYPH} color={colors.done} />
            </CardTool>
          </View>
        </View>
      )}
    </View>
  );
}

/**
 * Fill of a state mark on the action strip: a wash of the state colour, a step
 * stronger when the meal is IN that state - so the answer is visible even though
 * the button is then disabled.
 */
function stateWash(color: string, selected: boolean, isDark: boolean): string {
  if (selected) {
    return tintAlpha(color, isDark ? '4D' : '33');
  }
  return tintAlpha(color, isDark ? '2E' : '1A');
}

/**
 * One button of the card's toolbar: a REAL 44 pt pressable holding a 36 pt
 * outlined tile with a 20 pt glyph. The pressable is the touch target itself, so
 * two neighbouring tools can sit 2 pt apart without their hit slops overlapping.
 * The three "change the meal" tools sit on a raised chip; the two state marks sit
 * on a wash of their own colour, and the one matching the meal's current state
 * keeps a ring - see `stateWash`.
 */
function CardTool(props: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  /** Background of the visible tile. */
  fill: string;
  /** 1 pt frame of the visible tile (the state colour overrides it). */
  borderColor: string;
  /** 1 pt ring marking the meal's CURRENT state; undefined draws no ring. */
  ring?: string;
  children: React.ReactNode;
}): React.JSX.Element {
  const disabled = props.disabled === true;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.label}
      accessibilityState={{ disabled, selected: props.ring !== undefined }}
      disabled={disabled}
      onPress={props.onPress}
      style={({ pressed }) => [
        styles.toolTouch,
        {
          // A disabled tool fades - unless it is the meal's own state, which is an
          // answer rather than a dead control.
          opacity: disabled && props.ring === undefined ? 0.45 : pressed ? 0.65 : 1,
        },
      ]}>
      <View
        style={[
          styles.toolTile,
          {
            backgroundColor: props.fill,
            borderColor: props.ring ?? props.borderColor,
          },
        ]}>
        {props.children}
      </View>
    </Pressable>
  );
}

/**
 * Card elevation for meal cards only: the reference's SOFTER lift (a 2 pt drop
 * with a 6 pt blur) instead of the app-wide `cardShadow` (6 pt / 16 pt), which
 * made five stacked cards read as five heavy tiles. Other pages keep their own.
 */
const mealCardShadow: ViewStyle = (Platform.select({
  ios: {
    shadowColor: '#0B1220',
    shadowOpacity: 0.05,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
  },
  android: { elevation: 1 },
  default: {},
}) ?? {}) as ViewStyle;

const styles = StyleSheet.create({
  card: {
    borderRadius: metrics.radius,
    // Neutral hairline; the state lives on the rail and in the pill.
    borderWidth: metrics.cardBorder,
    flexGrow: 1,
    flexBasis: '100%',
  },
  /** Leading state strip, inset so it follows the rounded corners visually. */
  rail: {
    position: 'absolute',
    left: 0,
    top: 12,
    bottom: 12,
    width: metrics.statusRail,
    borderTopRightRadius: metrics.statusRail,
    borderBottomRightRadius: metrics.statusRail,
  },
  /**
   * The card's padded body: the reference's 14 pt inset on every side, with the
   * same 12 pt of air below the content before the rule. It grows, so two cards
   * side by side keep their toolbars level at the bottom edge.
   */
  cardBody: { padding: 14, paddingBottom: 12, flexGrow: 1 },
  /**
   * An OPEN editor's body: the same 14 dp top/side inset, fields, counters, time
   * and status kept - but no 12 dp tail below the footer (the footer's targets
   * carry their own slack) and no growing, so the card hugs its editor instead of
   * trailing empty body. Only ever applied while editing; READ cards keep the
   * body above and the toolbar below untouched.
   */
  cardBodyEditing: { paddingBottom: 2, flexGrow: 0 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    columnGap: 10,
  },
  /** Very large text: the badge drops under the identity instead of squeezing it. */
  headerStacked: { flexDirection: 'column', alignItems: 'stretch' },
  /** Icon tile + category/time: the piece that stays one row. */
  identity: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', columnGap: 10 },
  identityStacked: { flex: 0 },
  /** Emoji sit on a soft tile so they align with the text block, not beside it. */
  iconTile: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerText: { flex: 1, minWidth: 0 },
  headerTitle: { fontSize: 16, fontFamily: fonts.medium, lineHeight: 21 },
  headerTime: { fontSize: 12, lineHeight: 16, marginTop: 2 },
  /** Compact 11 pt capsule badge, always on the trailing edge. */
  pill: {
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    columnGap: 4,
    borderRadius: 20,
    paddingHorizontal: 8,
    paddingVertical: 4,
    flexShrink: 0,
  },
  /** Stacked: aligned under the category text, not under the glyph tile. */
  pillStacked: { alignSelf: 'flex-start', marginLeft: 36 + 10 },
  pillText: { fontSize: 11, fontFamily: fonts.medium },
  error: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 6, marginTop: 8 },
  errorText: { color: argb('#FFFFFFFF'), fontSize: 12 },
  /**
   * Read-mode content: text (flexible left) beside the SAME horizontal photo
   * strip (right), 12 pt apart, 12 pt below the header.
   */
  content: { flexDirection: 'row', alignItems: 'flex-start', columnGap: TEXT_GALLERY_GAP, marginTop: 12 },
  /** Narrow content row or very large text: the strip moves below the text. */
  contentStacked: { flexDirection: 'column', alignItems: 'stretch' },
  textColumn: { flex: 1, minWidth: 0 },
  textColumnStacked: { flex: 0, width: '100%' },
  title: { fontSize: 16, lineHeight: 22, fontFamily: fonts.medium },
  description: { fontSize: 13, lineHeight: 18, marginTop: 3 },
  emptyText: { fontSize: 12 },
  /** ONE 1 pt rule, inset 14 pt from both card edges, right above the toolbar. */
  divider: { height: 1, marginHorizontal: 14 },
  /**
   * The toolbar: the five tools on a nearly-white tint (lighter than the old gray
   * band), 10 pt side padding, 4 pt vertical padding, and the bottom corners
   * following the card. The two groups sit 2 pt apart internally; the short
   * separator keeps `CARD_TOOLBAR_GAP` on both sides.
   */
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    columnGap: CARD_TOOLBAR_GAP,
    paddingHorizontal: CARD_STRIP_PADDING,
    paddingVertical: 4,
    borderBottomLeftRadius: metrics.radius - 1,
    borderBottomRightRadius: metrics.radius - 1,
  },
  /** Left group: change the meal (photo, edit, clear). */
  toolGroup: { flexDirection: 'row', alignItems: 'center', columnGap: CARD_TOOL_GAP },
  /**
   * The short separator between "change the meal" and "decide it". The auto left
   * margin takes all the free space, so the line sits against the marks it
   * separates them from.
   */
  toolSeparator: {
    width: 1,
    height: CARD_TOOLBAR_SEPARATOR_HEIGHT,
    marginLeft: 'auto',
  },
  /** Right group: decide the meal (missed, done). */
  markGroup: { flexDirection: 'row', alignItems: 'center', columnGap: CARD_TOOL_GAP },
  /** The real, non-overlapping 44 pt touch target around each visible tile. */
  toolTouch: {
    width: CARD_TOOL_TOUCH,
    height: CARD_TOOL_TOUCH,
    alignItems: 'center',
    justifyContent: 'center',
  },
  /** The visible tile: 36 pt, 10 pt corner, 1 pt frame - see `CardTool`. */
  toolTile: {
    width: CARD_TOOL_SIZE,
    height: CARD_TOOL_SIZE,
    borderRadius: CARD_TOOL_RADIUS,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  /**
   * The compact editor's own body: 12 pt above the first field, and the card's
   * existing 14 / 12 pt inset around it - no extra floor, so the open editor
   * stays close to the height of the card it replaces.
   */
  editor: { marginTop: EDITOR_TOP_GAP },
  /** Two shallow fields, 12 pt apart. */
  editorFields: { rowGap: EDITOR_FIELD_GAP },
  /**
   * One field: the floating caption row is absolutely placed ON the top border,
   * so the field itself needs no label row at normal text sizes.
   */
  fieldGroup: { position: 'relative' },
  fieldLabels: {
    position: 'absolute',
    top: EDITOR_LABEL_TOP,
    left: 8,
    right: 8,
    zIndex: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    columnGap: 8,
  },
  /** Enlarged text: the caption and the counter move into normal flow. */
  fieldLabelsInFlow: { position: 'relative', top: 0, left: 0, right: 0, marginBottom: 4 },
  fieldLabel: {
    fontFamily: fonts.regular,
    fontSize: EDITOR_LABEL_SIZE,
    lineHeight: 14,
    paddingHorizontal: 4,
    flexShrink: 1,
  },
  /** The live counter (code points, see `mealEditorLimits`). */
  fieldCounter: {
    fontFamily: fonts.regular,
    fontSize: EDITOR_LABEL_SIZE,
    lineHeight: 14,
    paddingHorizontal: 4,
    fontVariant: ['tabular-nums'],
  },
  /** The 1 pt outline of a shallow field: 44 pt minimum, 10 pt corner. */
  fieldOutline: {
    minHeight: EDITOR_FIELD_MIN_HEIGHT,
    borderWidth: 1,
    borderRadius: EDITOR_FIELD_RADIUS,
    justifyContent: 'center',
  },
  /**
   * The single-line input inside that outline. It scrolls horizontally, so the
   * box never grows while the user types; the height floor rises with the system
   * text size instead of clipping a larger font.
   */
  fieldInput: {
    fontFamily: fonts.regular,
    fontSize: EDITOR_FIELD_TEXT_SIZE,
    lineHeight: EDITOR_FIELD_LINE_HEIGHT,
    paddingHorizontal: EDITOR_FIELD_PADDING,
    paddingTop: 10,
    paddingBottom: 8,
  },
  /** The editor's one-line feedback: refused change, or the legacy note. */
  editorHint: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 16, marginTop: 6 },
  /** Time target left, Cancel / Save right, on the card surface (no tinted band). */
  editorFoot: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    columnGap: EDITOR_BUTTON_GAP,
    marginTop: EDITOR_FOOTER_GAP,
  },
  /** Narrow card or the largest text sizes: the answers drop under the time. */
  editorFootStacked: { flexDirection: 'column', alignItems: 'stretch' },
  /** The real touch target behind the smaller visible clock chip (platform-dependent). */
  timeTarget: { justifyContent: 'center', alignItems: 'center', minWidth: EDITOR_TARGET_MIN },
  /**
   * Clock + time: 30 dp tall accent-outlined chip, 8 pt corners. Its WIDTH is the
   * measured value plus the clock, its 2 dp gap, the shared 5 dp side padding and
   * the border — there is no fixed slot, so the row is not padded by accident.
   */
  timeChip: {
    minHeight: EDITOR_CONTROL_MIN_HEIGHT,
    borderWidth: 1,
    borderRadius: EDITOR_CONTROL_RADIUS,
    flexDirection: 'row',
    alignItems: 'center',
    columnGap: EDITOR_TIME_ICON_GAP,
    paddingHorizontal: EDITOR_CONTROL_PADDING_X,
  },
  /**
   * The typed value. Native TextInput padding is ZERO on purpose: the 5 dp inset
   * lives on the chip, so nothing is added after the last digit and the caret
   * sits exactly where the measured text ends.
   */
  timeInput: {
    paddingVertical: 0,
    paddingHorizontal: 0,
    fontFamily: fonts.regular,
    fontSize: EDITOR_TIME_TEXT_SIZE,
    fontVariant: ['tabular-nums'],
  },
  /** Hidden copy of the value: measures it without reserving any space. */
  timeMeasure: {
    position: 'absolute',
    opacity: 0,
    width: 0,
    height: 0,
    overflow: 'hidden',
    left: 0,
    top: 0,
  },
  timeMeasureInner: { width: 10000 },
  timeMeasureText: {
    fontFamily: fonts.regular,
    fontSize: EDITOR_TIME_TEXT_SIZE,
    fontVariant: ['tabular-nums'],
    alignSelf: 'flex-start',
  },
  editorActions: { flexDirection: 'row', alignItems: 'center', columnGap: EDITOR_BUTTON_GAP },
  editorActionsStacked: { justifyContent: 'flex-end' },
  /**
   * The four answers' touch targets: a real 48/44 dp area around the visible
   * face. `alignItems: 'center'` is what keeps a SHORT face short — the target
   * never stretches the face to its own width.
   */
  controlTarget: {
    justifyContent: 'center',
    alignItems: 'center',
    minWidth: EDITOR_TARGET_MIN,
    minHeight: EDITOR_TARGET_MIN,
  },
  /** A save in flight: the whole control is subdued, never recoloured. */
  subdued: { opacity: 0.5 },
  /**
   * The visible answer: 30 pt tall with 8 pt corners and 12 sp regular ink, and
   * its OWN content width — measured text plus the shared 5 dp side padding and
   * the border. Save uses the accent wash; Cancel uses the red cancel family.
   */
  control: {
    minHeight: EDITOR_CONTROL_MIN_HEIGHT,
    borderWidth: 1,
    borderRadius: EDITOR_CONTROL_RADIUS,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: EDITOR_CONTROL_PADDING_X,
    paddingVertical: 4,
  },
  controlLabel: {
    fontFamily: fonts.regular,
    fontSize: EDITOR_CONTROL_TEXT_SIZE,
    lineHeight: EDITOR_CONTROL_LINE_HEIGHT,
    textAlign: 'center',
  },
  /**
   * Row layout only: each face hugs the edge of its OWN touch target that faces
   * its partner - trailing for Cancel, leading for Save (logical start/end, so
   * RTL flips with the row). The target keeps its 48/44 dp minimum, so the slack
   * a short face leaves (Save is thinner than Cancel) falls OUTSIDE the pair and
   * the two visible outlines stay exactly EDITOR_BUTTON_GAP apart, instead of
   * that gap plus the wrapper's inner slack. Stacked mode passes neither, so
   * both faces stay centred there.
   */
  controlToTrailing: { alignSelf: 'flex-end' },
  controlToLeading: { alignSelf: 'flex-start' },
});