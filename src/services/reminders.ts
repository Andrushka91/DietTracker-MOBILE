// Reminder scheduler - port of the Windows ReminderScheduler semantics
// (spec 10), implemented with expo-notifications trigger notifications (the
// notifications module bundled in Expo Go) so reminders fire even when the
// app is closed:
//
//  - ReminderSettings (one per slot, time, weekday mask Sunday = bit 0,
//    snooze minutes default 10) + the ReminderFired ledger are the schema
//  - reminders older than 3 hours are deliberately skipped (no stale
//    notifications after long downtime)
//  - the (ReminderId, Date) unique ledger guarantees a reminder never fires
//    twice for the same slot/date across restarts
//  - RemindersEnabled = false suppresses all reminders; the weekday mask
//    gates the day; timezone changes re-evaluate scheduled times
//  - actions: "Mark as DONE" (completion rules apply: future-locked /
//    empty-content still apply) and "Snooze" (default 10 min), plus a body
//    tap that deep-links to that meal's Dashboard card. Both buttons are
//    declared once as the 'reminders' notification category.

import * as Notifications from 'expo-notifications';

import { MealCategoryKey, MealStatus } from '../domain/enums';
import { ReminderSettings } from '../domain/models';
import { reminderAppliesTo } from '../domain/models';
import {
  getMealsForDate,
  getPreferences,
  getActiveProfile,
  getCategories,
  getReminders,
  reminderAlreadyFired,
  recordReminderFired,
} from '../data/repositories';
import { completeMeal } from './mealTracking';
import { t } from '../ui/strings';

export const REMINDER_CHANNEL_ID = 'reminders';
export const SYNC_CHANNEL_ID = 'sync';
/** Notification category that carries the two action buttons. */
export const REMINDER_CATEGORY_ID = 'reminders';

/** Notification action ids (both platforms register the same buttons). */
export const ACTION_MARK_DONE = 'mark-done';
export const ACTION_SNOZE = 'snooze';

/** Reminders older than 3 hours are skipped (spec 10.2). */
const STALE_REMINDER_MS = 3 * 60 * 60 * 1000;

/**
 * Creates both Android channels (Reminders / Sync), the action category, and
 * installs the foreground presentation handler - call once at bootstrap.
 *
 * Channel/category creation is native work and can be rejected by some
 * Expo Go builds (a native NPE inside setNotificationChannelAsync). That is
 * not fatal: each step degrades on its own, a missing channel makes Android
 * deliver the notification through its fallback channel, and scheduling in
 * `scheduleReminders` always continues.
 */
