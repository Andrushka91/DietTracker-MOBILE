// Dashboard (spec 8.2) - header card (date nav + progress + three colored
// counters), day actions row (Mark all DONE / Mark all MISSED / Save as
// template / Save all + status caption) and the five permanent meal cards in
// a responsive wrap that keeps meal order (Dinner spans the full width).

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';

import { EntityType, MealStatus } from '../../domain/enums';
import { MealCategory, MealEntry, MealPhoto } from '../../domain/models';
import { formatDate, addDays, forDay } from '../../domain/analytics';
import { isFutureMeal } from '../../domain/rules/completionRules';
import { ensureCategories } from '../../services/mealTracking';
import { getPhotoCounts, getPhotosForMeal } from '../../data/repositories';
import { addPhotoToMeal, removePhoto } from '../../data/photoStore';
import {
  clearMeal,
  completeMeal,
  loadDay,
  markAllDone,
  markAllMissed,
  missMeal,
  saveDayAsTemplate,
  saveMeal,
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
import { usePullToRefresh } from '../usePullToRefresh';
import { fonts, metrics, themeColors, typeScale, type ThemeColors } from '../theme';

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
  const batchRef = useRef({ remaining: 0, saved: 0, total: 0 });
  const { width } = useWindowDimensions();
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

  useEffect(() => {
    void reload();
  }, [reload]);

  // Pull the day down to synchronize and refresh it (the visible counterpart of
  // the silent background cycles).
  const { refreshing, onRefresh } = usePullToRefresh(reload);

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
    const result = await saveMeal(draft, accountId, true);
    if (!result.ok) {
      return result.validation?.failures[0]?.message ?? t('Settings_SaveFailed');
    }
    app.notifyChanged();
    await reload();
    return null;
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
          if (accountId !== null) {
            await journalDelete(accountId, EntityType.MealPhoto, photo.id, new Date().toISOString());
          }
        }
        await clearMeal(entry, accountId, now);
        app.notifyChanged();
        await reload();
      },
    });
  };

  const handleAddPhoto = (entry: MealEntry): void => {
    const existing = (photosByMeal[entry.id] ?? []).length;
    if (existing >= 3) {
      setStatus(t('Photo_LimitReached'));
      return;
    }
    void (async () => {
      const limit = 3 - existing;
      const response = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: 'images',
        quality: 1,
        selectionLimit: limit,
        allowsMultipleSelection: limit > 1,
      });
      if (response.canceled || response.assets === null) {
        return;
      }
      for (const asset of response.assets) {
        const result = await addPhotoToMeal(
          entry.id,
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
    })();
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
        if (accountId !== null) {
          await journalDelete(accountId, EntityType.MealPhoto, photo.id, new Date().toISOString());
        }
        app.notifyChanged();
        await reload();
      },
    });
  };

  const handleMarkAllDone = async (): Promise<void> => {
    if (app.profile === null) {
      return;
    }
    const result = await markAllDone(app.profile.id, date, accountId, now);
    if (result.skippedEmpty > 0) {
      setDialog({
        title: t('Meal_EmptyDoneTitle'),
        message: t('Meal_EmptyDoneSomeMessage'),
        cancelText: t('Common_Ok'),
        confirmText: t('Common_Ok'),
        onCancel: () => setDialog(null),
        onConfirm: () => setDialog(null),
      });
    }
    setStatus(t('Dashboard_AllDone'));
    app.notifyChanged();
    await reload();
  };

  const handleMarkAllMissed = async (): Promise<void> => {
    if (app.profile === null) {
      return;
    }
    await markAllMissed(app.profile.id, date, accountId, now);
    setStatus(t('Dashboard_AllMissed'));
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

  const future = isFutureMeal({ ...meals[0], date }, now);
  const canMarkDone = meals.some(
    (m) =>
      m.status !== MealStatus.Done &&
      !isFutureMeal(m, now) &&
      (m.title.trim() !== '' || m.ingredients.trim() !== ''),
  );

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor={colors.accent}
          colors={[colors.accent]}
          progressBackgroundColor={colors.cardFill}
        />
      }>
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
            glyph="✕"
            onPress={() => void handleMarkAllMissed()}
            disabled={future}
            tint={colors.missed}
            colors={colors}
          />
          <IconButton
            label="Mark all meals as DONE"
            glyph="✓"
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
    paddingBottom: 32,
  },
  header: { paddingBottom: 2 },
  dateTitle: { fontSize: typeScale.title2, fontFamily: fonts.medium, marginBottom: 6 },
  navRow: { flexDirection: 'row', flexWrap: 'wrap', gap: metrics.controlGap },
  track: { height: 6, borderRadius: 3, marginTop: 10, overflow: 'hidden' },
  fill: { height: 6, borderRadius: 3 },
  counters: { flexDirection: 'row', alignItems: 'center', columnGap: 20, marginTop: 10 },
  counter: { alignItems: 'center', flexDirection: 'row', columnGap: 7 },
  /** iOS-style round counter dot. */
  chip: { width: 10, height: 10, borderRadius: 5 },
  counterValue: { fontFamily: fonts.medium, fontSize: 18 },
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