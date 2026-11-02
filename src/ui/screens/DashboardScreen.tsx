// Dashboard (spec 8.2) - header card (date nav + progress + three colored
// counters), day actions row (Mark all DONE / Mark all MISSED / Save as
// template / Save all + status caption) and the five permanent meal cards in
// a responsive wrap that keeps meal order (Dinner spans the full width).

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';

import { useFocusEffect, useNavigation } from '@react-navigation/native';
import * as ImagePicker from 'expo-image-picker';

import { EntityType, MealStatus } from '../../domain/enums';
import { MealCategory, MealEntry, MealPhoto } from '../../domain/models';
import { formatDate, addDays, forDay } from '../../domain/analytics';
import { isFutureMeal } from '../../domain/rules/completionRules';
import { hasMealText } from '../../domain/rules/mealContentRules';
import { MAX_PHOTOS_PER_MEAL } from '../../domain/rules/photoRules';
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
import { ChoiceDialog, ConfirmDialog, type ConfirmRequest } from '../components/dialogs';
import { MealCard } from '../components/MealCard';
import { BarButton, IconButton, localizedCode } from '../components/buttons';
import { PhotoViewer } from '../components/PhotoViewer';
/** Short alias used throughout the JSX below. */
const Bar = BarButton;

import { t, tFmt, formatCompactDate, formatLongDate, mealNameKey } from '../strings';
import { dateHandoff, readDateHandoff } from '../dates';
import { fonts, metrics, themeColors, type ThemeColors } from '../theme';
import { Icon } from '../components/icons';
import { TAB_BAR_CONTENT_GAP } from '../tabBar';

