// Dashboard (spec 8.2) - header card (date nav + progress + three colored
// counters), day actions row (Mark all DONE / Mark all MISSED / Save as
// template / Save all + status caption) and the five permanent meal cards in
// a responsive wrap that keeps meal order (Dinner spans the full width).

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  Keyboard,
  Platform,
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
import { cancelOpenDrafts, type RegisteredEditor } from '../cancelOpenDrafts';

import { t, tFmt, formatCompactDate, formatLongDate, mealNameKey } from '../strings';
import { clearMealRequest } from '../clearMealPrompt';
import { readDateHandoff } from '../dates';
import { TEMPLATE_NAME_START, templateNameProblem } from '../templateName';
import { cardShadow, fonts, themeColors, type ThemeColors } from '../theme';
import { HOME_CARD_GUTTER, homeCompact, homeTodayInk } from '../homeCompact';
import { Icon, type IconName } from '../components/icons';
import { TAB_BAR_CONTENT_GAP } from '../tabBar';

/**
 * The v3 reference's responsive threshold for the day header: the two actions
 * stack at full width below 350 dp or above a 1.2 font scale, so a two-word
 * label is never squeezed into half a phone. The progress block makes its own
 * (slightly narrower) decision inside `DayProgress`.
 */
const STACK_ACTIONS_WIDTH = homeCompact.stackWidth;
const STACK_ACTIONS_FONT_SCALE = homeCompact.stackFontScale;

