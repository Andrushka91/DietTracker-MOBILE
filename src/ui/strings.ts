// English string table - the generated mirror of the Windows Resources.resw
// plus a .NET-style format helper ("{0} of {1}"). English only (spec 1.5).

import { STRINGS } from './strings.generated';

/**
 * Wording that only the phone UI needs. The generated table mirrors the Windows
 * `Resources.resw`, so a key that has no Windows counterpart lives here instead
 * of being edited into the generated file (which `npm run generate` overwrites).
 * These are presentation labels only - no business string is defined here.
 */
export const RN_STRINGS: Record<string, string> = {
  /**
   * Bottom-bar caption of the statistics tab. The generated Windows key
   * (`Nav_Statistics`) stays the page title; the r3 mockup labels the TAB
   * "Stats", which keeps all five captions comfortably on one row.
   */
  Rn_NavStats: 'Stats',
  /** Section caption above the five meal cards on the dashboard. */
  Rn_Meals: 'Meals',
  /** Placeholder on a meal card that has neither a title nor a description. */
  Rn_MealEmpty: 'No meal recorded yet',
  /** Short labels for the day-wide confirmations (accessible names stay verbose). */
  Rn_MarkAllDone: 'All done',
  Rn_MarkAllMissed: 'All missed',
  /** Segmented periods on the statistics page (the full labels are sentences). */
  Rn_PeriodDay: 'Day',
  Rn_PeriodWeek: 'Week',
  Rn_PeriodMonth: 'Month',
  Rn_PeriodYear: 'Year',
  /** Metadata caption on a template row. */
  Rn_Updated: 'Updated',
  /**
   * r3 day header: one completion summary instead of a bare percentage, so the
   * number of planned slots is never implied by the bar's width alone.
   */
  Rn_DayProgress: '{0} of {1} completed',
  /** Day shortcut shown only while the diary is showing another date. */
  Rn_GoToToday: 'Go to today',
  /**
   * Labelled template action under the meal list. The generated Windows key
   * ("Save as template") reads like a per-meal action, so the phone spells out
   * that the whole day is being saved.
   */
  Rn_SaveDayTemplate: 'Save day as template',
  /** Photo viewer chrome (the round-3 review design). */
  Rn_ViewerPrevious: 'Previous photograph',
  Rn_ViewerNext: 'Next photograph',
  Rn_ViewerZoomIn: 'Zoom in',
  Rn_ViewerZoomOut: 'Zoom out',
  Rn_ViewerCount: '{0} of {1}',
  Rn_ViewerHint: 'Swipe to browse · Pinch or double-tap to zoom',
  /**
   * The viewer's one tool: the trash in its header. The label is the action the
   * user is about to take, and it is also the confirm button's caption.
   */
  Rn_ViewerRemove: 'Delete photo',
  /** Settings (round-3 grouped layout): section captions and row labels. */
  Rn_SectionCloud: 'Cloud sync',
  Rn_SectionData: 'Data & backup',
  Rn_SectionMore: 'More',
  Rn_GuestAccount: 'Guest account',
  Rn_GuestDetail: 'Meals are saved on this device',
  Rn_ConnectedDetail: 'Connected across your devices',
  Rn_ScheduledChecks: 'Scheduled cloud checks',
  Rn_CloudContents: 'Cloud contents',
  Rn_ExportDetail: 'Writes a backup file on this device',
  Rn_RestoreDetail: 'Merge a saved backup into this device',
  Rn_PhotoStorage: 'Photo storage',
  Rn_PrivacyRow: 'Privacy & your data',
  Rn_AdvancedRow: 'Advanced & diagnostics',
  Rn_AboutApp: 'About DietTracker',
  Rn_LocalDatabase: 'Local database',
  Rn_CheckIntegrity: 'Check database integrity',
  Rn_AccountDetails: 'Account details',
  Rn_SyncAutoHint: 'When connected, saving a meal starts a sync attempt automatically.',
  Rn_LastSync: 'Last sync',
  /** Cloud-sync row states, one title + one detail each. */
  Rn_SyncOk: 'Up to date',
  Rn_SyncPending: 'Changes waiting to sync',
  Rn_SyncOffline: 'Offline · saved on this device',
  Rn_SyncResumes: 'Sync resumes when you reconnect',
  Rn_SyncErrorTitle: 'Sync needs attention',
  Rn_SyncErrorDetail: 'The last synchronization failed. Tap the refresh button to try again.',
  Rn_SyncAuthTitle: 'Connection expired',
  Rn_SyncAuthDetail: 'Sign in again to continue syncing.',
  Rn_SyncPausedTitle: 'Sync paused',
  Rn_SyncPausedDetail: 'Scheduled checks are paused on this device.',
  Rn_SyncGuest: 'Not connected',
  Rn_SyncGuestDetail: 'Sign in to sync across devices',
  /** Calendar (round-3 design): subtitle, mark key and the selected-day summary. */
  Rn_CalendarSubtitle: 'Your meals, day by day.',
  Rn_CalendarMarks: 'Five marks · five meal slots',
  Rn_CalendarDaySummary: '{0} done · {1} missed · {2} pending',
  Rn_CalendarPhotoCount: '{0} photos',
  Rn_NoMealRecorded: 'No meal recorded',
  /** Photo count on one agenda row (a camera glyph plus this number). */
  Rn_Agenda: 'Agenda',
  /** Statistics (round-3 review design). */
  Rn_StatSubtitle: 'A clearer picture of your meal journal.',
  Rn_StatCompletion: 'Meal-slot completion',
  Rn_StatPlannedCompleted: 'planned slots completed',
  Rn_StatAllPlanned: 'All {0} planned slots in this {1}.',
  Rn_StatIncludesUpcoming: 'Includes {0} upcoming slots.',
  Rn_StatByMeal: 'By meal',
  Rn_StatDailyBreakdown: 'Daily breakdown',
  Rn_StatWeeklyBreakdown: 'Weekly breakdown',
  Rn_StatMonthlyBreakdown: 'Monthly breakdown',
  Rn_StatDoneOfPlanned: 'Done / planned',
  Rn_StatEmptyTitle: 'No recorded outcomes yet',
  Rn_StatEmptyBody: 'Record a meal in your diary to see its breakdown here.',
  Rn_StatByMealType: 'By meal type',
  Rn_StatHowItWorks: 'How the numbers work',
  Rn_StatHowItWorksBody:
    'Completion uses every planned slot in the selected period, including upcoming meals. Pending means no outcome has been recorded.',
  Rn_StatAmongRecorded: 'Among recorded outcomes',
  Rn_StatAmongRecordedBody:
    'This second rate is Done ÷ (Done + Missed). Pending meals are excluded.',
  Rn_StatNoRecorded: 'No recorded outcomes',
  Rn_StatLater: 'Later',
  Rn_StatDoneOfTotal: '{0} / {1}',
  Rn_StatViewDay: 'View day',
  Rn_StatOpenCalendar: 'Calendar',
  Rn_StatDoneSuffix: '{0} / {1} done',
  /** Lower-case period words used inside the context sentence. */
  Rn_PeriodWordDay: 'day',
  Rn_PeriodWordWeek: 'week',
  Rn_PeriodWordMonth: 'month',
  Rn_PeriodWordYear: 'year',
  /** Short meal names for the day-mode breakdown rows. */
  Rn_MealShortBreakfast: 'Breakfast',
  Rn_MealShortMorningSnack: 'AM snack',
  Rn_MealShortLunch: 'Lunch',
  Rn_MealShortAfternoonSnack: 'PM snack',
  Rn_MealShortDinner: 'Dinner',
  /** Visible captions of the inline meal editor (persistent, not placeholders). */
  Rn_FieldMealName: 'Meal name',
  Rn_FieldNotes: 'Notes',
  Rn_FieldPlannedTime: 'Planned time',
  /** Template target-date prompt: its wording, validation and Today shortcut. */
  Rn_TemplateDatePrompt: 'Enter the target date (yyyy-MM-dd)',
  Rn_TemplateApplyConfirm: 'Apply template',
  Rn_TemplateDateRequired: 'Enter a date first.',
  Rn_TemplateDateFormat: 'Use the format yyyy-MM-dd, for example 2026-11-02.',
  Rn_TemplateDateImpossible: 'That day does not exist. Check the day and the month.',
  /** Read-only template contents, inspected before anything is applied. */
  Rn_TemplatePreview: 'Preview contents',
  Rn_TemplatePreviewHide: 'Hide contents',
  Rn_TemplateNoTitle: 'No meal name',
  Rn_TemplateNoTime: 'No time',
  /** Statistics: shown instead of another period's totals while one settles. */
  Rn_StatLoading: 'Loading statistics…',
  /** Settings: the real photograph count and the storage it occupies here. */
  Rn_PhotoCount: '{0} photos',
  Rn_PhotoCountOne: '1 photo',
  Rn_PhotoStorageSize: '{0} on this device',
  /**
   * Settings: expanded schedule copy, qualified by the current connection. It
   * describes a sync ATTEMPT, never a guaranteed immediate upload.
   */
  Rn_ScheduleHintConnected:
    'Saving a meal starts a sync attempt; this schedule decides how often the app also checks the cloud for changes from your other devices.',
  Rn_ScheduleHintGuest:
    'Not connected: nothing is uploaded yet and meals stay on this device. After you sign in, saving a meal starts a sync attempt and this schedule decides how often the app also checks the cloud.',
  Rn_ScheduleHintOffline:
    'Offline: a save cannot upload right now, so changes wait on this device and the next sync attempt follows when the connection returns. This schedule decides how often the app also checks the cloud.',
};

