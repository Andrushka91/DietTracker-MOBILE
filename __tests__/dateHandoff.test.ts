// Regression tests for the date hand-off helpers.
//
// The defect they pin: tapping the diary date navigated to the Calendar WITHOUT
// the date, so the Calendar showed today; and even when a date was sent, asking
// for the SAME date again left the effect dormant because only the date string
// was compared. A request id makes the repeat observable.

import {
  dateDraft,
  dateHandoff,
  dateInputProblem,
  isCalendarDate,
  readDateHandoff,
  DATE_INPUT_LENGTH,
} from '../src/ui/dates';

describe('date input mask', () => {
  test('keeps the digits and drops every other character', () => {
    expect(dateDraft('2026-11-02')).toBe('2026-11-02');
    expect(dateDraft('2026/11/02')).toBe('2026-11-02');
    expect(dateDraft('2026.11.02')).toBe('2026-11-02');
    expect(dateDraft('2026 11 02')).toBe('2026-11-02');
    // The reported bug: a letter could be typed into a date.
    expect(dateDraft('next friday')).toBe('');
    expect(dateDraft('2026-1a1-b2')).toBe('2026-11-2');
    expect(dateDraft('2026-11-02abc')).toBe('2026-11-02');
  });

  test('inserts the two dashes as the digits arrive', () => {
    expect(dateDraft('')).toBe('');
    expect(dateDraft('2')).toBe('2');
    expect(dateDraft('2026')).toBe('2026');
    expect(dateDraft('20261')).toBe('2026-1');
    expect(dateDraft('202611')).toBe('2026-11');
    expect(dateDraft('2026110')).toBe('2026-11-0');
    expect(dateDraft('20261102')).toBe('2026-11-02');
  });

  test('never grows past one whole date', () => {
    // A pasted timestamp or a pasted run of extra digits is cut at the day.
    expect(dateDraft('2026-11-02T10:30:00Z')).toBe('2026-11-02');
    expect(dateDraft('2026110212345')).toBe('2026-11-02');
    expect(dateDraft('2026-11-02').length).toBe(DATE_INPUT_LENGTH);
  });

  test('only ever produces a prefix of yyyy-MM-dd', () => {
    // Whatever is typed or pasted, the field holds a shape the validator can
    // reason about - never two dates, never a letter, never a stray dash.
    for (const typed of ['', 'abc', '2026-02-31', '2026-13-01', '----', '2 0 2 6 1 1',
      '2026-11-02 2027-01-01', '0000-00-00', '99999999999999']) {
      expect(dateDraft(typed)).toMatch(/^\d{0,4}(-\d{0,2}(-\d{0,2})?)?$/);
    }
  });
});

describe('date input validation', () => {
  test('classifies blank, malformed and impossible values', () => {
    expect(dateInputProblem('')).toBe('blank');
    expect(dateInputProblem('   ')).toBe('blank');
    expect(dateInputProblem('2026-2-3')).toBe('format');
    expect(dateInputProblem('tomorrow')).toBe('format');
    expect(dateInputProblem('2026-02-31')).toBe('impossible');
    expect(dateInputProblem('2026-13-01')).toBe('impossible');
    expect(dateInputProblem('2026-11-02')).toBeNull();
  });

  test('only a real calendar day is accepted (leap years included)', () => {
    expect(isCalendarDate('2026-11-02')).toBe(true);
    expect(isCalendarDate('2024-02-29')).toBe(true);
    expect(isCalendarDate('2026-02-29')).toBe(false);
    expect(isCalendarDate('02-11-2026')).toBe(false);
  });
});

describe('date hand-off', () => {
  test('a repeated request for the same date is a NEW request', () => {
    const first = dateHandoff('2026-11-01');
    const second = dateHandoff('2026-11-01');
    expect(first.date).toBe(second.date);
    expect(second.requestId).toBeGreaterThan(first.requestId);
  });

  test('invalid or missing navigation parameters are ignored', () => {
    expect(readDateHandoff(undefined)).toBeNull();
    expect(readDateHandoff({ date: '2026-02-31' })).toBeNull();
    expect(readDateHandoff({ date: 42 })).toBeNull();
    expect(readDateHandoff({ date: '2026-11-01' })).toEqual({
      date: '2026-11-01',
      requestId: 0,
    });
    expect(readDateHandoff(dateHandoff('2026-11-01'))?.date).toBe('2026-11-01');
  });
});
