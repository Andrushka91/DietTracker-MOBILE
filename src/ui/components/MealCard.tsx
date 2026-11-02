// Meal card (spec 8.3) - identical anatomy in read and edit mode:
//
//  header: emoji icon (~36pt), fixed category name, effective planned time
//          caption, status pill (Pending gray / Done green / Missed red)
//  read:   title (2 lines), description (3 lines), closable error banner,
//          photo gallery (right of the text)
//  bar:    ONE full-width hairline under the meal, then the five tools:
//          Add photo -> Edit -> Clear (red, disabled when empty) ->
//          Mark MISSED (disabled future/already) -> Mark DONE (disabled
//          future/already-done/empty) - all with accessibility labels.
//          The five glyphs are drawn at the same 20 pt as the reference card,
//          in 48 pt touch squares 8 pt apart, so the row reads as one quiet
//          line of tools instead of five crowded dots.
//  editor: Title / Description / Planned time (HH:MM) / Cancel / Save;
//          validation failures land on the card error line; Cancel resets
//          only this card's draft.

import React, { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { MealStatus } from '../../domain/enums';
import { MealCategory, MealEntry, MealPhoto } from '../../domain/models';
import { isFutureMeal } from '../../domain/rules/completionRules';
import { hasMealText, hasUserContent } from '../../domain/rules/mealContentRules';
import { validateMealEntry } from '../../domain/validation';
import { formatTime, mealNameKey, t } from '../strings';
import { argb, cardShadow, fonts, metrics, softPillColors, themeColors } from '../theme';
import { BarButton, IconButton, localizedCode } from './buttons';
import { Icon, type IconName } from './icons';
import { PhotoGallery } from './PhotoGallery';

/**
 * The meal card's tool row, measured off the reference card: the SAME five
 * glyphs as before (camera, edit, clear, missed, done), drawn at 20 pt inside
 * 48 pt touch squares, 8 pt apart. The touch square never shrinks below 48 -
 * the glyph grew into it, so the row gets the airier rhythm of the reference
 * without losing a single point of tappable area.
 */
export const CARD_TOOL_GLYPH = 20;
export const CARD_TOOL_TOUCH = 48;
export const CARD_TOOL_GAP = 8;

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
  const effectiveTime =
    meal.plannedTime ?? (category.defaultTime !== '' ? category.defaultTime : null);

  const startEdit = (): void => {
    setDraftTitle(meal.title);
    setDraftIngredients(meal.ingredients);
    setDraftTime(effectiveTime !== null ? effectiveTime.slice(0, 5) : '');
    setErrorLine(null);
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
          <Text style={styles.icon}>{category.icon !== '' ? category.icon : '🍽️'}</Text>
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
          {/* Persistent labels: a filled field alone gave no clue which value was
              the meal name, the notes or the planned time. */}
          <View style={styles.fieldGroup}>
            <Text style={[styles.fieldLabel, { color: colors.textMuted }]}>
              {t('Rn_FieldMealName')}
            </Text>
            <TextInput
              accessibilityLabel={t('Rn_FieldMealName')}
              style={[styles.input, styles.field, { color: colors.text, backgroundColor: colors.surfaceVariant }]}
              value={draftTitle}
              onChangeText={setDraftTitle}
              placeholder={t('Rn_FieldMealName')}
              placeholderTextColor={colors.textMuted}
              maxLength={120}
            />
          </View>
          <View style={styles.fieldGroup}>
            <Text style={[styles.fieldLabel, { color: colors.textMuted }]}>
              {t('Rn_FieldNotes')}
            </Text>
            <TextInput
              accessibilityLabel={t('Rn_FieldNotes')}
              style={[styles.input, styles.field, styles.textarea, { color: colors.text, backgroundColor: colors.surfaceVariant }]}
              value={draftIngredients}
              onChangeText={setDraftIngredients}
              placeholder={t('Rn_FieldNotes')}
              placeholderTextColor={colors.textMuted}
              multiline
              maxLength={2000}
            />
          </View>
          <View style={styles.fieldGroup}>
            <Text style={[styles.fieldLabel, { color: colors.textMuted }]}>
              {t('Rn_FieldPlannedTime')}
            </Text>
            <TextInput
              accessibilityLabel={t('Rn_FieldPlannedTime')}
              style={[styles.input, styles.field, { color: colors.text, backgroundColor: colors.surfaceVariant }]}
              value={draftTime}
              onChangeText={setDraftTime}
              placeholder="HH:MM"
              placeholderTextColor={colors.textMuted}
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
          <View style={styles.bottomRow}>
            {/* One full-width line under the meal, exactly as the reference
                card draws it: it closes the meal block and hands the space to
                the tools. `cardDivider` is a deliberate step above the card
                border, so the line is obvious on white AND on the dark card. */}
            <View style={[styles.divider, { backgroundColor: colors.cardDivider }]} />
            <View style={styles.actions}>
              <View style={styles.actionRow}>
                <IconButton label={t('Photo_Add')} icon="camera-outline" onPress={() => props.onAddPhoto(meal)} disabled={photos.length >= 3 || props.uploadingPhoto === true} size={CARD_TOOL_GLYPH} touch={CARD_TOOL_TOUCH} colors={colors} />
                <IconButton label={t('Common_Edit')} icon="create-outline" onPress={startEdit} size={CARD_TOOL_GLYPH} touch={CARD_TOOL_TOUCH} colors={colors} />
                <IconButton label={t('Meal_Clear')} icon="trash-outline" onPress={() => props.onClear(meal)} disabled={empty} size={CARD_TOOL_GLYPH} touch={CARD_TOOL_TOUCH} tint={colors.missed} colors={colors} />
                <IconButton label={t('Meal_MarkMissed')} icon="close" onPress={() => void props.onMissed(meal)} disabled={future || meal.status === MealStatus.Missed || !canConfirm} size={CARD_TOOL_GLYPH} touch={CARD_TOOL_TOUCH} tint={colors.missed} colors={colors} />
                <IconButton label={t('Meal_MarkDone')} icon="checkmark" onPress={() => void props.onComplete(meal)} disabled={future || meal.status === MealStatus.Done || !canConfirm} size={CARD_TOOL_GLYPH} touch={CARD_TOOL_TOUCH} tint={colors.done} colors={colors} />
              </View>
            </View>
          </View>
        </>
      )}
      </View>
    </View>
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
  icon: { fontSize: 21 },
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
  bottomRow: {
    flexDirection: 'column',
    alignItems: 'stretch',
    marginTop: 'auto',
    /**
     * The gap between the line and the tool row. It is deliberately the same
     * value as `cardContent.paddingBottom` below the tools, so the icon row sits
     * exactly halfway between the line and the card's bottom border.
     */
    rowGap: 6,
  },
  /**
   * The line that closes the meal block. 13 pt of air above it (the reference
   * card's distance from the description) and a hairline of real ink - see the
   * `colors.border` note at the call site.
   */
  divider: { height: StyleSheet.hairlineWidth, marginTop: 13 },
  /**
   * The action row ends on the card's text edge: the negative margin pulls the
   * 48 pt touch squares back by the glyph's own inset, so the last glyph lines
   * up under the pill.
   */
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    flexShrink: 0,
    marginRight: -(CARD_TOOL_TOUCH - CARD_TOOL_GLYPH) / 2,
  },
  actionRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    columnGap: CARD_TOOL_GAP,
  },
  editor: { marginTop: 8, rowGap: 8 },
  /** One labelled editor field: a persistent caption above its input. */
  fieldGroup: { rowGap: 4 },
  fieldLabel: { fontSize: 11, lineHeight: 15, fontFamily: fonts.medium, letterSpacing: 0.2 },
  field: { borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, fontSize: 14 },
  textarea: { minHeight: 64, textAlignVertical: 'top' },
  input: { width: '100%' },
  editorRow: { flexDirection: 'row', justifyContent: 'flex-end', columnGap: metrics.controlGap },
});