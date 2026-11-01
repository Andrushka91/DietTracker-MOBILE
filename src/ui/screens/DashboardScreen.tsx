// Dashboard (spec 8.2) - header card (date nav + progress + three colored
// counters), day actions row (Mark all DONE / Mark all MISSED / Save as
// template / Save all + status caption) and the five permanent meal cards in
// a responsive wrap that keeps meal order (Dinner spans the full width).

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
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
import { ConfirmDialog, type ConfirmRequest } from '../components/dialogs';
import { MealCard } from '../components/MealCard';
import { BarButton, IconButton, localizedCode } from '../components/buttons';
import { PhotoViewer } from '../components/PhotoViewer';
/** Short alias used throughout the JSX below. */
const Bar = BarButton;

import { t, tFmt, formatLongDate } from '../strings';
import { fonts, metrics, pageTitleStyle, themeColors, typeScale, type ThemeColors } from '../theme';
import { useFloatingTabBarClearance } from '../tabBar';

export function DashboardScreen({
  route,
}: {
  route: { params?: { date?: string; mealKey?: number } };
}): React.JSX.Element {
  const app = useApp();
  const colors = themeColors(app.isDark);
  const [date, setDate] = useState(route.params?.date ?? formatDate(new Date()));
  const [meals, setMeals] = useState<MealEntry[] | null>(null);
  const [photoCounts, setPhotoCounts] = useState<Map<string, number>>(new Map());
  const [photosByMeal, setPhotosByMeal] = useState<Record<string, MealPhoto[]>>({});
  const [categories, setCategories] = useState<MealCategory[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [dialog, setDialog] = useState<ConfirmRequest | null>(null);
  const [viewerPhoto, setViewerPhoto] = useState<MealPhoto | null>(null);
  const [editRequestId, setEditRequestId] = useState<string | null>(null);
  const [saveAllTick, setSaveAllTick] = useState(0);
  const [openEditors, setOpenEditors] = useState<string[]>([]);
  /** Meal whose photograph is being prepared/saved right now (spinner tile). */
  const [uploadingMealId, setUploadingMealId] = useState<string | null>(null);
  const batchRef = useRef({ remaining: 0, saved: 0, total: 0 });
  /** Guards the single photograph pipeline (picker + save) against re-entry. */
  const photoBusyRef = useRef(false);
  const { width } = useWindowDimensions();
  const bottomClearance = useFloatingTabBarClearance();
  const now = new Date();
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

  // Deep link from a notification: open the date and the card editor.
  useEffect(() => {
    const target = route.params;
    if (target?.date !== undefined) {
      setDate(target.date);
    }
    if (target?.mealKey !== undefined && meals !== null) {
      const meal = meals.find((m) => m.mealCategoryKey === target.mealKey);
      if (meal !== undefined) {
        setEditRequestId(meal.id);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.params?.date, route.params?.mealKey]);

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
   * so the card offers the camera as well as the gallery. The dialog is the iOS
   * two-button choice the rest of the app already uses: gallery on the left,
   * camera on the right.
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
    setDialog({
      title: t('Photo_AddTitle'),
      message: t('Photo_AddMessage'),
      cancelText: t('Photo_ChooseGallery'),
      confirmText: t('Photo_TakeCamera'),
      onCancel: () => {
        setDialog(null);
        void pickPhotos(entry, 'gallery');
      },
      onConfirm: () => {
        setDialog(null);
        void pickPhotos(entry, 'camera');
      },
    });
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
      // phone, so the card shows a spinner tile while it is being saved.
      setUploadingMealId(entry.id);
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
      // that notifyChanged scheduled). Waiting for it here kept the spinner on
      // screen next to the saved photo and started a second, redundant cycle -
      // the spinner now ends with the local save.
      setUploadingMealId(null);
      photoBusyRef.current = false;
    }
  };

  const handleRemovePhoto = (photo: MealPhoto): void => {
    setDialog({
      title: t('Photo_RemoveTitle'),
      message: t('Photo_RemoveMessage'),
      cancelText: t('Common_No'),
      confirmText: t('Common_Yes'),
      destructive: true,
      onCancel: () => setDialog(null),
      onConfirm: async () => {
        setDialog(null);
        await removePhoto(photo);
        await journalDelete(accountId, EntityType.MealPhoto, photo.id, new Date().toISOString());
        app.notifyChanged();
        await reload();
      },
    });
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
        // The floating tab bar sits ON TOP of the page: keep the same room the
        // Settings page leaves, so Dinner (the last card) is never covered.
        { paddingBottom: bottomClearance },
      ]}>
      {/* header - part of the page, not a card: long date title,
          Previous / Today / Next, progress line, three state counters, day
          actions and the status caption (spec 8.2). */}
      <View style={styles.header}>
        <Text style={[styles.dateTitle, { color: colors.text }]}>{formatLongDate(date)}</Text>
        <View style={styles.navRow}>
          <Bar label={t('Dashboard_PreviousDay')} onPress={() => setDate(addDays(date, -1))} colors={colors} />
          <Bar label={t('Common_Today')} onPress={() => setDate(formatDate(new Date()))} colors={colors} />
          <Bar label={t('Dashboard_NextDay')} onPress={() => setDate(addDays(date, 1))} colors={colors} />
        </View>
        {progress !== null && (
          <>
            <View style={[styles.track, { backgroundColor: colors.border }]}>
              <View
                style={[
                  styles.fill,
                  { width: `${progress.percentage}%`, backgroundColor: colors.accent },
                ]}
              />
            </View>
            <View style={styles.counters}>
              <Counter label={t('Dashboard_CountDone')} value={progress.completed} color={colors.done} colors={colors} />
              <Counter label={t('Dashboard_CountMissed')} value={progress.missed} color={colors.missed} colors={colors} />
              <Counter label={t('Dashboard_CountPending')} value={progress.pending} color={colors.pending} colors={colors} />
            </View>
          </>
        )}
        <View style={styles.actionsRow}>
          {/* Save actions on the left, the two day-wide confirmations on the right. */}
          <Bar label={t('Dashboard_SaveDayTemplate')} onPress={handleSaveDayTemplate} colors={colors} />
          <Bar
            label={t('Dashboard_SaveAll')}
            onPress={handleSaveAll}
            disabled={openEditors.length === 0}
            colors={colors}
          />
          <View style={styles.actionsGap} />
          {/* Cross on the left, check on the right - the same order the meal
              cards use, so the pair reads identically everywhere. */}
          <IconButton
            label="Mark all meals as MISSED"
            icon="close"
            onPress={() => void handleMarkAllMissed()}
            disabled={!canMarkMissed}
            tint={colors.missed}
            colors={colors}
          />
          <IconButton
            label="Mark all meals as DONE"
            icon="checkmark"
            onPress={() => void handleMarkAllDone()}
            disabled={!canMarkDone}
            tint={colors.done}
            colors={colors}
          />
        </View>
        {status !== null && <Text style={[styles.caption, { color: colors.textMuted }]}>{status}</Text>}
      </View>

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
                onOpenPhoto={setViewerPhoto}
                uploadingPhoto={uploadingMealId === meal.id}
              />
            </View>
          );
        })}
      </View>

      {dialog !== null && <ConfirmDialog request={dialog} isDark={app.isDark} />}
      {viewerPhoto !== null && (
        <PhotoViewer photo={viewerPhoto} isDark={app.isDark} onClose={() => setViewerPhoto(null)} />
      )}
    </ScrollView>
  );
}

