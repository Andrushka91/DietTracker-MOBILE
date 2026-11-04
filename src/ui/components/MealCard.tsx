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
 * then a footer 6 pt below them. Every footer control is a real 44 pt target
 * around a SMALLER neutral outline (36 pt), so the answers stay quiet on the
 * card's own surface while remaining comfortable to tap.
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
const EDITOR_FOOTER_GAP = 6;
/** Normal width of the clock + time chip; it widens with the system text size. */
export const EDITOR_TIME_WIDTH = 84;
const EDITOR_TIME_TEXT_SIZE = 14;
const EDITOR_CANCEL_MIN_WIDTH = 64;
const EDITOR_SAVE_MIN_WIDTH = 56;
const EDITOR_BUTTON_GAP = 6;
/** The real touch target around every footer control. */
const EDITOR_BUTTON_MIN_HEIGHT = 44;
/**
 * The visible neutral outline inside that target: 36 pt tall, 8 pt corners and
 * 13 pt regular ink - the same quiet control family as "Apply to date" on the
 * templates page. There is deliberately no accent fill on this card.
 */
const EDITOR_CONTROL_MIN_HEIGHT = 36;
const EDITOR_CONTROL_RADIUS = 8;
const EDITOR_CONTROL_TEXT_SIZE = 13;
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

  const cancelEdit = (): void => {
    setDraftTitle(meal.title);
    setDraftIngredients(meal.ingredients);
    setDraftTime(effectiveTime !== null ? effectiveTime.slice(0, 5) : '');
    setLimitNotice(null);
    setErrorLine(null);
    setEditing(false);
    props.onEditingChange?.(meal.id, false);
  };

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
    }
  };

  const saveEdit = async (): Promise<void> => {
    await runSave();
  };

  // "Save all" from the dashboard: bump → save this card's open editor.
  const editingRef = useRef(false);
  editingRef.current = editing;
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
      <View style={styles.cardBody}>
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
              chip on the LEFT, Cancel / Save on the RIGHT, 6 pt apart. Every
              control is a real 44 pt target around a 36 pt NEUTRAL outline - the
              card's own surface inside a thin border, normal ink, no accent fill.
              A narrow card or the largest text sizes stack the answers under the
              time instead of squeezing it. */}
          <View style={[styles.editorFoot, editorFooterStacked && styles.editorFootStacked]}>
            <Pressable
              accessible={false}
              onPress={() => timeRef.current?.focus()}
              style={styles.timeTarget}>
              <View
                style={[
                  styles.timeChip,
                  {
                    borderColor: colors.border,
                    backgroundColor: colors.cardFill,
                    // A MINIMUM width: it widens with the system text size.
                    width: Math.max(EDITOR_TIME_WIDTH, Math.ceil(68 * fontScale)),
                  },
                ]}>
                <Icon name="time-outline" size={15} color={colors.textSecondary} />
                <TextInput
                  ref={timeRef}
                  accessibilityLabel={t('Rn_FieldPlannedTime')}
                  // The mask below makes the value a time and nothing else; the chip
                  // is only as wide as "HH:MM" needs, so it never stretches the row.
                  style={[
                    styles.timeInput,
                    { color: colors.text },
                    // Grows with the system text instead of clipping it.
                    {
                      minHeight: Math.max(
                        EDITOR_CONTROL_MIN_HEIGHT - 2,
                        Math.ceil(26 * fontScale),
                      ),
                    },
                  ]}
                  value={draftTime}
                  editable={!saving}
                  onChangeText={(text) => setDraftTime(timeDraft(text))}
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
                style={[
                  styles.controlTarget,
                  styles.cancelTarget,
                  saving && styles.subdued,
                ]}>
                {({ pressed }) => (
                  <View
                    style={[
                      styles.control,
                      {
                        borderColor: colors.border,
                        backgroundColor: pressed ? colors.surfaceVariant : colors.cardFill,
                      },
                    ]}>
                    <Text style={[styles.controlLabel, { color: colors.text }]} numberOfLines={1}>
                      {t('Common_Cancel')}
                    </Text>
                  </View>
                )}
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('Common_Save')}
                accessibilityState={{ disabled: saving, busy: saving }}
                disabled={saving}
                onPress={() => void saveEdit()}
                style={[
                  styles.controlTarget,
                  styles.saveTarget,
                  saving && styles.subdued,
                ]}>
                {({ pressed }) => (
                  <View
                    style={[
                      styles.control,
                      {
                        borderColor: colors.border,
                        backgroundColor: pressed ? colors.surfaceVariant : colors.cardFill,
                      },
                    ]}>
                    <Text style={[styles.controlLabel, { color: colors.text }]} numberOfLines={1}>
                      {t('Common_Save')}
                    </Text>
                  </View>
                )}
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
  /** The real 44 pt target behind the smaller visible clock chip. */
  timeTarget: { minHeight: EDITOR_BUTTON_MIN_HEIGHT, justifyContent: 'center' },
  /**
   * Clock + time: 36 pt tall neutral outline, 8 pt corners, 84 pt wide at the
   * default scale (a minimum - it grows with the system text size).
   */
  timeChip: {
    minHeight: EDITOR_CONTROL_MIN_HEIGHT,
    borderWidth: 1,
    borderRadius: EDITOR_CONTROL_RADIUS,
    flexDirection: 'row',
    alignItems: 'center',
    columnGap: 4,
    paddingHorizontal: 6,
  },
  timeInput: {
    flex: 1,
    minWidth: 0,
    paddingVertical: 3,
    paddingHorizontal: 0,
    fontFamily: fonts.regular,
    fontSize: EDITOR_TIME_TEXT_SIZE,
    fontVariant: ['tabular-nums'],
  },
  editorActions: { flexDirection: 'row', alignItems: 'center', columnGap: EDITOR_BUTTON_GAP },
  editorActionsStacked: { justifyContent: 'flex-end' },
  /** The two answers' touch targets: 44 pt tall, centred on the visible control. */
  controlTarget: { minHeight: EDITOR_BUTTON_MIN_HEIGHT, justifyContent: 'center' },
  /** A save in flight: the whole control is subdued, never recoloured. */
  subdued: { opacity: 0.5 },
  /** Cancel 64 pt / Save 56 pt - MINIMUM widths, so longer labels can grow. */
  cancelTarget: { minWidth: EDITOR_CANCEL_MIN_WIDTH },
  saveTarget: { minWidth: EDITOR_SAVE_MIN_WIDTH },
  /**
   * The visible answer: the card's own surface inside a 1 pt neutral border,
   * 36 pt tall with 8 pt corners and normal 13 pt ink. No accent fill.
   */
  control: {
    width: '100%',
    minHeight: EDITOR_CONTROL_MIN_HEIGHT,
    borderWidth: 1,
    borderRadius: EDITOR_CONTROL_RADIUS,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  controlLabel: { fontFamily: fonts.regular, fontSize: EDITOR_CONTROL_TEXT_SIZE },
});