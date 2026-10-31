// English string table - the generated mirror of the Windows Resources.resw
// plus a .NET-style format helper ("{0} of {1}"). English only (spec 1.5).

import { STRINGS } from './strings.generated';

/**
 * Looks up a resource key. Missing keys return the key itself so a typo is
 * visible in the UI instead of a crash.
 */
export function t(key: string): string {
  return STRINGS[key] ?? key;
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