/**
 * Looks up a resource key. Missing keys return the key itself so a typo is
 * visible in the UI instead of a crash.
 */
export function t(key: string): string {
  return STRINGS[key] ?? RN_STRINGS[key] ?? key;
}

/**
 * Formats a string with .NET style placeholders: tFmt('Calendar_DaySummary', 1, 2, 3)
 * replaces {0}, {1}, {2}. Placeholders not supplied remain untouched.
 *
 * The Windows resources also carry custom numeric specifiers - `{0:0.#}`
 * (up to one decimal, trailing zero dropped) and `{0:0.##}` - so those are
 * honoured here instead of leaking into the UI as literal braces.
 */
export function tFmt(key: string, ...args: Array<string | number>): string {
  const template = t(key);
  return template.replace(/\{(\d+)(?::([^}]*))?\}/g, (match, indexStr: string, spec?: string) => {
    const index = Number(indexStr);
    if (index >= args.length) {
      return match;
    }
    const value = args[index];
    return spec === undefined ? String(value) : formatNumber(value, spec);
  });
}

/**
 * Formats a number with the .NET custom numeric patterns used by the Windows
 * resources: `0`, `0.#`, `0.0`, `0.##`. Anything else falls back to the plain
 * value so an unknown specifier never blanks a line.
 */
