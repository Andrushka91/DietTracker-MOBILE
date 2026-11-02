// Date input and date hand-off helpers.
//
// Two problems are solved here, both purely:
//
//  1. "Is this typed value a real calendar day?" - the template prompt used to
//     fall back to today when the text made no sense, which applied a template
//     to the wrong day. The three answers (blank / wrong shape / impossible day
//     such as 31 February) let the dialog explain what to correct.
//  2. "Is this the same request again?" - a screen-to-screen hand-off carries a
//     monotonically increasing id, so asking for the SAME date a second time
//     still fires the receiving effect (a plain `date` parameter would not change
//     and the Calendar would keep the month the user browsed to in between).

import { formatDate, parseDate } from '../domain/analytics';

/** Why a typed date cannot be used, or null when it can. */
export type DateInputProblem = 'blank' | 'format' | 'impossible';

/**
 * True for a real calendar day written exactly as `yyyy-MM-dd`.
 *
 * `parseDate` rolls an impossible day forward (31 February becomes 3 March), so
 * the value only counts when the round trip returns the same text.
 */
export function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const parsed = parseDate(value);
  return !Number.isNaN(parsed.getTime()) && formatDate(parsed) === value;
}

/** Classifies a typed date for the template target prompt. */
export function dateInputProblem(value: string): DateInputProblem | null {
  const trimmed = value.trim();
  if (trimmed === '') {
    return 'blank';
  }
  if (!isCalendarDate(trimmed)) {
    // A value of the right shape that does not survive the round trip is an
    // impossible day; anything else has the wrong shape (or is not a date).
    return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? 'impossible' : 'format';
  }
  return null;
}

/**
 * One screen-to-screen date hand-off: the day plus the id of this request.
 * The id is what makes a repeated identical request observable.
 */
export interface DateHandoff {
  date: string;
  requestId: number;
}

let lastRequestId = 0;

/** Builds the parameters for a deliberate date hand-off. */
export function dateHandoff(date: string): DateHandoff {
  lastRequestId += 1;
  return { date, requestId: lastRequestId };
}

/** Reads a hand-off out of untyped navigation params, ignoring anything invalid. */
export function readDateHandoff(params: unknown): DateHandoff | null {
  if (params === null || typeof params !== 'object') {
    return null;
  }
  const { date, requestId } = params as { date?: unknown; requestId?: unknown };
  if (typeof date !== 'string' || !isCalendarDate(date)) {
    return null;
  }
  return {
    date,
    requestId: typeof requestId === 'number' && Number.isFinite(requestId) ? requestId : 0,
  };
}
