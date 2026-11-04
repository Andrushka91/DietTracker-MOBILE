// Dashboard (spec 8.2) - header card (date nav + progress + three colored
// counters), day actions row (Mark all DONE / Mark all MISSED / Save as
// template / Save all + status caption) and the five permanent meal cards in
// a responsive wrap that keeps meal order (Dinner spans the full width).

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';

import { useFocusEffect } from '@react-navigation/native';
import * as ImagePicker from 'expo-image-picker';

import { EntityType, MealStatus } from '../../domain/enums';
import { MealCategory, MealEntry, MealPhoto } from '../../domain/models';
import { formatDate, addDays, forDay } from '../../domain/analytics';
import { isFutureMeal } from '../../domain/rules/completionRules';
import { hasMealText } from '../../domain/rules/mealContentRules';
import { MAX_PHOTOS_PER_MEAL } from '../../domain/rules/photoRules';
import { MAX_TEMPLATE_NAME_LENGTH } from '../../domain/validation';
import { ensureCategories } from '../../services/mealTracking';
import { getPhotoCounts, getPhotosForMeal } from '../../data/repositories';
import { addPhotoToMeal, removePhoto } from '../../data/photoStore';
import {
  clearMeal,
  completeMeal,
  ensureMealStored,
  loadDay,
  markAllDone,
  markAllMissed,
  missMeal,
  saveDayAsTemplate,
  saveMeal,
  type MarkAllResult,
} from '../../services/mealTracking';
import { useApp } from '../appContext';
import { subscribeDataChange } from '../../cloud/syncEngine';
import { journalDelete } from '../../cloud/journal';
import { ChoiceDialog, ConfirmDialog, PromptDialog, type ConfirmRequest } from '../components/dialogs';
import { MealCard } from '../components/MealCard';
import { IconButton, localizedCode } from '../components/buttons';
import { DayProgress } from '../components/DayProgress';
import { SaveAllRow } from '../components/SaveAllRow';
import { PhotoViewer } from '../components/PhotoViewer';

import { t, tFmt, formatCompactDate, formatLongDate, mealNameKey } from '../strings';
import { clearMealRequest } from '../clearMealPrompt';
import { readDateHandoff } from '../dates';
import { TEMPLATE_NAME_START, templateNameProblem } from '../templateName';
import { cardShadow, fonts, metrics, themeColors, type ThemeColors } from '../theme';
import { Icon, type IconName } from '../components/icons';
import { TAB_BAR_CONTENT_GAP } from '../tabBar';

/**
 * The r3 reference's responsive thresholds for the day header:
 *
 *   - actions stack at full width below 350 dp or above a 1.2 font scale, so a
 *     two-word label is never squeezed into half a phone;
 *   - the ring's metrics strip stacks under the ring below 340 dp or above 1.4
 *     (that decision lives in `DayProgress`).
 */
const STACK_ACTIONS_WIDTH = 350;
const STACK_ACTIONS_FONT_SCALE = 1.2;