export function DashboardScreen({
  route,
}: {
  route: { params?: { date?: string; mealKey?: number; requestId?: number } };
}): React.JSX.Element {
  const app = useApp();
  const navigation = useNavigation();
  const colors = themeColors(app.isDark);
  const [date, setDate] = useState(route.params?.date ?? formatDate(new Date()));
  const [meals, setMeals] = useState<MealEntry[] | null>(null);
  const [photoCounts, setPhotoCounts] = useState<Map<string, number>>(new Map());
  const [photosByMeal, setPhotosByMeal] = useState<Record<string, MealPhoto[]>>({});
  const [categories, setCategories] = useState<MealCategory[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [dialog, setDialog] = useState<ConfirmRequest | null>(null);
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
  /** Meal whose photograph is being prepared/saved right now (spinner tile). */
  const [uploadingMealId, setUploadingMealId] = useState<string | null>(null);
  const batchRef = useRef({ remaining: 0, saved: 0, total: 0 });
  /** Guards the single photograph pipeline (picker + save) against re-entry. */
  const photoBusyRef = useRef(false);
  const { width } = useWindowDimensions();
  /** The tab navigator is untyped here, so the Calendar destination is named once. */
  const openCalendar = navigation as unknown as {
    navigate: (name: string, params?: object) => void;
  };
  const now = new Date();
  /** The diary's own "today", computed once per render. */
  const todayDate = formatDate(now);
  /** "Sun 1 Nov" + "2026": the compact two-line date control. */
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

  // The day is reloaded whenever the tab comes to the front (and on mount, and
  // when the date changes), so a background cycle's imports are already there.
  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

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
    setDialog({
      title: t('Meal_ClearTitle'),
      message: t('Meal_ClearMessage'),
      cancelText: t('Common_No'),
      confirmText: t('Common_Yes'),
      destructive: true,
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
    });
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

  const handleSaveDayTemplate = (): void => {
    setDialog({
      title: t('Dashboard_SaveDayTemplate'),
      message: t('Common_EnterName'),
      cancelText: t('Common_Cancel'),
      confirmText: t('Common_Save'),
      // Default name is the day itself (spec 6.5 / yyyy-MM-dd).
      inputDefaultValue: date,
      onCancel: () => setDialog(null),
      onConfirm: async (typedName) => {
        setDialog(null);
        if (app.profile === null) {
          return;
        }
        const name = (typedName ?? '').trim() === '' ? date : (typedName ?? '').trim();
        const result = await saveDayAsTemplate(app.profile.id, date, name, accountId);
        setStatus(result.ok ? t('Template_Saved') : (result.validation?.failures[0]?.message ?? ''));
        app.notifyChanged();
      },
    });
  };

  // "Save all" (spec 8.2): each open inline editor saves itself, then the
  // caption reports saved/total. Cards failing validation keep their editor.
  const handleEditingChange = useCallback((mealId: string, editing: boolean) => {
    setOpenEditors((current) => {
      if (editing) {
        return current.includes(mealId) ? current : [...current, mealId];
      }
      return current.filter((id) => id !== mealId);
    });
  }, []);

  const handleSaveAll = (): void => {
    if (openEditors.length === 0) {
      return;
    }
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
      setStatus(
        batch.saved === batch.total
          ? t('Dashboard_SaveAllDone')
          : tFmt('Dashboard_SaveAllPartial', batch.saved, batch.total),
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
      contentContainerStyle={[
        styles.content,
        // The bar is docked BELOW the page (it is not an overlay any more), so
        // this is only the visible air above its divider - the navigator already
        // keeps the page out of the bar's own height.
        { paddingBottom: TAB_BAR_CONTENT_GAP },
      ]}>
      {/* header - part of the page, not a card: long date title,
          Previous / Today / Next, progress line, three state counters, day
          actions and the status caption (spec 8.2). */}
      <View style={styles.header}>
        {/* Compact day navigation: previous day, the date centred between the
            arrows, next day. Tapping the date opens the Calendar tab to choose
            a day - there is deliberately no ellipsis and no extra chevron next
            to the date, so the header has exactly one job per control. */}
        <View style={styles.navRow}>
          <IconButton
            label={t('Dashboard_PreviousDay')}
            icon="chevron-back"
            onPress={() => setDate(addDays(date, -1))}
            size={22}
            touch={48}
            colors={colors}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={formatLongDate(date)}
            accessibilityHint={t('Common_ChooseDate')}
            onPress={() =>
              // The day AND the request id travel with the tap: the Calendar
              // opens on this exact date in its exact month, and asking for the
              // same date twice still re-fires after it was browsed elsewhere.
              openCalendar.navigate('CalendarTab', dateHandoff(date))
            }
            style={styles.dateButton}>
            <Text style={[styles.datePrimary, { color: colors.text }]} numberOfLines={1}>
              {compactDate.primary}
            </Text>
            {compactDate.year !== '' && (
              <Text style={[styles.dateYear, { color: colors.textMuted }]}>
                {compactDate.year}
              </Text>
            )}
          </Pressable>
          {/* The only shortcut that leaves the day: on today it would do nothing,
              so it appears beside the date only while another day is open. It
              lives in the date row instead of a separate row of its own, which
              keeps the header short without hiding the action. */}
          {date !== todayDate && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('Rn_GoToToday')}
              onPress={() => setDate(todayDate)}
              hitSlop={8}
              style={({ pressed }) => [styles.todayChip, { opacity: pressed ? 0.6 : 1 }]}>
              <Text style={[styles.todayChipText, { color: colors.accent }]}>
                {t('Calendar_Today')}
              </Text>
            </Pressable>
          )}
          <IconButton
            label={t('Dashboard_NextDay')}
            icon="chevron-forward"
            onPress={() => setDate(addDays(date, 1))}
            size={22}
            touch={48}
            colors={colors}
          />
        </View>
        {progress !== null && (
          <>
            {/* Progress: one slim bar and ONE completion summary ("3 of 5
                completed"), so the number of planned slots is never left to the
                bar's width. */}
            <View style={styles.progressRow}>
              <View style={[styles.track, { backgroundColor: colors.surfaceVariant }]}>
                <View
                  style={[
                    styles.fill,
                    { width: `${progress.percentage}%`, backgroundColor: colors.accent },
                  ]}
                />
              </View>
              <Text style={[styles.progressValue, { color: colors.textMuted }]}>
                {tFmt('Rn_DayProgress', progress.completed, progress.totalSlots)}
              </Text>
            </View>
            {/* Three equal columns: the counts line up under each other no
                matter how wide the numbers get. */}
            <View style={styles.counters}>
              <Count
                icon="checkmark"
                label={t('Dashboard_CountDone')}
                value={progress.completed}
                color={colors.done}
                colors={colors}
              />
              <Count
                icon="close"
                label={t('Dashboard_CountMissed')}
                value={progress.missed}
                color={colors.missed}
                colors={colors}
                glyphSize={MISSED_COUNTER_GLYPH_SIZE}
              />
              <Count
                icon="time-outline"
                label={t('Dashboard_CountPending')}
                value={progress.pending}
                color={colors.pending}
                colors={colors}
              />
            </View>
          </>
        )}
        {/* Day-wide actions: two equal-width buttons, the same distance from the
            counts above them whatever their labels say. */}
        <View style={styles.dayActions}>
          <Bar
            compact
            icon="close"
            iconColor={colors.missed}
            label={t('Rn_MarkAllMissed')}
            onPress={() => void handleMarkAllMissed()}
            disabled={!canMarkMissed}
            colors={colors}
            style={styles.bulkButton}
          />
          <Bar
            compact
            icon="checkmark"
            iconColor={colors.done}
            label={t('Rn_MarkAllDone')}
            onPress={() => void handleMarkAllDone()}
            disabled={!canMarkDone}
            colors={colors}
            style={styles.bulkButton}
          />
        </View>
        {/* Contextual batch save (spec 8.2): only an open inline editor can be
            saved, so the button exists only while one is open - and it sits below
            the two day-wide actions instead of pushing them around. */}
        {openEditors.length > 0 && (
          <View style={styles.actionsRow}>
            <Bar
              compact
              label={t('Dashboard_SaveAll')}
              onPress={handleSaveAll}
              colors={colors}
              accent
              style={styles.saveAllButton}
            />
          </View>
        )}
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
 * Glyph size of a counter (Done / Missed / Pending). The mockup draws these
 * glyphs at the size of the action glyphs, not below them: 17 pt is the same
 * ink as the meal-card tools and one step above the 14 pt count, so "✓ 3 Done"
 * reads at a glance instead of the glyph hiding behind the number.
 */
const COUNTER_GLYPH_SIZE = 17;

/**
 * Ionicons' `close` fills less of its em box than `checkmark` does, so at the
 * same 17 pt the missed ✕ reads a size smaller than the ✓ beside it. Two extra
 * points make the three counters optically equal without changing the row.
 */
const MISSED_COUNTER_GLYPH_SIZE = 19;

function Count(props: {
  label: string;
  value: number;
  icon: React.ComponentProps<typeof Icon>['name'];
  color: string;
  colors: ThemeColors;
  /** Overrides `COUNTER_GLYPH_SIZE` for a glyph whose shape reads smaller. */
  glyphSize?: number;
}): React.JSX.Element {
  return (
    <View style={styles.counter}>
      <Icon
        name={props.icon}
        size={props.glyphSize ?? COUNTER_GLYPH_SIZE}
        color={props.color}
      />
      <Text style={[styles.counterValue, { color: props.colors.text }]}>{props.value}</Text>
      <Text style={[styles.counterLabel, { color: props.colors.textMuted }]}>{props.label}</Text>
    </View>
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
  header: { paddingBottom: 2 },
  /**
   * The date is a two-line control, not the page title: a 18 pt weekday line and
   * an 11 pt year caption. Both fit between two 48 pt arrows on a 360 pt phone
   * and neither can wrap.
   */
  datePrimary: { fontSize: 18, fontFamily: fonts.medium, letterSpacing: -0.3, lineHeight: 24 },
  dateYear: { fontSize: 11, lineHeight: 15 },
  /** Previous / date / next on one row; the date fills the centre. */
  navRow: { flexDirection: 'row', alignItems: 'center', columnGap: metrics.controlGap },
  dateButton: { flex: 1, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  /**
   * "Today" rides in the date row while another day is open: a quiet accent
   * label with a full 44 pt touch target, instead of a separate row of its own.
   */
  todayChip: {
    minHeight: 44,
    minWidth: 44,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  todayChipText: { fontSize: 12, fontFamily: fonts.medium },
  /** Bar plus its completion summary, so the day can be read without the bar. */
  progressRow: { flexDirection: 'row', alignItems: 'center', columnGap: 12, marginTop: 10 },
  track: { flex: 1, height: 5, borderRadius: 20, overflow: 'hidden' },
  fill: { height: 5, borderRadius: 20 },
  progressValue: {
    fontSize: 11,
    fontVariant: ['tabular-nums'],
    flexShrink: 0,
  },
  /** Three equal columns: Done / Missed / Pending always line up. */
  counters: { flexDirection: 'row', alignItems: 'center', marginTop: 8 },
  counter: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    columnGap: 5,
  },
  /** Tabular figures keep the three counts aligned as the numbers change. */
  counterValue: { fontFamily: fonts.medium, fontSize: 14, fontVariant: ['tabular-nums'] },
  counterLabel: { fontSize: 11 },
  /** Room for the contextual Save all row under the two day-wide actions. */
  actionsRow: { flexDirection: 'row', marginTop: 8 },
  saveAllButton: { flex: 1, justifyContent: 'center' },
  /** The two bulk actions share one equal-width row. */
  dayActions: {
    flexDirection: 'row',
    columnGap: 10,
    marginTop: 12,
  },
  bulkButton: { flex: 1, justifyContent: 'center', minHeight: 48 },
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