function Counter(props: {
  label: string;
  value: number;
  color: string;
  colors: ThemeColors;
}): React.JSX.Element {
  return (
    <View style={styles.counter}>
      <View style={[styles.chip, { backgroundColor: props.color }]} />
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
  /** The date is the page title: 700 with a little negative tracking. */
  dateTitle: { ...pageTitleStyle, fontSize: typeScale.title2, marginBottom: 6 },
  navRow: { flexDirection: 'row', flexWrap: 'wrap', gap: metrics.controlGap },
  track: { height: 8, borderRadius: 4, marginTop: 10, overflow: 'hidden' },
  fill: { height: 8, borderRadius: 4 },
  counters: { flexDirection: 'row', alignItems: 'center', columnGap: 18, marginTop: 12 },
  counter: { alignItems: 'center', flexDirection: 'row', columnGap: 7 },
  /** iOS-style round counter dot. */
  chip: { width: 10, height: 10, borderRadius: 5 },
  /** Tabular figures keep the three counters aligned as the numbers change. */
  counterValue: { fontFamily: fonts.medium, fontSize: 18, fontVariant: ['tabular-nums'] },
  counterLabel: { fontSize: 12 },
  /** The right padding lines the ✓ / ✕ pair up with the same pair on the cards. */
  actionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: metrics.controlGap,
    marginTop: 10,
    paddingRight: metrics.spacingSmall,
  },
  /** Pushes the check / cross pair to the right edge of the action row. */
  actionsGap: { flex: 1, minWidth: metrics.controlGap },
  caption: { marginTop: 8, fontSize: 12 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: metrics.gridGap, marginTop: metrics.gridGap },
  cell: { flexBasis: '48.5%', flexGrow: 1 },
  spanFull: { flexBasis: '100%', flexGrow: 1 },
});