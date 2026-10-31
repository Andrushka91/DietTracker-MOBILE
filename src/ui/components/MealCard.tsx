// Meal card (spec 8.3) - identical anatomy in read and edit mode:
//
//  header: emoji icon (~36pt), fixed category name, effective planned time
//          caption, status pill (Pending gray / Done green / Missed red)
//  read:   title (2 lines), description (3 lines), closable error banner,
//          photo gallery (left) + action bar (right)
//  bar:    Add photo -> Edit -> Clear (red, disabled when empty) ->
//          Mark MISSED (disabled future/already) -> Mark DONE (disabled
//          future/already-done/empty) - all with accessibility labels
//  editor: Title / Description / Planned time (HH:MM) / Cancel / Save;
//          validation failures land on the card error line; Cancel resets
//          only this card's draft.

import React, { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { MealStatus } from '../../domain/enums';
import { MealCategory, MealEntry, MealPhoto } from '../../domain/models';
import { isFutureMeal } from '../../domain/rules/completionRules';
import { hasUserContent } from '../../domain/rules/mealContentRules';
import { validateMealEntry } from '../../domain/validation';
import { formatTime, mealNameKey, t } from '../strings';
import { argb, fonts, metrics, themeColors } from '../theme';
import { BarButton, IconButton, localizedCode } from './buttons';
import { PhotoGallery } from './PhotoGallery';

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

  const future = isFutureMeal(meal, now);
  const empty = !hasUserContent(meal, photos.length);
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
  const statusGlyph =
    meal.status === MealStatus.Done ? '✓' : meal.status === MealStatus.Missed ? '✕' : '•';
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
        {
          backgroundColor: colors.cardFill,
          borderTopColor: statusColor,
          minHeight: metrics.cardMinHeight,
        },
      ]}>
      <View style={styles.cardContent}>
      {/* header - no fill: the Windows card keeps the card colour and lets
          only the status pill carry the state */}
      <View style={styles.header}>
        <Text style={styles.icon}>{category.icon !== '' ? category.icon : '🍽️'}</Text>
        <View style={styles.headerText}>
          <Text style={[styles.headerTitle, { color: colors.text }]} numberOfLines={1}>
            {category.name !== '' ? category.name : t(mealNameKey(category.fixedCategoryKey))}
          </Text>
          <Text style={[styles.headerTime, { color: colors.textMuted }]}>
            {formatTime(effectiveTime, use12HourClock)}
          </Text>
        </View>
        <View style={[styles.pill, { backgroundColor: statusColor }]}>
          <Text style={styles.pillGlyph}>{statusGlyph}</Text>
          <Text style={styles.pillText}>{statusLabel}</Text>
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
          <TextInput
            accessibilityLabel={t('Meal_Title')}
            style={[styles.input, styles.field, { color: colors.text, backgroundColor: colors.surfaceVariant }]}
            value={draftTitle}
            onChangeText={setDraftTitle}
            placeholder={t('Meal_Title')}
            placeholderTextColor={colors.textMuted}
            maxLength={120}
          />
          <TextInput
            accessibilityLabel={t('Meal_Ingredients')}
            style={[styles.input, styles.field, styles.textarea, { color: colors.text, backgroundColor: colors.surfaceVariant }]}
            value={draftIngredients}
            onChangeText={setDraftIngredients}
            placeholder={t('Meal_Ingredients')}
            placeholderTextColor={colors.textMuted}
            multiline
            maxLength={2000}
          />
          <TextInput
            accessibilityLabel={t('Meal_PlannedTime')}
            style={[styles.input, styles.field, { color: colors.text, backgroundColor: colors.surfaceVariant }]}
            value={draftTime}
            onChangeText={setDraftTime}
            placeholder="HH:MM"
            placeholderTextColor={colors.textMuted}
          />
          <View style={styles.editorRow}>
            <BarButton label={t('Common_Cancel')} onPress={cancelEdit} colors={colors} />
            <BarButton label={t('Common_Save')} onPress={() => void saveEdit()} colors={colors} accent />
          </View>
        </View>
      ) : (
        <>
          {meal.title !== '' && (
            <Text style={[styles.title, { color: colors.text }]} numberOfLines={2}>
              {meal.title}
            </Text>
          )}
          <Text style={[styles.body, { color: colors.textSecondary }]} numberOfLines={3}>
            {meal.ingredients}
          </Text>
          <View style={styles.bottomRow}>
            <PhotoGallery
              photos={photos}
              colors={colors}
              uploading={props.uploadingPhoto === true}
              onOpen={props.onOpenPhoto}
              onRemove={props.onRemovePhoto}
            />
            <View style={styles.actions}>
              <View style={styles.actionRow}>
                <IconButton label={t('Photo_Add')} glyph="📷" onPress={() => props.onAddPhoto(meal)} disabled={photos.length >= 3 || props.uploadingPhoto === true} colors={colors} />
                <IconButton label={t('Common_Edit')} glyph="✏️" onPress={startEdit} colors={colors} />
                <IconButton label={t('Meal_Clear')} glyph="🗑" onPress={() => props.onClear(meal)} disabled={empty} tint={colors.missed} colors={colors} />
                <IconButton label={t('Meal_MarkMissed')} glyph="✕" onPress={() => void props.onMissed(meal)} disabled={future || meal.status === MealStatus.Missed} tint={colors.missed} colors={colors} />
                <IconButton label={t('Meal_MarkDone')} glyph="✓" onPress={() => void props.onComplete(meal)} disabled={future || meal.status === MealStatus.Done || empty} tint={colors.done} colors={colors} />
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
    // The state colour is the card's 4 px TOP BORDER: a border follows the
    // rounded corners exactly, so the top is as round as the bottom (a child
    // bar inside the corners always renders a tighter curve).
    borderTopWidth: metrics.stateBar,
    flexGrow: 1,
    flexBasis: '100%',
    // iOS grouped card: no stroke - a soft shadow carries the elevation.
    shadowColor: '#000000',
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  /**
   * Compact card body: 4 px below the state bar + 8 px sides gives the header
   * the same distance from the card's top and right edges, and the bottom
   * padding repeats those 8 px so the action buttons keep an even frame.
   */
  cardContent: { paddingHorizontal: 8, paddingTop: 4, paddingBottom: 8, flexGrow: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    columnGap: 6,
  },
  icon: { fontSize: 26 },
  headerText: { flexShrink: 1 },
  headerTitle: { fontSize: 16, fontFamily: fonts.medium },
  headerTime: { fontSize: 12 },
  /**
   * Top-aligned like the iOS calendar badge: the 4 px margin plus the 4 px the
   * card body keeps above the header put the pill 8 px below the state bar -
   * the same distance the 8 px side padding gives it on the right, so the
   * capsule sits in an even top-right corner instead of hugging the bar.
   */
  pill: {
    marginLeft: 'auto',
    alignSelf: 'flex-start',
    marginTop: 4,
    flexDirection: 'row',
    alignItems: 'center',
    columnGap: 3,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  pillGlyph: { color: argb('#FFFFFFFF'), fontSize: 11, fontFamily: fonts.medium },
  pillText: { color: argb('#FFFFFFFF'), fontSize: 11, fontFamily: fonts.medium },
  error: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 6, marginTop: 8 },
  errorText: { color: argb('#FFFFFFFF'), fontSize: 12 },
  title: { fontSize: 16, marginTop: 4 },
  body: { fontSize: 14, marginTop: 1, lineHeight: 18 },
  /**
   * Photo strip on the left, action row on the right. Wrapping keeps the two
   * apart when a card holds three photographs on a narrow phone.
   */
  bottomRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 'auto',
    columnGap: 8,
    rowGap: 6,
    alignItems: 'flex-end',
  },
  /**
   * The action row always ends on the card's right edge: `marginLeft: 'auto'`
   * pushes it there even when the card holds no photograph, so the ✓ / ✕ pair
   * sits directly under the status pill, at the same 8 px the header keeps.
   */
  actions: { alignItems: 'flex-end', marginLeft: 'auto', flexShrink: 0 },
  /**
   * The five icon buttons keep one even gap (metrics.controlGap), so the ✓ and
   * ✕ pair is separated by exactly the same distance the Dashboard's own ✓ / ✕
   * pair uses at the top of the page - before this the card row had no gap at
   * all and the buttons touched each other.
   */
  actionRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    columnGap: metrics.controlGap,
  },
  editor: { marginTop: 8, rowGap: 8 },
  field: { borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, fontSize: 14 },
  textarea: { minHeight: 64, textAlignVertical: 'top' },
  input: { width: '100%' },
  editorRow: { flexDirection: 'row', justifyContent: 'flex-end', columnGap: metrics.controlGap },
});