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
  /**
   * Section caption that used to sit above the five meal cards. The v3 Home
   * header drops the caption (the cards' own 8 dp gap separates them from the
   * header), so nothing draws it any more; the key is kept so a caller that
   * still asks for "Meals" gets a word instead of the key itself.
   */
  Rn_Meals: 'Meals',
  /** Placeholder on a meal card that has neither a title nor a description. */
  Rn_MealEmpty: 'No meal recorded yet',
  /**
   * Placeholder when the entry has PHOTOGRAPHS but no typed text: the slot is
   * not empty, so the card must not claim that no meal was recorded - it just
   * has nothing written down yet.
   */
  Rn_MealPhotoOnly: 'No meal details yet',
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
   * r3 day header: the fraction INSIDE the progress ring, with no spaces
   * ("3/5"), plus the two day-wide action labels under the counts.
   */
  Rn_DayDoneOfTotal: '{0}/{1}',
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
  /**
   * The save row of the day header, which only exists while an editor is open.
   * "1 editor open" means a card holds edits waiting for Save - the row never
   * claims the cloud has anything (only the next sync attempt can say that).
   */
  Rn_EditorOpenOne: '1 editor open',
  Rn_EditorsOpen: '{0} editors open',
  Rn_Saving: 'Saving…',
  /** A batch save that left some cards open ("2 of 3 saved"). */
  Rn_SaveAllPartialRow: '{0} of {1} saved',
  /**
   * The "Delete this photo?" card: its title and what the answer removes. The
   * badge, the two pills and the action keep their own strings.
   */
  Rn_PhotoRemoveTitle: 'Delete this photo?',
  Rn_PhotoRemoveBody:
    'Removed from this device now and from your cloud account at the next sync.',
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
  /**
   * The compact label of the explicit sync action. The Windows key
   * (`Settings_SyncNow`, "Synchronize now") is the long form; the pill draws the
   * short one so it stays on a single line beside the status on a narrow phone.
   */
  Rn_SyncNow: 'Sync now',
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
  /** Calendar (round-3 design): mark key and the selected-day summary. */
  Rn_CalendarDots: '5 dots = 5 meals',
  /**
   * Spoken hint on every date cell - opening is available as an action (a second
   * tap of the same date within 300 ms, a long press, or the cell's accessibility
   * action). The old visible "Double-tap a date to open" line was removed.
   */
  Rn_CalendarSelectHint: 'Select date. Open day is available in accessibility actions.',
  Rn_CalendarDaySummary: '{0} done · {1} missed · {2} pending',
  Rn_CalendarPhotoCount: '{0} photos',
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
  /**
   * The vertical chart's three pieces of chrome: what the columns are measured
   * in, the hint shown only while the columns overflow sideways, and the one
   * instruction that says a column selects (it never navigates on its own).
   */
  Rn_StatAxisLabel: 'Planned slots',
  Rn_StatChartScrollHint: 'Swipe sideways to see every column.',
  Rn_StatChartSelectHint: 'Tap a column to see its details.',
  /** Spoken hint of the Today shortcut (its visible label is Common_Today). */
  Rn_StatTodayHint: 'Shows today in the Statistics day view.',
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
  /**
   * The card's "Description" (the entry's `ingredients` column, unchanged): the
   * label says what the field holds rather than where it is stored.
   */
  Rn_FieldDescription: 'Description',
  Rn_FieldPlannedTime: 'Planned time',
  /**
   * The inline editor's character policy (see `mealEditorLimits.ts`). These are
   * PHONE-ONLY ceilings: the domain keeps 120 / 2000 so imported and synced
   * meals stay valid. The first two are the concise answers to an over-limit
   * keystroke or paste; the third explains a value that is ALREADY longer, which
   * opens intact and may be kept or shortened - never cut by the editor.
   */
  Rn_EditorTitleLimit: 'Meal name: maximum 40 characters.',
  Rn_EditorDescriptionLimit: 'Description: maximum 80 characters.',
  Rn_EditorLegacyHint: 'Longer text is kept. Leave it as it is or shorten it.',
  /** Template target-date prompt: its wording, validation and Today shortcut. */
  Rn_TemplateDatePrompt: 'Choose the first and last day the plan is applied to',
  /**
   * The sheet's own headline (the r3 reference). Shorter than the Windows
   * `Template_ApplyTitle` ("Apply the template"), and the same two words as the
   * answer that performs the write, so the header and the button agree.
   */
  Rn_TemplateApplyTitle: 'Apply template',
  Rn_TemplateApplyConfirm: 'Apply template',
  Rn_TemplateDateRequired: 'Enter a date first.',
  Rn_TemplateDateFormat: 'Use the format yyyy-MM-dd, for example 2026-11-02.',
  Rn_TemplateDateImpossible: 'That day does not exist. Check the day and the month.',
  /**
   * Apply-template RANGE (the popup asks for two days instead of one): the two
   * field names, the inclusive summary with its singular/plural day count, the
   * order rule, the way the calendar describes each day to a screen reader, and
   * the truthful progress/partial-result wording. There is no typed fallback any
   * more - the calendar is the one input method - so the seven day columns pan
   * sideways on a phone instead of shrinking below 48 dp.
   */
  Rn_TemplateStartDate: 'Start date',
  Rn_TemplateEndDate: 'End date',
  /** "{0} – {1} · {2}", e.g. "5 November 2026 – 11 November 2026 · 7 days". */
  Rn_TemplateRangeSummary: '{0} – {1} · {2}',
  Rn_TemplateRangeDayOne: '1 day',
  Rn_TemplateRangeDayMany: '{0} days',
  Rn_TemplateRangeSamePlan: 'The same plan is applied to every day in the range.',
  Rn_TemplateRangeOrder: 'The end date cannot be before the start date.',
  Rn_TemplateApplyRangeOne: 'Apply to 1 day',
  Rn_TemplateApplyRangeMany: 'Apply to {0} days',
  /** How a day cell describes itself: the endpoint/inside words, then Today. */
  Rn_TemplateRangeA11yStart: 'start of the range',
  Rn_TemplateRangeA11yEnd: 'end of the range',
  /** One day that is BOTH ends of a single-day range. */
  Rn_TemplateRangeA11yStartEnd: 'start and end of the range',
  Rn_TemplateRangeA11yInside: 'in the range',
  Rn_TemplateCalendarHint: 'Swipe the calendar sideways to reach every day of the week.',
  /** Determinate progress: completed DAYS, never meals or syncs. */
  Rn_TemplateRangeProgress: 'Applying {0} of {1} days…',
  /** Partial result: what finished, what may be half-written, what never ran. */
  Rn_TemplateRangePartial: 'Stopped after {0} of {1} days.',
  Rn_TemplateRangePartialFailed: '{0} may be partly updated.',
  Rn_TemplateRangePartialUnattempted: '{0} not attempted.',
  Rn_TemplateRangeClose: 'Close',
  /** The page's one-line report after the range settles. */
  Rn_TemplateRangeAppliedOne: 'Applied to 1 day.',
  Rn_TemplateRangeAppliedMany: 'Applied to {0} days.',
  Rn_TemplateRangeStopped: 'Stopped after {0} of {1} days.',
  /**
   * Save-as-template name prompt: a name is required. The field starts empty and
   * the day's date is never suggested or used as a fallback.
   */
  Rn_TemplateNameRequired: 'Enter a name for the template.',
  /**
   * The "Clear this meal?" card: what the answer removes, then the consequence
   * line. The badge, the answers ("Cancel" / "Clear meal") and the title are the
   * existing strings.
   */
  Rn_ClearMealBody: "This clears the meal's details and status, and deletes all attached photos.",
  Rn_ClearMealWarning: "This can't be undone.",
  /**
   * Templates page (the r3 mockup): the subtitle under the heading, the quiet
   * info strip that replaced the italic warning, the accordion label and the
   * REAL meal count ("5 meals"). A template is read-only, so the only fallback
   * left is a slot whose stored time is blank.
   */
  Rn_TemplateSubtitle: 'Reuse a saved meal plan.',
  Rn_TemplateInfo: 'Meal details only — no status or photos',
  Rn_TemplateMealPreview: 'Meal preview',
  Rn_TemplateMealCount: '{0} meals',
  Rn_TemplateMealCountOne: '1 meal',
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
  /**
   * The two account cards (the centered surface of `ConfirmRequest.layout:
   * 'card'`). The sign-out card promises the upload BEFORE it happens; the
   * failure card states that it did not happen and that the session is still
   * open, so the red "Try again" answer is safe to press. Both use
   * `Account_SignOutTitle` ("Sign out?") and `Common_Cancel` ("Cancel").
   */
  Rn_SignOutMessage: "We'll sync your latest changes before signing you out.",
  Rn_SignOutConfirm: 'Sync & sign out',
  Rn_SignOutFailedTitle: "Couldn't sync",
  Rn_SignOutFailedMessage: "Your latest changes haven't synced yet.",
  Rn_SignOutFailedNoteTitle: 'Sync failed',
  Rn_SignOutFailedNoteMessage: "Check your connection and try again. You're still signed in.",
  Rn_SignOutRetry: 'Try again',
  /**
   * The sign-out card while it works (the round-3 mockup): the title and the
   * caption change to say the session is waiting for the upload, and the block
   * under them is the bar, the counted line and the reassurance - no spinner,
   * because the bar already reports the progress.
   */
  Rn_SignOutSyncingTitle: 'Syncing before sign-out',
  Rn_SignOutSyncingMessage: "You'll be signed out when syncing finishes.",
  Rn_SignOutSyncingCount: '{0} of {1} changes synced',
  Rn_SignOutSyncingCountOne: '{0} of {1} change synced',
  Rn_SignOutSyncingHint: 'Please keep the app open.',
  /**
   * The sign-in sheet: a whole-screen-worthy card that rises from the bottom
   * edge while the account's dataset is downloaded (the round-3 mockup). The
   * title is constant, the subtitle names the current step, and the line under
   * the bar counts the documents that actually arrived.
   */
  Rn_SyncSheetTitle: 'Syncing your data',
  Rn_SyncSheetPreparing: 'Preparing your account',
  Rn_SyncSheetUploading: 'Uploading the meals saved on this device',
  Rn_SyncSheetDownloading: 'Downloading your saved meals and photos',
  Rn_SyncSheetWaiting: 'Waiting for the connection… retrying',
  Rn_SyncSheetOpening: 'Opening your account',
  Rn_SyncSheetReceived: '{0} of {1} items received',
  Rn_SyncSheetSent: '{0} of {1} items sent',
  Rn_SyncSheetHint: 'Keep the app open until syncing finishes.',
  /**
   * Sign-in outcomes that are NOT failures. The bar's deadline lets the user in
   * while the rest of the dataset is still arriving (the background triggers
   * finish it), and a few documents may fail to apply once and be retried - in
   * both cases the old wording ("the data could not be loaded yet, use
   * Synchronize now") was wrong and alarming, because the data WAS being loaded.
   */
  Rn_SignInStillArriving: 'Signed in. The rest of your data is still arriving and will appear in a moment.',
  Rn_SignInPartial: 'Signed in. {0} item(s) could not be loaded yet; the app will keep trying.',
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
 * "Tue, 3 Nov" - the compact weekday + day + abbreviated month the calendar's
 * selected-day heading uses. The year is omitted because the month label above
 * already carries it.
 */
export function formatCompactDayMonth(date: string): string {
  const [year, month, day] = date.split('-').map(Number);
  if (!year || !month || !day || month < 1 || month > 12) {
    return date;
  }
  const weekday = WEEKDAY_SHORT[new Date(year, month - 1, day).getDay()] ?? '';
  return `${weekday}, ${day} ${MONTH_NAMES[month - 1].slice(0, 3)}`;
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