export function DashboardScreen({
  route,
}: {
  route: { params?: { date?: string; mealKey?: number; requestId?: number } };
}): React.JSX.Element {
  const app = useApp();
  const colors = themeColors(app.isDark);
  /**
   * The device's LOCAL current date - the day the diary OPENS on. It is re-read
   * when the tab comes to the front, when the app resumes and at every local
   * midnight (never a UTC string slice), so a diary left open overnight starts
   * the next launch on the right day. Re-reading it never changes the day
   * already being browsed.
   */
  const [todayDate, setTodayDate] = useState(() => formatDate(new Date()));
  const [date, setDate] = useState(route.params?.date ?? todayDate);
  const [meals, setMeals] = useState<MealEntry[] | null>(null);
  const [photoCounts, setPhotoCounts] = useState<Map<string, number>>(new Map());
  const [photosByMeal, setPhotosByMeal] = useState<Record<string, MealPhoto[]>>({});
  const [categories, setCategories] = useState<MealCategory[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [dialog, setDialog] = useState<ConfirmRequest | null>(null);
  /**
   * Day whose "Save as template" name is being typed (the prompt keeps its own
   * value). Kept apart from `dialog` because a name prompt can REFUSE an empty
   * answer and stay open - `ConfirmRequest` always closes on confirm.
   */
  const [namePrompt, setNamePrompt] = useState<string | null>(null);
  /**
   * Meal whose photograph source is being chosen. Kept apart from `dialog`
   * because the source question has three real answers and no confirmation
   * semantics: dismissing it must never start a picker.
   */
  const [photoSource, setPhotoSource] = useState<MealEntry | null>(null);
  const [viewer, setViewer] = useState<{
    photos: MealPhoto[];
    index: number;
    context: string;
  } | null>(null);
  const [editRequestId, setEditRequestId] = useState<string | null>(null);
  const [saveAllTick, setSaveAllTick] = useState(0);
  const [openEditors, setOpenEditors] = useState<string[]>([]);
  /** True while the batch save runs (the row says "Saving…" and locks its button). */
  const [saving, setSaving] = useState(false);
  /** A batch that left cards open ("2 of 3 saved"); cleared by the next edit. */
  const [saveNotice, setSaveNotice] = useState<string | null>(null);
  /** Meal whose photograph is being prepared/saved right now (spinner tile). */
  const [uploadingMealId, setUploadingMealId] = useState<string | null>(null);
  const batchRef = useRef({ remaining: 0, saved: 0, total: 0 });
  /** Guards the single photograph pipeline (picker + save) against re-entry. */
  const photoBusyRef = useRef(false);
  const { width, fontScale } = useWindowDimensions();
  /** Narrow screen or large text: the two bulk actions stack at full width. */
  const stackActions = width < STACK_ACTIONS_WIDTH || fontScale > STACK_ACTIONS_FONT_SCALE;
  const now = new Date();
  /** "Sun 1 Nov" + "2026": the compact two-line date heading. */
  const compactDate = formatCompactDate(date);
  // Two cards per row once the screen is wide enough (tablet / landscape),
  // otherwise one card per row - order is always preserved (spec 8.2).
  const twoColumns = width >= 600;

  const reload = useCallback(async () => {
    if (app.profile === null) {
      return;
    }
    setCategories(await ensureCategories());
    const day = await loadDay(app.profile.id, date);
    setMeals(day.meals);
    const counts = await getPhotoCounts();
    setPhotoCounts(counts);
    const byMeal: Record<string, MealPhoto[]> = {};
    for (const meal of day.meals) {
      byMeal[meal.id] = await getPhotosForMeal(meal.id);
    }
    setPhotosByMeal(byMeal);
  }, [app.profile, date]);

  /** Re-reads the device-local date; a no-op on the same day (no extra renders). */
  const refreshToday = useCallback((): void => {
    const next = formatDate(new Date());
    setTodayDate((current) => (current === next ? current : next));
  }, []);

  // The day is reloaded whenever the tab comes to the front (and on mount, and
  // when the date changes), so a background cycle's imports are already there.
  // The same moment re-reads "today": a diary left open across midnight must not
  // keep marking yesterday as the current day.
  useFocusEffect(
    useCallback(() => {
      refreshToday();
      void reload();
    }, [reload, refreshToday]),
  );

  // Resuming from the background can cross midnight too: compare again as soon
  // as the app is the active one.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        refreshToday();
      }
    });
    return () => subscription.remove();
  }, [refreshToday]);

  // ...and while the app stays open, re-check just after each local midnight and
  // re-arm for the next one. The timeout is cancelled when the screen unmounts.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const arm = (): void => {
      const nowMs = Date.now();
      const midnight = new Date(nowMs);
      // `setHours(24, …)` lands on the NEXT local midnight, DST included.
      midnight.setHours(24, 0, 0, 0);
      // Half a second of slack: the callback can never run a hair before the day
      // has actually changed.
      timer = setTimeout(() => {
        refreshToday();
        arm();
      }, Math.max(1000, midnight.getTime() - nowMs + 500));
    };
    arm();
    return () => {
      if (timer !== undefined) {
        clearTimeout(timer);
      }
    };
  }, [refreshToday]);

  // A background cycle that imported the other device's records refreshes the
  // visible day, so a card never keeps a stale snapshot that a later save would
  // write back. An open editor is left alone: the user's typing must not be
  // discarded mid-edit.
  useEffect(() => {
    return subscribeDataChange(() => {
      if (openEditors.length > 0) {
        return;
      }
      void reload();
    });
  }, [openEditors.length, reload]);

  // Deep link from a notification or a hand-off from the Calendar / Statistics:
  // open the requested date and, when asked, the card editor. The request id is
  // part of the dependencies, so asking for the SAME date again (after the diary
  // was browsed elsewhere) still lands on that day.
  useEffect(() => {
    const handoff = readDateHandoff(route.params);
    if (handoff !== null) {
      setDate(handoff.date);
    }
    if (route.params?.mealKey !== undefined && meals !== null) {
      const meal = meals.find((m) => m.mealCategoryKey === route.params?.mealKey);
      if (meal !== undefined) {
        setEditRequestId(meal.id);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.params?.date, route.params?.mealKey, route.params?.requestId]);

  const accountId = app.accountId;
  const progress = meals === null ? null : forDay(date, meals, photoCounts);

  const handleSave = async (draft: MealEntry): Promise<string | null> => {
    try {
      const result = await saveMeal(draft, accountId, true);
      if (!result.ok) {
        const failure = result.validation?.failures[0];
        return failure === undefined ? t('Settings_SaveFailed') : localizedCode(failure.code);
      }
      app.notifyChanged();
      await reload();
      return null;
    } catch (error) {
      // A rejected write is reported on the card instead of disappearing into an
      // unhandled rejection (that is what made Save look dead).
      console.warn('[dashboard] the meal could not be saved', error);
      return t('Settings_SaveFailed');
    }
  };

  const handleComplete = async (entry: MealEntry): Promise<void> => {
    const result = await completeMeal(entry, accountId, now);
    if (!result.changed && result.reason === 'empty-content') {
      setDialog({
        title: t('Meal_EmptyDoneTitle'),
        message: t('Meal_EmptyDoneMessage'),
        cancelText: t('Common_Ok'),
        confirmText: t('Common_Edit'),
        onCancel: () => setDialog(null),
        onConfirm: () => {
          setEditRequestId(entry.id);
          setDialog(null);
        },
      });
      return;
    }
    if (result.changed) {
      app.notifyChanged();
      await reload();
    }
  };

  const handleMissed = async (entry: MealEntry): Promise<void> => {
    const result = await missMeal(entry, accountId, now);
    if (result.changed) {
      app.notifyChanged();
      await reload();
    }
  };

  const handleClear = (entry: MealEntry): void => {
    setDialog(
      clearMealRequest({
        entry,
        // The card prints the category by its FIXED key, so the question names the
        // meal exactly as the card does ("Lunch · 13:30").
        categoryName:
          categories.find((c) => c.fixedCategoryKey === entry.mealCategoryKey)?.name ?? null,
        use12HourClock: app.use12HourClock,
        onCancel: () => setDialog(null),
        onConfirm: async () => {
          setDialog(null);
          // The card's state can be older than the store, so the photographs are read again: every
          // one of them is removed and its deletion is journaled. Without that a cleaned meal keeps
          // an orphan picture behind - locally and in the cloud - that no screen can ever show again.
          const attached = await getPhotosForMeal(entry.id);
          for (const photo of attached) {
            await removePhoto(photo);
            await journalDelete(accountId, EntityType.MealPhoto, photo.id, new Date().toISOString());
          }
          await clearMeal(entry, accountId, now);
          app.notifyChanged();
          await reload();
        },
      }),
    );
  };

  /**
   * Photograph pipeline, step 1: where does the picture come from?
   *
   * A meal photograph is often taken right now (the plate in front of the user),
   * so the card offers the camera as well as the gallery. The question has
   * THREE answers - Camera, Gallery and Cancel - and only tapping Camera or
   * Gallery starts the system picker. Back, backdrop, Cancel and Close just
   * dismiss it, which is why this is a ChoiceDialog and not a two-button
   * confirmation whose "cancel" side had to mean Gallery.
   */
  const handleAddPhoto = (entry: MealEntry): void => {
    // One photograph pipeline at a time: `uploadingMealId` only exists during
    // the save phase, so without this flag a second tap while the system picker
    // is still open would start a second picker - and a second spinner tile.
    if (photoBusyRef.current || uploadingMealId !== null) {
      return;
    }
    const existing = (photosByMeal[entry.id] ?? []).length;
    if (existing >= MAX_PHOTOS_PER_MEAL) {
      setStatus(t('Photo_LimitReached'));
      return;
    }
    setPhotoSource(entry);
  };

  /**
   * Photograph pipeline, step 2: pick (camera or gallery), validate, store the
   * bytes + the thumbnail, journal the metadata and refresh the card.
   *
   * The camera takes exactly one picture; the gallery may hand over the
   * remaining slots of the meal at once.
   */
  const pickPhotos = async (entry: MealEntry, source: 'gallery' | 'camera'): Promise<void> => {
    if (photoBusyRef.current || uploadingMealId !== null) {
      return;
    }
    const existing = (photosByMeal[entry.id] ?? []).length;
    if (existing >= MAX_PHOTOS_PER_MEAL) {
      setStatus(t('Photo_LimitReached'));
      return;
    }
    photoBusyRef.current = true;
    try {
      const limit = MAX_PHOTOS_PER_MEAL - existing;
      let assets: ImagePicker.ImagePickerAsset[];
      if (source === 'camera') {
        const permission = await ImagePicker.requestCameraPermissionsAsync();
        if (permission.granted !== true) {
          setStatus(t('Photo_CameraDenied'));
          return;
        }
        const captured = await ImagePicker.launchCameraAsync({ mediaTypes: 'images', quality: 1 });
        if (captured.canceled || captured.assets === null) {
          return;
        }
        assets = captured.assets;
      } else {
        const response = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: 'images',
          quality: 1,
          selectionLimit: limit,
          allowsMultipleSelection: limit > 1,
        });
        if (response.canceled || response.assets === null) {
          return;
        }
        assets = response.assets;
      }
      // Reading, hashing and thumbnailing a photograph takes a moment on a
      // phone, so the app raises its bottom busy sheet - the same surface every
      // dialog uses - with "Saving the photograph…" while it happens. The card
      // itself stays quiet, so the pictures that already landed keep the strip.
      setUploadingMealId(entry.id);
      app.setBusy('savingPhoto');
      // "Photo first": an untouched card has no stored row yet, and its id is
      // minted fresh on every load. Writing the slot once before the first
      // photograph lands keeps that id stable, so the picture stays attached
      // and the title / description can be filled in afterwards.
      const stored = await ensureMealStored(entry, accountId);
      for (const asset of assets) {
        const result = await addPhotoToMeal(
          stored.id,
          asset.uri ?? '',
          asset.fileName ?? 'photo.jpg',
          accountId,
        );
        if (!result.ok && result.code !== undefined) {
          setStatus(localizedCode(result.code));
        }
      }
      app.notifyChanged();
      await reload();
    } catch (error) {
      // A denied permission, a picker failure or a full disk must be visible:
      // the card simply keeps the photographs it already had.
      console.warn('[dashboard] the photograph could not be added', error);
      setStatus(t('Error_photo_source_missing'));
    } finally {
      // The cloud sync itself continues in the background (the debounced cycle
      // that notifyChanged scheduled). Waiting for it here kept the busy sheet
      // open next to the saved photo and started a second, redundant cycle - the
      // wait now ends with the local save.
      app.setBusy(null);
      setUploadingMealId(null);
      photoBusyRef.current = false;
    }
  };

  const handleRemovePhoto = async (photo: MealPhoto): Promise<void> => {
    // Confirmation happens inside the viewer; this runs only after the user has
    // confirmed there, so the existing deletion and sync callbacks are reused.
    setViewer(null);
    await removePhoto(photo);
    await journalDelete(accountId, EntityType.MealPhoto, photo.id, new Date().toISOString());
    app.notifyChanged();
    await reload();
  };


  /**
   * One acknowledgement for a bulk action.
   *
   *  - nothing could be marked: a SINGLE-button dialog explains why (that is the
   *    only case the user has to understand; the old one showed two identical
   *    "OK" buttons),
   *  - something was marked: the floating caption reports what happened and how
   *    many untouched cards were left alone, so the page is not interrupted.
   */
  const reportBulkResult = (result: MarkAllResult, kind: 'done' | 'missed'): void => {
    if (result.changed === 0) {
      if (result.skippedEmpty > 0) {
        setDialog({
          title: t('Meal_EmptyDoneTitle'),
          message: t(
            kind === 'done' ? 'Meal_EmptyDoneSomeMessage' : 'Meal_EmptyMissedSomeMessage',
          ),
          confirmText: t('Common_Ok'),
          singleAction: true,
          onCancel: () => setDialog(null),
          onConfirm: () => setDialog(null),
        });
      }
      return;
    }
    setStatus(
      result.skippedEmpty > 0
        ? tFmt(
            kind === 'done' ? 'Dashboard_AllDonePartial' : 'Dashboard_AllMissedPartial',
            result.changed,
            result.skippedEmpty,
          )
        : t(kind === 'done' ? 'Dashboard_AllDone' : 'Dashboard_AllMissed'),
    );
  };

  const handleMarkAllDone = async (): Promise<void> => {
    if (app.profile === null) {
      return;
    }
    const result = await markAllDone(app.profile.id, date, accountId, now);
    reportBulkResult(result, 'done');
    app.notifyChanged();
    await reload();
  };

  const handleMarkAllMissed = async (): Promise<void> => {
    if (app.profile === null) {
      return;
    }
    const result = await markAllMissed(app.profile.id, date, accountId, now);
    reportBulkResult(result, 'missed');
    app.notifyChanged();
    await reload();
  };

  /**
   * "Save as template" asks for a NAME and suggests nothing: the prompt opens
   * EMPTY (it used to hold the day's date, which was also its placeholder) and
   * an empty answer is refused there, so a template is never named after the day
   * behind the user's back. Only a trimmed, non-empty name is saved.
   */
  const handleSaveDayTemplate = (): void => {
    setNamePrompt(date);
  };

  const templateNameError = (value: string): string | null =>
    templateNameProblem(value) === 'blank' ? t('Rn_TemplateNameRequired') : null;

  const saveDayTemplate = async (dayDate: string, typedName: string): Promise<void> => {
    setNamePrompt(null);
    if (app.profile === null) {
      return;
    }
    const result = await saveDayAsTemplate(app.profile.id, dayDate, typedName.trim(), accountId);
    setStatus(result.ok ? t('Template_Saved') : (result.validation?.failures[0]?.message ?? ''));
    app.notifyChanged();
  };

  // "Save all" (spec 8.2): each open inline editor saves itself. The row under
  // the day actions reports the state and owns the button; cards failing
  // validation keep their editor.
  const handleEditingChange = useCallback((mealId: string, editing: boolean) => {
    if (editing) {
      // A new edit makes an old "2 of 3 saved" note stale.
      setSaveNotice(null);
    }
    setOpenEditors((current) => {
      if (editing) {
        return current.includes(mealId) ? current : [...current, mealId];
      }
      return current.filter((id) => id !== mealId);
    });
  }, []);

  const handleSaveAll = (): void => {
    if (openEditors.length === 0 || saving) {
      return;
    }
    setSaving(true);
    setSaveNotice(null);
    batchRef.current = { remaining: openEditors.length, saved: 0, total: openEditors.length };
    setSaveAllTick((tick) => tick + 1);
  };

  const handleBatchResult = useCallback((_mealId: string, saved: boolean) => {
    const batch = batchRef.current;
    if (batch.remaining <= 0) {
      return;
    }
    batch.remaining -= 1;
    if (saved) {
      batch.saved += 1;
    }
    if (batch.remaining === 0) {
      setSaving(false);
      // A full success needs no sentence: the row's own state becomes "All
      // changes saved". Only a partial one has to be named.
      setSaveNotice(
        batch.saved === batch.total ? null : tFmt('Rn_SaveAllPartialRow', batch.saved, batch.total),
      );
    }
  }, []);

  if (meals === null) {
    return (
      <View style={[styles.loading, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.accent} />
      </View>
    );
  }

  /**
   * A bulk action is offered only when at least one card can really take it: the
   * DONE / MISSED rules need a title or a description, so a day of untouched
   * placeholders keeps both buttons disabled (and nothing turns green by
   * accident). A future day locks them too.
   */
  const canMarkDone = meals.some(
    (m) => m.status !== MealStatus.Done && !isFutureMeal(m, now) && hasMealText(m),
  );
  const canMarkMissed = meals.some(
    (m) => m.status !== MealStatus.Missed && !isFutureMeal(m, now) && hasMealText(m),
  );

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      // The meal editor lives INSIDE this list. With the default
      // ('never') the first tap after typing only dismisses the keyboard and the
      // tap never reaches the button - which is exactly why Save had to be
      // pressed twice on Android. 'handled' forwards every tap a child handles
      // and still dismisses the keyboard on a tap over empty space.
      keyboardShouldPersistTaps="handled"
      // Dragging the list out from under the keyboard closes it, so the editor's
      // fields and its Cancel / Save are never stuck behind the keyboard.
      keyboardDismissMode="on-drag"
      contentContainerStyle={[
        styles.content,
        // The bar is docked BELOW the page (it is not an overlay any more), so
        // this is only the visible air above its divider - the navigator already
        // keeps the page out of the bar's own height.
        { paddingBottom: TAB_BAR_CONTENT_GAP },
      ]}>
      {/* The day header: a CARD holding the date navigation, the progress ring
          with its outlined three-column metrics strip and the two day-wide
          actions (spec 8.2, r3 reference). */}
      <View
        style={[
          styles.header,
          cardShadow,
          { backgroundColor: colors.cardFill, borderColor: colors.border },
        ]}>
        {/* Compact day navigation: previous day, the date centred between the
            arrows, next day. The date is a plain HEADING, not a control - it
            never opens the Calendar, carries no marker and no pill - so the two
            44 pt arrows are the header's only date navigation. */}
        <View style={styles.navRow}>
          <IconButton
            label={t('Dashboard_PreviousDay')}
            icon="chevron-back"
            onPress={() => setDate(addDays(date, -1))}
            size={22}
            tint={colors.textMuted}
            colors={colors}
          />
          {/* The same typography on EVERY day: regular-weight neutral ink and a
              muted year beneath. Nothing is highlighted, badged or tappable, so
              the heading reads as plain text and never as a button. */}
          <View style={styles.dateHeading}>
            <Text
              accessibilityRole="header"
              accessibilityLabel={formatLongDate(date)}
              style={[styles.datePrimary, { color: colors.text }]}
              numberOfLines={1}>
              {compactDate.primary}
            </Text>
            {compactDate.year !== '' && (
              <Text
                accessible={false}
                style={[styles.dateYear, { color: colors.textMuted }]}>
                {compactDate.year}
              </Text>
            )}
          </View>
          <IconButton
            label={t('Dashboard_NextDay')}
            icon="chevron-forward"
            onPress={() => setDate(addDays(date, 1))}
            size={22}
            tint={colors.textMuted}
            colors={colors}
          />
        </View>
        {progress !== null && (
          <DayProgress
            completed={progress.completed}
            missed={progress.missed}
            pending={progress.pending}
            totalSlots={progress.totalSlots}
            colors={colors}
          />
        )}
        {/* Day-wide actions: two equal-width OUTLINED buttons, each wearing the
            state glyph in its state colour and a neutral label - never a solid
            red/green slab. They stack at full width on narrow screens. */}
        <View style={[styles.dayActions, stackActions && styles.dayActionsStacked]}>
          <BulkButton
            icon="close"
            iconColor={colors.missed}
            label={t('Rn_MarkAllMissed')}
            onPress={() => void handleMarkAllMissed()}
            disabled={!canMarkMissed}
            colors={colors}
            stacked={stackActions}
          />
          <BulkButton
            icon="checkmark"
            iconColor={colors.done}
            label={t('Rn_MarkAllDone')}
            onPress={() => void handleMarkAllDone()}
            disabled={!canMarkDone}
            colors={colors}
            stacked={stackActions}
          />
        </View>
        {/* The save row (spec 8.2): only rendered while an editor is open - the
            component returns null on an idle day, so the row AND its hairline
            disappear with the last editor closed. */}
        <SaveAllRow
          unsaved={openEditors.length}
          saving={saving}
          notice={saveNotice}
          onSaveAll={handleSaveAll}
          colors={colors}
          isDark={app.isDark}
        />
        {status !== null && <Text style={[styles.caption, { color: colors.textMuted }]}>{status}</Text>}
      </View>

      {/* A quiet section caption groups the five cards (and separates them from
          the day header) without wrapping them in another container. */}
      <Text style={[styles.sectionLabel, { color: colors.textMuted }]}>{t('Rn_Meals')}</Text>

      {/* five permanent cards - order always preserved */}
      <View style={styles.grid}>
        {meals.map((meal) => {
          const category = categories.find((c) => c.fixedCategoryKey === meal.mealCategoryKey);
          if (category === undefined) {
            return null;
          }
          return (
            <View
              key={meal.mealCategoryKey}
              style={meal.mealCategoryKey === 5 || !twoColumns ? styles.spanFull : styles.cell}>
              <MealCard
                meal={meal}
                category={category}
                photos={photosByMeal[meal.id] ?? []}
                use12HourClock={app.use12HourClock}
                now={now}
                isDark={app.isDark}
                forceEditing={editRequestId === meal.id}
                saveAllTick={saveAllTick}
                onEditingChange={handleEditingChange}
                onBatchResult={handleBatchResult}
                onSave={handleSave}
                onComplete={handleComplete}
                onMissed={handleMissed}
                onClear={handleClear}
                onAddPhoto={handleAddPhoto}
                onRemovePhoto={handleRemovePhoto}
                onOpenPhoto={(photo) => {
                  const list = photosByMeal[meal.id] ?? [];
                  const index = Math.max(0, list.findIndex((p) => p.id === photo.id));
                  setViewer({
                    photos: list,
                    index,
                    // Same fallback the card header uses: a category row may
                    // carry no custom name, and an empty viewer title would be
                    // a nameless picture.
                    context:
                      category.name !== ''
                        ? category.name
                        : t(mealNameKey(category.fixedCategoryKey)),
                  });
                }}
                uploadingPhoto={uploadingMealId === meal.id}
              />
            </View>
          );
        })}
      </View>

      {/* The labelled template action sits below the meal list, as a quiet text
          button: it is a day-level extra, not a sixth meal tool. */}
      <View style={styles.templateRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('Rn_SaveDayTemplate')}
          onPress={handleSaveDayTemplate}
          hitSlop={8}
          style={({ pressed }) => [styles.templateButton, { opacity: pressed ? 0.6 : 1 }]}>
          <Icon name="layers-outline" size={16} color={colors.accent} />
          <Text style={[styles.templateLabel, { color: colors.accent }]}>
            {t('Rn_SaveDayTemplate')}
          </Text>
        </Pressable>
      </View>

      {photoSource !== null && (
        <ChoiceDialog
          isDark={app.isDark}
          request={{
            title: t('Photo_AddTitle'),
            message: t('Photo_AddMessage'),
            cancelText: t('Common_Cancel'),
            choices: [
              {
                label: t('Photo_TakeCamera'),
                icon: 'camera-outline',
                onPress: () => {
                  const target = photoSource;
                  setPhotoSource(null);
                  void pickPhotos(target, 'camera');
                },
              },
              {
                label: t('Photo_ChooseGallery'),
                icon: 'images-outline',
                onPress: () => {
                  const target = photoSource;
                  setPhotoSource(null);
                  void pickPhotos(target, 'gallery');
                },
              },
            ],
            // Dismissal (back button, backdrop, Close, Cancel) only closes the
            // question. Nothing is picked, stored or journaled.
            onCancel: () => setPhotoSource(null),
          }}
        />
      )}
      {dialog !== null && <ConfirmDialog request={dialog} isDark={app.isDark} />}
      {namePrompt !== null && (
        <PromptDialog
          isDark={app.isDark}
          request={{
            title: t('Dashboard_SaveDayTemplate'),
            message: t('Common_EnterName'),
            // EMPTY, not the day's date: the name is the user's own, and the
            // prompt must not hint at a date either (the placeholder follows
            // this value, so nothing is suggested in grey).
            initialValue: TEMPLATE_NAME_START,
            cancelText: t('Common_Cancel'),
            confirmText: t('Common_Save'),
            maxLength: MAX_TEMPLATE_NAME_LENGTH,
            // Mandatory: an empty answer keeps the prompt open with the reason
            // instead of saving the template under the day's date.
            validate: templateNameError,
            onCancel: () => setNamePrompt(null),
            onConfirm: (typedName) => void saveDayTemplate(namePrompt, typedName),
          }}
        />
      )}
      {viewer !== null && (
        <PhotoViewer
          photos={viewer.photos}
          initialIndex={viewer.index}
          context={viewer.context}
          contextDetail={formatLongDate(date)}
          use12HourClock={app.use12HourClock}
          isDark={app.isDark}
          onClose={() => setViewer(null)}
          onRemove={(photo) => void handleRemovePhoto(photo)}
        />
      )}
    </ScrollView>
  );
}

