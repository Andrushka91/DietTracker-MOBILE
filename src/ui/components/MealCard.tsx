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
//  editor: no heading of its own - three labelled 44 pt fields (Meal name,
//          Description, then Planned time in the tinted footer beside Cancel /
//          Save). The Description box starts at ONE row and grows to two when the
//          text needs it; validation failures land on the card error line and
//          Cancel resets only this card's draft. The action strip is not drawn
//          while the editor is open.

import React, { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { MealStatus } from '../../domain/enums';
import { MealCategory, MealEntry, MealPhoto } from '../../domain/models';
import { isFutureMeal } from '../../domain/rules/completionRules';
import { hasMealText, hasUserContent } from '../../domain/rules/mealContentRules';
import { validateMealEntry } from '../../domain/validation';
import { formatTime, mealNameKey, t } from '../strings';
import { argb, cardShadow, fonts, metrics, softPillColors, themeColors, tintAlpha } from '../theme';
import { BarButton, localizedCode } from './buttons';
import { FeatherIcon, Icon, MaterialIcon, type IconName } from './icons';
import { MEAL_GLYPH_SIZE, mealCategoryGlyph } from '../mealGlyphs';
import { MeasuredInput } from './MeasuredInput';
import { PhotoGallery } from './PhotoGallery';

/**
 * The notes box starts SHALLOW - one row - and grows to two only when the text
 * needs the second line. `MeasuredInput` lays the current text out invisibly,
 * reports the real row count and refuses the change that would need a third row,
 * so the box never overflows and never reserves an empty second line: the limit is
 * the real width of the field, not an estimate.
 */
const NOTES_ROWS = 2;

/** The meal name lives on one row for the same reason. */
const TITLE_ROWS = 1;

/** Must match `styles.field.paddingHorizontal`: the ruler subtracts it. */
const FIELD_PADDING = 10;

/** Field typography, shared by the input and its invisible measuring copy. */
const FIELD_TEXT = { fontSize: 14, lineHeight: 18 } as const;

/** Vertical chrome of an editor field, above and below the text. */
const FIELD_PADDING_V = 8;

/**
 * Height of a single-line editor field: 44 pt, which is also the app's minimum
 * touch target - the compact chip the reference draws.
 */
export const FIELD_HEIGHT = 44;

/** Two rows of notes: exactly the text (2 x 18 pt) plus that padding (52 pt). */
export const NOTES_HEIGHT = FIELD_TEXT.lineHeight * NOTES_ROWS + FIELD_PADDING_V * 2;

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
 * The meal card's ACTION STRIP, measured off the reference card: the same five
 * tools (camera, edit, clear, missed, done) as 20 pt glyphs on VISIBLE 40 pt tiles
 * that sit 6 pt apart, each with a 2 pt hit slop - so the tile reads as a compact
 * button while the thumb still gets a 44 pt target.
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
/**
 * One button of the action strip: a 40 pt visible tile with a 2 pt hit slop on
 * every side, so the TARGET is the 44 pt the guidelines ask for while five tiles
 * and their divider still fit a narrow card.
 */
export const CARD_TOOL_SIZE = 40;
export const CARD_TOOL_TOUCH = 44;
export const CARD_TOOL_HIT_SLOP = (CARD_TOOL_TOUCH - CARD_TOOL_SIZE) / 2;
export const CARD_TOOL_GAP = 6;
/**
 * The action strip's own side padding. The single divider keeps exactly this much
 * air on its right - the same air the strip keeps on its right edge - so the line
 * belongs to the "decide it" group instead of floating in the middle of the strip.
 */
export const CARD_STRIP_PADDING = 10;

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
  const [editing, setEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState(meal.title);
  const [draftIngredients, setDraftIngredients] = useState(meal.ingredients);
  const [draftTime, setDraftTime] = useState('');
  /**
   * Rows the notes box currently shows: 1 when it opens, 2 as soon as the laid-out
   * text needs the second line (never more - `NOTES_ROWS` is the limit).
   */
  const [notesRows, setNotesRows] = useState(1);
  const [errorLine, setErrorLine] = useState<string | null>(null);
  /** True while this card's save is in flight (the Save button is disabled). */
  const [saving, setSaving] = useState(false);
  /**
   * Re-entry guard for the save itself. React state is asynchronous, so two
   * taps landing in the same frame would both pass a `saving === false` check;
   * this ref is already true for the second one.
   */
  const saveBusyRef = useRef(false);

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
   * Redundant state cue next to the word: ✓ for done, ✕ for missed, and nothing
   * for pending - the pill always spells the state out, so the colour is never
   * the only signal.
   */
  const statusIcon: IconName | null =
    meal.status === MealStatus.Done ? 'checkmark' : meal.status === MealStatus.Missed ? 'close' : null;
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

  /**
   * Chrome of the three editor fields: a soft fill on the card plus a subtle
   * border, so each field reads as a field even where the wash is close to the
   * card's own colour.
   */
  const fieldChrome = {
    color: colors.text,
    backgroundColor: colors.surfaceVariant,
    borderColor: colors.border,
  };
  /** The editor's footer band: a barely-there tint of the accent, not a surface. */
  const footerTint = tintAlpha(colors.accent, isDark ? '1A' : '0D');

  const startEdit = (): void => {
    setDraftTitle(meal.title);
    setDraftIngredients(meal.ingredients);
    setDraftTime(effectiveTime !== null ? effectiveTime.slice(0, 5) : '');
    setErrorLine(null);
    // A fresh editor always opens with the SHALLOW notes box; the measured layout
    // opens it up again when the stored draft really needs two rows.
    setNotesRows(1);
    setEditing(true);
    props.onEditingChange?.(meal.id, true);
  };

// Opens the editor when the parent requests it (deep link from a
  // notification or the empty-content DONE dialog's Edit button).
  useEffect(() => {
    if (props.forceEditing === true) {
      setDraftTitle(meal.title);
      setDraftIngredients(meal.ingredients);
      setDraftTime(effectiveTime !== null ? effectiveTime.slice(0, 5) : '');
      setErrorLine(null);
      setNotesRows(1);
      setEditing(true);
      props.onEditingChange?.(meal.id, true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.forceEditing]);

  const cancelEdit = (): void => {
    setDraftTitle(meal.title);
    setDraftIngredients(meal.ingredients);
    setDraftTime(effectiveTime !== null ? effectiveTime.slice(0, 5) : '');
    setErrorLine(null);
    setNotesRows(1);
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
        cardShadow,
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
      <View style={styles.cardContent}>
      {/* header - no fill: the card keeps its surface and only the rail, the
          pill and the counter dot carry the state */}
      <View style={styles.header}>
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
          <Text style={[styles.headerTime, { color: colors.textMuted }]}>
            {formatTime(effectiveTime, use12HourClock)}
          </Text>
        </View>
        <View
          style={[styles.pill, { backgroundColor: pill.fill }]}>
          {statusIcon !== null ? (
            <Icon name={statusIcon} size={11} color={pill.ink} />
          ) : (
            <View style={[styles.pillDot, { backgroundColor: pill.dot }]} />
          )}
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
              category icon, the meal's name, the status pill and the rail), then
              three labelled fields - the Description starting at ONE row - and one
              lightly tinted footer holding the time and the two answers. The card's
              action strip is NOT drawn while the editor is open. */}
          <View style={styles.fieldGroup}>
            <Text style={[styles.fieldLabel, { color: colors.textMuted }]}>
              {t('Rn_FieldMealName')}
            </Text>
            <MeasuredInput
              accessibilityLabel={t('Rn_FieldMealName')}
              value={draftTitle}
              onChangeText={setDraftTitle}
              rows={TITLE_ROWS}
              paddingHorizontal={FIELD_PADDING}
              textStyle={FIELD_TEXT}
              inputStyle={[styles.input, styles.field, fieldChrome]}
              placeholder={t('Rn_FieldMealName')}
              placeholderTextColor={colors.textMuted}
              // The caret lives at the end of the row, so it keeps its own room.
              caretRoom={2}
            />
          </View>
          <View style={styles.fieldGroup}>
            <Text style={[styles.fieldLabel, { color: colors.textMuted }]}>
              {t('Rn_FieldDescription')}
            </Text>
            <MeasuredInput
              accessibilityLabel={t('Rn_FieldDescription')}
              value={draftIngredients}
              onChangeText={setDraftIngredients}
              rows={NOTES_ROWS}
              // Shallow until the text needs the second line; the LIMIT stays
              // `rows` (2), so the fit guard is exactly as strict as before.
              onRows={(rows) => setNotesRows(Math.min(Math.max(1, rows), NOTES_ROWS))}
              paddingHorizontal={FIELD_PADDING}
              textStyle={FIELD_TEXT}
              inputStyle={[
                styles.input,
                styles.field,
                styles.textarea,
                fieldChrome,
                { height: notesRows > 1 ? NOTES_HEIGHT : FIELD_HEIGHT },
              ]}
              placeholder={t('Rn_FieldDescription')}
              placeholderTextColor={colors.textMuted}
              multiline
              numberOfLines={notesRows}
              textAlignVertical="top"
            />
          </View>
          {/* One compact, lightly tinted footer: the planned time on the LEFT,
              Cancel / Save together on the RIGHT, labels bottom-aligned with the
              answers. */}
          <View style={[styles.editorFoot, { backgroundColor: footerTint }]}>
            <View style={styles.fieldGroup}>
              <Text style={[styles.fieldLabel, { color: colors.textMuted }]}>
                {t('Rn_FieldPlannedTime')}
              </Text>
              <TextInput
                accessibilityLabel={t('Rn_FieldPlannedTime')}
                // Only as wide as "HH:MM" needs, so the field never stretches the
                // row, and the mask below makes the value a time and nothing else.
                style={[styles.input, styles.field, styles.timeInput, fieldChrome]}
                value={draftTime}
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
            <View style={styles.editorRow}>
              <BarButton
                label={t('Common_Cancel')}
                onPress={cancelEdit}
                disabled={saving}
                colors={colors}
              />
              <BarButton
                label={t('Common_Save')}
                onPress={() => void saveEdit()}
                disabled={saving}
                colors={colors}
                accent
              />
            </View>
          </View>
        </View>
      ) : (
        <>
          <View style={styles.contentRow}>
            <View style={styles.textColumn}>
              {meal.title !== '' && (
                <Text style={[styles.title, { color: colors.text }]} numberOfLines={2}>
                  {meal.title}
                </Text>
              )}
              {meal.ingredients !== '' && (
                <Text style={[styles.body, { color: colors.textMuted }]} numberOfLines={3}>
                  {meal.ingredients}
                </Text>
              )}
              {/* An untouched card still has five available actions; the quiet
                  placeholder says why there is no text instead of leaving a hole. */}
              {meal.title === '' && meal.ingredients === '' && (
                <Text style={[styles.emptyText, { color: colors.textMuted }]}>
                  {t('Rn_MealEmpty')}
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
          <View style={styles.stripHost}>
            {/* The action strip: a full-bleed tinted footer under ONE clearer line,
                with the edit tools grouped on the left and the two state marks on
                the right. The line is the strip's own top border, so nothing has
                to be spaced around it. */}
            <View
              style={[
                styles.toolStrip,
                { backgroundColor: colors.surfaceVariant, borderTopColor: colors.cardDivider },
              ]}>
              <View style={styles.toolGroup}>
                <CardTool
                  label={t('Photo_Add')}
                  onPress={() => props.onAddPhoto(meal)}
                  disabled={photos.length >= 3 || props.uploadingPhoto === true}
                  fill={colors.cardFill}>
                  <Icon name="camera-outline" size={CARD_TOOL_GLYPH} color={colors.text} />
                </CardTool>
                <CardTool label={t('Common_Edit')} onPress={startEdit} fill={colors.cardFill}>
                  <FeatherIcon name="edit" size={CARD_TOOL_GLYPH} color={colors.text} />
                </CardTool>
                <CardTool
                  label={t('Meal_Clear')}
                  onPress={() => props.onClear(meal)}
                  disabled={empty}
                  fill={colors.cardFill}>
                  <FeatherIcon name="trash-2" size={CARD_TOOL_GLYPH} color={colors.text} />
                </CardTool>
              </View>
              {/* The one divider of the strip: "change the meal" | "decide it" -
                  pushed against the marks, one strip padding away from the ✕. */}
              <View style={[styles.toolSeparator, { backgroundColor: colors.cardDivider }]} />
              <View style={styles.markGroup}>
                <CardTool
                  label={t('Meal_MarkMissed')}
                  onPress={() => void props.onMissed(meal)}
                  disabled={future || missedSelected || !canConfirm}
                  fill={stateWash(colors.missed, missedSelected, isDark)}
                  ring={missedSelected ? colors.missed : undefined}>
                  <Icon name="close" size={CARD_TOOL_GLYPH} color={colors.missed} />
                </CardTool>
                <CardTool
                  label={t('Meal_MarkDone')}
                  onPress={() => void props.onComplete(meal)}
                  disabled={future || doneSelected || !canConfirm}
                  fill={stateWash(colors.done, doneSelected, isDark)}
                  ring={doneSelected ? colors.done : undefined}>
                  <Icon name="checkmark" size={CARD_TOOL_GLYPH} color={colors.done} />
                </CardTool>
              </View>
            </View>
          </View>
        </>
      )}
      </View>
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
 * One button of the card's action strip: a visible 40 pt tile carrying a 20 pt
 * glyph, with a hit slop that brings the touch target to 44 pt. The edit tools sit
 * on the raised card fill (they change the meal); the two state marks sit on a wash
 * of their own colour (they decide it), and the one that matches the meal's current
 * state keeps a ring - see `stateWash`.
 */
function CardTool(props: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  /** Background of the tile. */
  fill: string;
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
      hitSlop={CARD_TOOL_HIT_SLOP}
      style={({ pressed }) => [
        styles.tool,
        {
          backgroundColor: props.fill,
          borderColor: props.ring ?? 'transparent',
          // A disabled tool fades - unless it is the meal's own state, which is an
          // answer rather than a dead control.
          opacity: disabled && props.ring === undefined ? 0.45 : 1,
        },
        pressed && styles.toolPressed,
      ]}>
      {props.children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: metrics.radius,
    // Neutral hairline; the state lives on the rail and in the pill.
    borderWidth: metrics.cardBorder,
    flexGrow: 1,
    flexBasis: '100%',
    // White card on the tinted page: the shadow carries the elevation.
    ...cardShadow,
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
   * Compact card body: roomier than the old 12 pt frame padding, because the
   * card no longer draws a coloured stroke - the air is what groups it now.
   * `paddingBottom` equals the tool row's `rowGap`, so the air between the line
   * and the glyphs is the same as between the glyphs and the card's bottom
   * border.
   */
  cardContent: { paddingLeft: 15, paddingRight: 13, paddingTop: 12, paddingBottom: 6, flexGrow: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    columnGap: 10,
  },
  /** Emoji sit on a soft tile so they align with the text block, not beside it. */
  iconTile: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerText: { flexShrink: 1 },
  headerTitle: { fontSize: 14, fontFamily: fonts.medium, lineHeight: 19 },
  headerTime: { fontSize: 11, lineHeight: 15 },
  /** Capsule pill: the same shape and inset in every card, always top-right. */
  pill: {
    marginLeft: 'auto',
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    columnGap: 4,
    borderRadius: metrics.radiusPill,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  pillDot: { width: 6, height: 6, borderRadius: 3 },
  pillText: { fontSize: 11, fontFamily: fonts.medium },
  error: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 6, marginTop: 8 },
  errorText: { color: argb('#FFFFFFFF'), fontSize: 12 },
  title: { fontSize: 16, lineHeight: 22, fontFamily: fonts.medium, marginTop: 10 },
  body: { fontSize: 13, marginTop: 3, lineHeight: 19 },
  emptyText: { fontSize: 12, marginTop: 12, paddingBottom: 2 },
  /**
   * Photo strip and action row, stacked: the pictures take the full card width
   * (so three thumbnails always sit side by side instead of wrapping), and the
   * five action buttons keep their own line under a hairline.
   */
  /** Text (flexible left) beside the photo strip (right, 12 pt apart). */
  contentRow: { flexDirection: 'row', alignItems: 'flex-start', columnGap: 12 },
  textColumn: { flex: 1, minWidth: 0 },
  /**
   * The strip's host: it pushes the tools to the card's bottom edge (so two cards
   * in one row keep their strips level) and owns the 12 pt of air above the line -
   * no separate divider element, no gap to tune around it.
   */
  stripHost: { marginTop: 'auto', paddingTop: 12 },
  /**
   * The action strip itself: full-bleed (the negative margins cancel the card's
   * content padding), on a tint of the card so it reads as the card's own toolbar,
   * closed by ONE 1 pt line in `cardDivider` and rounded to the card's corners.
   * Its side padding is also the divider's gap, so the line and the card's right
   * edge carry the same air.
   */
  toolStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    columnGap: CARD_STRIP_PADDING,
    marginLeft: -15,
    marginRight: -13,
    marginBottom: -6,
    paddingVertical: 6,
    paddingHorizontal: CARD_STRIP_PADDING,
    borderTopWidth: 1,
    borderBottomLeftRadius: metrics.radius - 1,
    borderBottomRightRadius: metrics.radius - 1,
  },
  /** Left group: change the meal (photo, edit, clear). */
  toolGroup: { flexDirection: 'row', alignItems: 'center', columnGap: CARD_TOOL_GAP },
  /**
   * The single divider between "change the meal" and "decide it". The auto left
   * margin takes all the free space, so the line sits one `CARD_STRIP_PADDING`
   * from the ✕ - right next to the marks it separates them from.
   */
  toolSeparator: { width: 1, alignSelf: 'stretch', marginVertical: 7, marginLeft: 'auto' },
  /** Right group: decide the meal (missed, done). */
  markGroup: { flexDirection: 'row', alignItems: 'center', columnGap: CARD_TOOL_GAP },
  /**
   * One tool: a compact, VISIBLE tile (40 pt) with its glyph at 20 pt, and a 44 pt
   * touch target from the hit slop - see `CardTool`.
   */
  tool: {
    width: CARD_TOOL_SIZE,
    height: CARD_TOOL_SIZE,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toolPressed: { opacity: 0.6 },
  /**
   * The editor's own bottom padding tops up `cardContent.paddingBottom` (6) to
   * the card's right padding (13), so the answers sit in the corner with the same
   * air on the right and below them.
   */
  editor: { marginTop: 6, rowGap: 8, paddingBottom: 7 },
  /** Last editor row: planned time left, Cancel / Save right, on a light band. */
  editorFoot: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    columnGap: 8,
    marginTop: 2,
    padding: 8,
    borderRadius: 12,
  },
  /** One labelled editor field: a persistent caption above its input. */
  fieldGroup: { rowGap: 4 },
  fieldLabel: { fontSize: 11, lineHeight: 15, fontFamily: fonts.medium, letterSpacing: 0.2 },
  field: {
    ...FIELD_TEXT,
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: FIELD_PADDING,
    paddingVertical: FIELD_PADDING_V,
    // 44 pt: a compact chip that is also the app's minimum touch target.
    height: FIELD_HEIGHT,
    // Single-line fields centre their text in the taller box; the description
    // overrides this with 'top' so a shallow box starts at its first line.
    textAlignVertical: 'center',
  },
  /** Description: one row until the text needs two (the height is set per draft). */
  textarea: { textAlignVertical: 'top' },
  /**
   * Planned time: only as wide as "HH:MM" needs - five characters (≈35 pt at
   * 14 pt) plus 2 × 10 pt padding. The text is CENTERED, so whatever slack the
   * proportional digits leave is split evenly: the field reads as a symmetrical
   * chip instead of a left-aligned value with a gap on the right. `alignSelf`
   * keeps it at the left edge of the row instead of stretching.
   */
  timeInput: {
    width: 56,
    paddingHorizontal: 8,
    alignSelf: 'flex-start',
    textAlign: 'center',
  },
  input: { width: '100%' },
  editorRow: { flexDirection: 'row', justifyContent: 'flex-end', columnGap: metrics.controlGap },
});