function formatNumber(value: string | number, spec: string): string {
  const num = typeof value === 'number' ? value : Number(value);
  const pattern = /^0(?:\.(0*)(#*))?$/.exec(spec);
  if (Number.isNaN(num) || pattern === null) {
    return String(value);
  }
  const fixedDigits = (pattern[1] ?? '').length;
  const optionalDigits = (pattern[2] ?? '').length;
  const rounded = num.toFixed(fixedDigits + optionalDigits);
  if (optionalDigits === 0) {
    return rounded;
  }
  const [integerPart, fractionPart = ''] = rounded.split('.');
  const trimmed = fractionPart.replace(/0+$/, '');
  return trimmed === '' ? integerPart : `${integerPart}.${trimmed}`;
}

/**
 * The Windows dashboard page title: `SelectedDate.ToString("D")`, rendered as
 * "Friday, 30 October 2026" (English only, spec 1.5). Built from fixed tables
 * instead of `Intl`, which keeps the output identical on every device.
 */
const WEEKDAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];
const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

export function formatLongDate(date: string): string {
  const [year, month, day] = date.split('-').map(Number);
  if (!year || !month || !day) {
    return date;
  }
  const value = new Date(year, month - 1, day);
  return `${WEEKDAY_NAMES[value.getDay()]}, ${day} ${MONTH_NAMES[month - 1]} ${year}`;
}

/**
 * Three-letter weekday captions for the compact r3 day header ("Sun 1 Nov").
 * The full weekday is a sentence opener, not a navigation label: at 26 pt it
 * pushed the previous/next arrows and the date apart on a 360 pt phone.
 */
const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * The compact diary date: weekday, day number and month, with the year returned
 * separately so the header can stack it ("Sun 1 Nov" over "2026"). Everything a
 * user needs to know which day is open, in one line that never wraps.
 */
export function formatCompactDate(date: string): { primary: string; year: string } {
  const [year, month, day] = date.split('-').map(Number);
  if (!year || !month || !day || month < 1 || month > 12) {
    return { primary: date, year: '' };
  }
  const weekday = WEEKDAY_SHORT[new Date(year, month - 1, day).getDay()] ?? '';
  return {
    primary: `${weekday} ${day} ${MONTH_NAMES[month - 1].slice(0, 3)}`,
    year: String(year),
  };
}

/**
 * "26 Oct" - the compact day-and-month the statistics range label and the
 * monthly breakdown rows use. The year is added once, at the end of the range.
 *
 * The day and the month are joined with a non-breaking space, so a range that
 * has to wrap ("2 Nov – 8 Nov" at large text sizes) breaks at the dash instead
 * of leaving "8" alone on the first line and "Nov" on the next.
 */
export function formatShortDayMonth(date: string): string {
  const [year, month, day] = date.split('-').map(Number);
  if (!year || !month || !day || month < 1 || month > 12) {
    return date;
  }
  return `${day}\u00A0${MONTH_NAMES[month - 1].slice(0, 3)}`;
}

/** "Mon 26" - one day of a weekly breakdown row. */
export function formatWeekdayDay(date: string): string {
  const [year, month, day] = date.split('-').map(Number);
  if (!year || !month || !day || month < 1 || month > 12) {
    return date;
  }
  const weekday = WEEKDAY_SHORT[new Date(year, month - 1, day).getDay()] ?? '';
  return `${weekday} ${day}`;
}

/**
 * The same date without the weekday: "30 October 2026". Used where the weekday
 * is noise (a template's updated-at line, a template named after its day) and
 * where the full form would be truncated by a narrow row.
 */
export function formatMediumDate(date: string): string {
  const [year, month, day] = date.split('-').map(Number);
  if (!year || !month || !day || month < 1 || month > 12) {
    return date;
  }
  return `${day} ${MONTH_NAMES[month - 1]} ${year}`;
}

/**
 * The Windows calendar month header: "October 2026". The month argument is the
 * 'yyyy-MM' key the calendar grid works with, so an unparsable value falls back
 * to that key instead of blanking the header.
 */
export function formatMonthLabel(month: string): string {
  const [yearStr, monthStr] = month.split('-');
  const year = Number(yearStr);
  const monthIndex = Number(monthStr) - 1;
  if (!year || Number.isNaN(monthIndex) || monthIndex < 0 || monthIndex > 11) {
    return month;
  }
  return `${MONTH_NAMES[monthIndex]} ${year}`;
}

/**
 * Three-letter month caption for the yearly chart ("Jan" ... "Dec"). Twelve
 * two-digit numbers on a chart scale force the reader to count columns; the
 * abbreviation is the same width and says which month it is.
 */
export function formatMonthShort(month: number): string {
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    return String(month);
  }
  return MONTH_NAMES[month - 1].slice(0, 3);
}