export async function ensureNotificationChannels(): Promise<void> {
  // Reminders are always presented while the app is in the foreground
  // (spec 10: never silently swallowed behind the active screen).
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
  try {
    await Notifications.setNotificationChannelAsync(REMINDER_CHANNEL_ID, {
      name: t('Nav_Dashboard'),
      importance: Notifications.AndroidImportance.HIGH,
    });
  } catch (error) {
    console.warn('[reminders] reminder channel could not be created', error);
  }
  try {
    await Notifications.setNotificationChannelAsync(SYNC_CHANNEL_ID, {
      name: t('Settings_Sync'),
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  } catch (error) {
    console.warn('[reminders] sync channel could not be created', error);
  }
  try {
    await Notifications.setNotificationCategoryAsync(REMINDER_CATEGORY_ID, [
      { identifier: ACTION_MARK_DONE, buttonTitle: t('Meal_MarkDone') },
      { identifier: ACTION_SNOZE, buttonTitle: t('Common_Close') },
    ]);
  } catch (error) {
    console.warn('[reminders] action buttons could not be registered', error);
  }
}

/** Requests notification permission (Android 13+ / iOS) - degrades gracefully. */
export async function requestNotificationPermission(): Promise<boolean> {
  const settings = await Notifications.requestPermissionsAsync();
  return settings.granted;
}

export async function notificationsBlocked(): Promise<boolean> {
  const settings = await Notifications.getPermissionsAsync();
  return settings.status === 'denied';
}

/**
 * Schedules the next 14 days of enabled reminders (idempotent: cancels the
 * app's reminder notifications first, then re-creates them). Called at DB
 * open and after any reminder/prefers change (spec 10.2).
 */
export async function scheduleReminders(): Promise<void> {
  const existing = await Notifications.getAllScheduledNotificationsAsync();
  for (const entry of existing) {
    const id = entry.identifier ?? '';
    const data = (entry.content.data ?? {}) as Record<string, unknown>;
    if (data.snooze === '1') {
      continue; // live snoozes survive a reschedule
    }
    if (id.startsWith('reminder-')) {
      await Notifications.cancelScheduledNotificationAsync(id);
    }
  }

  const profile = await getActiveProfile();
  if (profile === null) {
    return;
  }
  const preferences = await getPreferences(profile.id);
  if (preferences === null || !preferences.remindersEnabled) {
    return;
  }
  if ((await notificationsBlocked())) {
    // Settings shows that reminders are blocked; scheduling stays a no-op.
    return;
  }

  const reminders = (await getReminders(profile.id)).filter((r) => r.enabled);
  if (reminders.length === 0) {
    return;
  }
  const categories = await getCategories();
  const now = Date.now();

  for (const reminder of reminders) {
    const category = categories.find((c) => c.fixedCategoryKey === reminder.mealCategoryKey);
    const title = categoryName(reminder.mealCategoryKey, category?.name ?? '');
    for (let dayOffset = 0; dayOffset < 14; dayOffset += 1) {
      const fireDate = nextFire(reminder, dayOffset, now);
      if (fireDate === null) {
        continue;
      }
      const dateKey = toDateString(fireDate);
      if (await reminderAlreadyFired(reminder.id, dateKey)) {
        continue; // never fires twice for the same slot/date (ledger)
      }
      await Notifications.scheduleNotificationAsync({
        identifier: `reminder-${reminder.id}-${dateKey}`,
        content: {
          title,
          body: t('Meal_MarkDone'),
          sound: 'default',
          categoryIdentifier: REMINDER_CATEGORY_ID,
          data: {
            reminderId: reminder.id,
            date: dateKey,
            mealCategoryKey: String(reminder.mealCategoryKey),
          },
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: fireDate,
          channelId: REMINDER_CHANNEL_ID,
        },
      });
    }
  }
}

function categoryName(key: MealCategoryKey, custom: string): string {
  if (custom !== '') {
    return custom;
  }
  switch (key) {
    case MealCategoryKey.Breakfast:
      return t('Meal_Breakfast_Name');
    case MealCategoryKey.MorningSnack:
      return t('Meal_MorningSnack_Name');
    case MealCategoryKey.Lunch:
      return t('Meal_Lunch_Name');
    case MealCategoryKey.AfternoonSnack:
      return t('Meal_AfternoonSnack_Name');
    default:
      return t('Meal_Dinner_Name');
  }
}

function toDateString(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Next concrete fire time within the 14-day horizon, or null when the weekday
 * mask excludes the day. Skips slots whose time already passed more than
 * 3 hours ago (stale reminder rule).
 */
function nextFire(reminder: ReminderSettings, dayOffset: number, nowMs: number): Date | null {
  const [h, m, s] = reminder.time.split(':').map(Number);
  const base = new Date(nowMs);
  base.setDate(base.getDate() + dayOffset);
  base.setHours(Number.isNaN(h) ? 0 : h, Number.isNaN(m) ? 0 : m, Number.isNaN(s) ? 0 : s, 0);
  if (!reminderAppliesTo(reminder.weekdays, base.getDay())) {
    return null;
  }
  if (base.getTime() <= nowMs - STALE_REMINDER_MS) {
    return null;
  }
  if (base.getTime() <= nowMs) {
    // Due right now but not stale: schedule a minute out so it still fires.
    return new Date(nowMs + 60 * 1000);
  }
  return base;
}

/**
 * Wires the notification response handler (action buttons, body taps) - call
 * once at bootstrap AFTER the navigation ref exists. Malformed arguments must
 * never crash (spec 10.3).
 */
export function installReminderEventHandlers(options: {
  onOpenMeal: (date: string, mealCategoryKey: number) => void;
  accountId: () => string | null;
}): void {
  // One listener covers presses and action buttons on both platforms; it also
  // fires when a tap cold-starts the app.
  Notifications.addNotificationResponseReceivedListener(async (response) => {
    const notification = response.notification;
    const data = (notification.request.content.data ?? {}) as Record<string, unknown>;
    const date = typeof data.date === 'string' ? data.date : '';
    const keyRaw = typeof data.mealCategoryKey === 'string' ? Number(data.mealCategoryKey) : NaN;
    if (date === '' || Number.isNaN(keyRaw)) {
      return; // malformed payload - never crash (spec 10.3)
    }
    const reminderId = typeof data.reminderId === 'string' ? data.reminderId : '';
    const action = response.actionIdentifier;
    const id = notification.request.identifier;

    if (action === ACTION_MARK_DONE) {
      await handleMarkDoneFromNotification(reminderId, date, keyRaw, options.accountId());
      try {
        await Notifications.cancelScheduledNotificationAsync(id);
        await Notifications.dismissNotificationAsync(id);
      } catch {
        // already delivered - nothing left to cancel
      }
      return;
    }
    if (action === ACTION_SNOZE) {
      const snoozeMs = await snoozeMinutesFor(reminderId);
      const snoozeId = `snooze-${id}`;
      try {
        await Notifications.cancelScheduledNotificationAsync(snoozeId);
      } catch {
        // no previous snooze - nothing to replace
      }
      await Notifications.scheduleNotificationAsync({
        identifier: snoozeId,
        content: {
          title: notification.request.content.title ?? '',
          body: notification.request.content.body ?? '',
          sound: 'default',
          categoryIdentifier: REMINDER_CATEGORY_ID,
          data: { ...data, snooze: '1' },
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: Date.now() + snoozeMs * 60 * 1000,
          channelId: REMINDER_CHANNEL_ID,
        },
      });
      return;
    }
    if (action === Notifications.DEFAULT_ACTION_IDENTIFIER) {
      options.onOpenMeal(date, keyRaw);
    }
  });
}

async function snoozeMinutesFor(reminderId: string): Promise<number> {
  const profile = await getActiveProfile();
  if (profile === null) {
    return 10;
  }
  const reminder = (await getReminders(profile.id)).find((r) => r.id === reminderId);
  return reminder?.snoozeMinutes ?? 10;
}

/**
 * "Mark as DONE" from the notification runs the SAME completion rules as the
 * card: future-locked and empty-content still apply (spec 10.3).
 */
async function handleMarkDoneFromNotification(
  reminderId: string,
  date: string,
  mealCategoryKey: number,
  accountId: string | null,
): Promise<void> {
  try {
    const profile = await getActiveProfile();
    if (profile === null) {
      return;
    }
    const meals = await getMealsForDate(profile.id, date);
    const meal = meals.find((m) => m.mealCategoryKey === mealCategoryKey);
    if (meal === undefined || meal.status === MealStatus.Done) {
      return;
    }
    await completeMeal(meal, accountId, new Date());
    await recordReminderFired(reminderId, date, new Date().toISOString(), meal.id);
    await scheduleReminders();
  } catch (error) {
    console.warn('[reminders] mark-done failed', error);
  }
}

/** Records the fire in the ledger (called when a reminder notification shows). */
export async function noteReminderShown(reminderId: string, date: string): Promise<void> {
  await recordReminderFired(reminderId, date, new Date().toISOString(), null);
  await scheduleReminders();
}

/**
 * "Synchronization complete" result notification after a MANUAL cycle that
 * moved data (parity with the Windows tray balloon - spec 10.5). Silent for
 * background cycles: only call this for SyncTrigger.Manual results.
 */
export async function showSyncResultNotification(
  uploaded: number,
  downloaded: number,
): Promise<void> {
  await Notifications.scheduleNotificationAsync({
    content: {
      title: t('Sync_BalloonTitle'),
      body: t('Sync_BalloonDetail').replace('{0}', String(uploaded)).replace('{1}', String(downloaded)),
    },
    trigger: { channelId: SYNC_CHANNEL_ID },
  });
}