/**
 * One day-wide action: an OUTLINED neutral button - card fill, 1 pt frame, the
 * state glyph in its own colour, a neutral label - so neither "all done" nor
 * "all missed" paints a solid red/green slab over the header. Disabled is a
 * truthful dimmed control (the whole button fades), never a washed primary.
 *
 * The two share one equal-width row and stack at full width when the screen is
 * narrow or the text large, so a two-word label is never squeezed.
 */
function BulkButton(props: {
  label: string;
  icon: IconName;
  iconColor: string;
  disabled: boolean;
  onPress: () => void;
  colors: ThemeColors;
  stacked: boolean;
}): React.JSX.Element {
  const { colors } = props;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.label}
      accessibilityState={{ disabled: props.disabled }}
      disabled={props.disabled}
      onPress={props.onPress}
      hitSlop={4}
      style={({ pressed }) => [
        styles.bulkButton,
        props.stacked ? styles.bulkButtonStacked : styles.bulkButtonWide,
        {
          borderColor: colors.cardDivider,
          backgroundColor:
            pressed && !props.disabled ? colors.surfaceVariant : colors.cardFill,
          opacity: props.disabled ? 0.45 : 1,
        },
      ]}>
      <Icon name={props.icon} size={18} color={props.iconColor} />
      <Text style={[styles.bulkLabel, { color: colors.text }]}>{props.label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  /**
   * Page frame: the cards keep a small 8 px margin on each side so they do not
   * stretch edge to edge, while staying tighter than the other pages.
   */
  content: {
    paddingHorizontal: metrics.pagePadding,
    paddingTop: 6,
  },
  /**
   * The day header is a CARD (the r3 reference): the same fill, 1 pt frame and
   * lift as a content card, with the reference's 14 pt inset - tight enough that
   * an 80 pt ring and its metrics strip share one row on a phone.
   */
  header: {
    borderRadius: 20,
    borderWidth: 1,
    padding: 14,
  },
  /**
   * The date is a plain HEADING between two 44 pt arrows: 20 pt regular neutral
   * ink with an 11 pt muted year under it. It is not a control, so it carries no
   * press state, badge, dot or highlight - and its words are the same on every
   * day, so the header keeps one height whatever day is open.
   */
  datePrimary: {
    fontSize: 20,
    fontFamily: fonts.regular,
    textAlign: 'center',
    flexShrink: 1,
  },
  dateYear: { fontSize: 11, fontFamily: fonts.regular, textAlign: 'center', marginTop: 1 },
  /** Previous / date / next on one row; the date fills the centre. */
  navRow: { flexDirection: 'row', alignItems: 'center', minHeight: 44 },
  dateHeading: {
    flex: 1,
    minWidth: 0,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  /** The two bulk actions share one equal-width row (or stack at full width). */
  dayActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 12,
  },
  dayActionsStacked: { flexDirection: 'column' },
  /** Outlined neutral button: 44 pt floor, 12 pt corners, card fill. */
  bulkButton: {
    minHeight: 44,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 9,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    columnGap: 7,
  },
  bulkButtonWide: { flex: 1, minWidth: 0 },
  bulkButtonStacked: { width: '100%' },
  bulkLabel: { fontFamily: fonts.regular, fontSize: 14, flexShrink: 1, textAlign: 'center' },
  /** Day-level template action under the list: centred accent text, no chrome. */
  templateRow: { alignItems: 'center', marginTop: 12 },
  templateButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    columnGap: 8,
    minHeight: 44,
    paddingHorizontal: 8,
  },
  templateLabel: { fontSize: 12, fontFamily: fonts.medium },
  caption: { marginTop: 8, fontSize: 12 },
  /** Small caps section caption between the day header and the meal cards. */
  sectionLabel: {
    fontSize: 11,
    lineHeight: 18,
    fontFamily: fonts.medium,
    letterSpacing: 1.1,
    textTransform: 'uppercase',
    marginTop: 18,
    marginBottom: 7,
    marginLeft: 2,
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: metrics.gridGap },
  cell: { flexBasis: '48.5%', flexGrow: 1 },
  spanFull: { flexBasis: '100%', flexGrow: 1 },
});