/** Meal display name for a permanent slot key. */
export function mealNameKey(fixedCategoryKey: number): string {
  switch (fixedCategoryKey) {
    case 1:
      return 'Meal_Breakfast_Name';
    case 2:
      return 'Meal_MorningSnack_Name';
    case 3:
      return 'Meal_Lunch_Name';
    case 4:
      return 'Meal_AfternoonSnack_Name';
    default:
      return 'Meal_Dinner_Name';
  }
}

/** Human formatting of 'HH:mm:ss' honoring the 12/24-hour preference. */
export function formatTime(time: string | null, use12HourClock: boolean): string {
  if (time === null || time === '') {
    return '';
  }
  const [hStr, mStr] = time.split(':');
  const h = Number(hStr);
  const m = mStr ?? '00';
  if (!use12HourClock || Number.isNaN(h)) {
    return `${hStr}:${m}`;
  }
  const suffix = h >= 12 ? 'PM' : 'AM';
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${m} ${suffix}`;
}

/** Formats an ISO instant as a local date-time line for captions. */
export function formatInstant(iso: string | null, use12HourClock: boolean): string {
  if (iso === null || iso === '') {
    return '';
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate(),
  ).padStart(2, '0')} ${formatTime(`${hh}:${mm}:00`, use12HourClock)}`;
}

/** Formats a byte count for the storage usage line. */
export function formatMegabytes(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(2);
}