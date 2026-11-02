// Regression tests for the date hand-off helpers.
//
// The defect they pin: tapping the diary date navigated to the Calendar WITHOUT
// the date, so the Calendar showed today; and even when a date was sent, asking
// for the SAME date again left the effect dormant because only the date string
// was compared. A request id makes the repeat observable.

import {
  dateHandoff,
  dateInputProblem,
  isCalendarDate,
  readDateHandoff,
} from '../src/ui/dates';

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