/** The platform's minimum touch target: 48 dp on Android, 44 pt on iOS. */
const TOUCH_TARGET = Platform.OS === 'ios' ? homeCompact.touchIOS : homeCompact.touchAndroid;

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
  /** Registry of open editors keyed by meal id for synchronous Cancel all. */
  const editorRegistryRef = useRef(new Map<string, RegisteredEditor>());
  /** True while a Save all or Cancel all batch is in flight. */
  const batchBusyRef = useRef(false);
  /**
   * The cards whose OWN save is running. It is a ref because the bulk handlers
   * must see it in the same frame as the tap - React's disabled state only lands
   * on the next render - and a render count exists only so the row disables the
   * bulk controls visibly at the same time.
   */
  const savingCardsRef = useRef<Set<string>>(new Set());
  const [savingCards, setSavingCards] = useState(0);
  const { width, fontScale } = useWindowDimensions();
  /** Narrow screen or large text: the two bulk actions stack at full width. */
  const stackActions = width < STACK_ACTIONS_WIDTH || fontScale > STACK_ACTIONS_FONT_SCALE;
  const now = new Date();
  /**
   * The date heading is ONE phrase - "Sun 1 Nov 2026" - because the year is no
   * longer a second, quieter line. The two fields come from the existing
   * compact formatter and are joined here; a future locale formats the whole
   * phrase in its own order instead of reordering these pieces.
   */
  const compactDate = formatCompactDate(date);
  const dateLabel = [compactDate.primary, compactDate.year].filter(Boolean).join(' ');
  /**
   * The browsed day IS the device-local today. `todayDate` is the screen's one
   * clock (focus / resume / local midnight), so the caption follows it without
   * any second subscription - and it never moves the browsed date.
   */
  const isToday = date === todayDate;
  /** The "Today" caption's ink (a local value, not a new theme colour). */
  const todayInk = app.isDark ? homeTodayInk.dark : homeTodayInk.light;
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
    // One batch at a time AND never on top of a card's own write: a card that is
    // already saving would answer "saved" without writing, which would make the
    // batch report a success it never performed.
    if (
      openEditors.length === 0 ||
      saving ||
      batchBusyRef.current ||
      savingCardsRef.current.size > 0
    ) {
      return;
    }
    setSaving(true);
    setSaveNotice(null);
    batchRef.current = { remaining: openEditors.length, saved: 0, total: openEditors.length };
    batchBusyRef.current = true;
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
      batchBusyRef.current = false;
      // A full success needs no sentence: the row's own state becomes "All
      // changes saved". Only a partial one has to be named.
      setSaveNotice(
        batch.saved === batch.total ? null : tFmt('Rn_SaveAllPartialRow', batch.saved, batch.total),
      );
    }
  }, []);

  /** Register an editor so Cancel all can discard it synchronously. */
  const registerEditor = useCallback((mealId: string, commands: { isEditing: () => boolean; isSaving: () => boolean; cancel: () => void }) => {
    const registration: RegisteredEditor = { id: mealId, ...commands };
    editorRegistryRef.current.set(mealId, registration);
    return () => {
      // Remove ONLY this exact registration. Returning a cleanup that just deleted
      // by id would let an older card's unmount drop a newer card's commands.
      if (editorRegistryRef.current.get(mealId) === registration) {
        editorRegistryRef.current.delete(mealId);
      }
    };
  }, []);

  /**
   * Called by MealCard when its own saving state changes: the bulk controls must
   * refuse to start while ANY card is mid-write, even on the same frame as the tap.
   */
  const handleSavingChange = useCallback((mealId: string, busy: boolean) => {
    const cards = savingCardsRef.current;
    if (busy) {
      cards.add(mealId);
    } else {
      cards.delete(mealId);
    }
    setSavingCards(cards.size);
  }, []);

  /** Discard open drafts across every registered card on this day. */
  const handleCancelAll = useCallback((): void => {
    // Same-frame guard: refs, not the render state the buttons were drawn with.
    if (batchBusyRef.current || saving || savingCardsRef.current.size > 0) {
      return;
    }
    const result = cancelOpenDrafts(editorRegistryRef.current.values(), batchBusyRef.current, () => {
      // Accepted only: a cancelled editor must not be reopened by a pending
      // forceEditing request, and a partial-batch sentence is stale once the drafts
      // it described are gone. Nothing is cleared on blocked/empty.
      setEditRequestId(null);
      setSaveNotice(null);
    });
    if (result.kind === 'cancelled') {
      // The drafts are gone, so the keyboard has nothing left to type into.
      Keyboard.dismiss();
    }
  }, [saving]);

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

  /**
   * The SAME rule SaveAllRow uses to render itself. The header gives up its
   * bottom air (6 -> 2 dp) ONLY while that row really exists; an idle header
   * keeps the token's 6 dp, so nothing moves on a day with no drafts.
   */
  const showBulkRow = openEditors.length > 0 || saving;

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
          with its three unframed metrics and the two day-wide actions (spec
          8.2, v3 reference). It is a child of the same content container as the
          meal grid, so the card and the meal cards share one outer width. */}
      <View
        testID="day-header"
        style={[
          styles.header,
          showBulkRow && styles.headerWithBulkRow,
          cardShadow,
          { backgroundColor: colors.cardFill, borderColor: colors.border },
        ]}>
        {/* Compact day navigation: the previous-day arrow, the date centred
            between two EQUAL arrows, the next-day arrow. The date is a plain
            HEADING, not a control - it never opens the Calendar, carries no
            marker and no pill. The only extra word is the "Today" caption
            directly beneath it, and only while the browsed day IS today. */}
        <View style={styles.navRow}>
          <IconButton
            label={t('Dashboard_PreviousDay')}
            icon="chevron-back"
            onPress={() => setDate(addDays(date, -1))}
            size={homeCompact.arrowIcon}
            touch={TOUCH_TARGET}
            tint={colors.textMuted}
            colors={colors}
          />
          {/* ONE phrase - "Sun 1 Nov 2026" - at 15 pt regular on a 20 pt line,
              with the 11 pt "Today" caption 2 dp beneath it. The date and the
              caption each fill the same centre column, so they share the
              arrows' centreline. The caption is NOT a control and is not a
              second focus stop: its word is appended to the heading's label. */}
          <View
            accessible
            accessibilityRole="header"
            accessibilityLabel={
              isToday ? `${formatLongDate(date)}, ${t('Common_Today')}` : formatLongDate(date)
            }
            style={styles.dateHeading}>
            <Text style={[styles.datePrimary, { color: colors.text }]}>{dateLabel}</Text>
            {isToday && (
              <Text style={[styles.todayLabel, { color: todayInk }]}>{t('Common_Today')}</Text>
            )}
          </View>
          <IconButton
            label={t('Dashboard_NextDay')}
            icon="chevron-forward"
            onPress={() => setDate(addDays(date, 1))}
            size={homeCompact.arrowIcon}
            touch={TOUCH_TARGET}
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
          locked={savingCards > 0}
          notice={saveNotice}
          onSaveAll={handleSaveAll}
          onCancelAll={handleCancelAll}
          colors={colors}
          isDark={app.isDark}
        />
        {status !== null && <Text style={[styles.caption, { color: colors.textMuted }]}>{status}</Text>}
      </View>

      {/* Five permanent cards - order always preserved. The grid's own top
          margin IS the header-to-first-card gap (the same 8 dp as the page
          edges and the gaps between cards), so no caption or spacer sits
          between the header and the first card. */}
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
                registerEditor={registerEditor}
                onSavingChange={handleSavingChange}
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
 * One day-wide action: a REAL 48 dp (44 pt on iOS) touch target around a small
 * 32 dp OUTLINED control - card fill, 1 pt frame, 8 pt corners, the state glyph
 * in its own colour and a neutral label - so neither "all done" nor "all
 * missed" paints a solid red/green slab over the header. Disabled is a truthful
 * dimmed control (the whole target fades once), never a washed primary.
 *
 * The two share one equal-width row and stack at full width when the screen is
 * narrow or the text large, so a two-word label is never squeezed. Adjacent
 * targets stay 8 dp apart with all of their own padding, so no overlapping
 * hitSlop is needed to press either of them.
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
      style={[
        styles.bulkTarget,
        props.stacked ? styles.bulkTargetStacked : styles.bulkTargetWide,
        props.disabled && styles.bulkDisabled,
      ]}>
      {({ pressed }) => (
        <View
          style={[
            styles.bulkButton,
            {
              borderColor: colors.cardDivider,
              backgroundColor:
                pressed && !props.disabled ? colors.surfaceVariant : colors.cardFill,
            },
          ]}>
          <Icon name={props.icon} size={homeCompact.controlIcon} color={props.iconColor} />
          <Text style={[styles.bulkLabel, { color: colors.text }]}>{props.label}</Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  /**
   * Page frame: ONE 8 dp gutter for the left edge, the right edge and the top
   * (the top one comes AFTER the navigator's safe area, never inside the status
   * bar). The meal grid repeats the very same number, so every card - the day
   * header included - keeps an identical outer width and an identical gap.
   */
  content: {
    paddingHorizontal: homeCompact.pagePaddingX,
    paddingTop: homeCompact.pagePaddingTop,
  },
  /**
   * The day header is a CARD: the same fill, 1 pt frame and lift as a meal card,
   * with a 16 dp radius and a 10 x 6 dp inset that keeps the ring's row tight
   * while the date gets the header's full centre column.
   */
  header: {
    width: '100%',
    alignSelf: 'stretch',
    borderRadius: homeCompact.headerRadius,
    borderWidth: homeCompact.border,
    paddingHorizontal: homeCompact.paddingX,
    paddingVertical: homeCompact.paddingY,
  },
  /**
   * While the bulk save row is rendered: same 6 dp top air and 10 dp sides, but
   * the gap below closes (6 -> 2 dp) because the row's own hairline already
   * separates the two. An idle header never takes this override.
   */
  headerWithBulkRow: { paddingBottom: 2 },
  /**
   * The date is a plain HEADING between two equal arrows: ONE 15 pt regular
   * phrase with the year in it, on a 20 pt line. It is not a control, so it
   * carries no press state, badge, dot or highlight - and, on the current day
   * only, an 11 pt "Today" caption sits 2 dp beneath it.
   */
  datePrimary: {
    width: '100%',
    fontSize: homeCompact.dateSize,
    lineHeight: homeCompact.dateLine,
    fontFamily: fonts.regular,
    textAlign: 'center',
  },
  /** The caption under the date: plain text, no badge, no background, no dot. */
  todayLabel: {
    width: '100%',
    fontSize: homeCompact.todaySize,
    lineHeight: homeCompact.todayLine,
    fontFamily: fonts.medium,
    textAlign: 'center',
  },
  /** Previous / date / next on one row; the date fills the centre. */
  navRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: homeCompact.dateMinHeight,
  },
  /**
   * The flexible centre column. Date and caption each span all of it and centre
   * their text, and the two arrows are the same width, so both lines share the
   * header's exact centreline. 20 + 2 + 16 = 38 dp fits the 48 dp row.
   */
  dateHeading: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: homeCompact.dateCaptionGap,
  },
  /** The two bulk actions share one equal-width row (or stack at full width). */
  dayActions: {
    flexDirection: 'row',
    gap: homeCompact.actionsGap,
    marginTop: homeCompact.actionsGapTop,
  },
  dayActionsStacked: { flexDirection: 'column' },
  /**
   * The REAL touch target: 48 dp on Android / 44 pt on iOS, holding the smaller
   * visible control in its middle. It carries no frame of its own, so the two
   * outlines stay 8 dp apart and neither needs a hitSlop.
   */
  bulkTarget: {
    flex: 1,
    minWidth: 0,
    minHeight: TOUCH_TARGET,
    justifyContent: 'center',
    paddingVertical: 8,
  },
  bulkTargetWide: { flex: 1, minWidth: 0 },
  bulkTargetStacked: { flex: 0, width: '100%' },
  /** Busy or disabled: the whole target fades once, never a washed fill. */
  bulkDisabled: { opacity: homeCompact.disabledOpacity },
  /** The visible outline: 32 dp floor, 1 pt frame, 8 pt corners, card fill. */
  bulkButton: {
    minHeight: homeCompact.controlVisibleMinHeight,
    borderWidth: homeCompact.border,
    borderRadius: homeCompact.controlRadius,
    paddingHorizontal: homeCompact.controlPaddingX,
    paddingVertical: homeCompact.controlPaddingY,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    columnGap: homeCompact.controlIconGap,
  },
  bulkLabel: {
    fontFamily: fonts.regular,
    fontSize: homeCompact.controlLabelSize,
    lineHeight: homeCompact.controlLabelLine,
    flexShrink: 1,
    textAlign: 'center',
  },
  /** Day-level template action under the list: centred accent text, no chrome. */
  templateRow: { alignItems: 'center', marginTop: HOME_CARD_GUTTER },
  templateButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    columnGap: 8,
    minHeight: 44,
    paddingHorizontal: 8,
  },
  templateLabel: { fontSize: 12, fontFamily: fonts.medium },
  /** The one-line result of the last action (saved, template, photo error). */
  caption: {
    marginTop: homeCompact.footerGap,
    fontSize: homeCompact.noteSize,
    lineHeight: homeCompact.noteLine,
  },
  /**
   * The meal grid. Its TOP MARGIN is the header-to-first-card gap and its `gap`
   * is the distance between two cards - both the SAME 8 dp as the page's left
   * and right edges, so the header card and the five meal cards form one column
   * of equally wide cards on a phone. (Two columns stay a tablet/landscape
   * relaxation, unchanged.)
   */
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: homeCompact.mealGap,
    marginTop: homeCompact.listGapTop,
  },
  cell: { flexBasis: '48.5%', flexGrow: 1 },
  spanFull: { flexBasis: '100%', flexGrow: 1 },
});