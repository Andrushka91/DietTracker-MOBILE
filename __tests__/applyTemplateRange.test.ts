// The inclusive-range wrapper around the EXISTING single-day `applyTemplate`.
//
// These tests pin only the NEW batch behaviour: which days are walked, in what
// order, how many times, what a rejection reports, and that an invalid or
// reversed range writes NOTHING. The single-day merge/slot logic itself is not
// re-tested here - it is untouched and covered by its own suites.

import {
  applyTemplateRange,
  templateRangeDays,
  validateTemplateRange,
  type TemplateDateRange,
} from '../src/services/applyTemplateRange';

/** Records every day the wrapper asks for, in call order. */
function recorder() {
  const days: string[] = [];
  const applyDay = jest.fn(async (iso: string) => {
    days.push(iso);
  });
  return { days, applyDay };
}

/** A range written the way the app writes it. */
function range(startDate: string, endDate: string): TemplateDateRange {
  return { startDate, endDate };
}

describe('counting an inclusive range', () => {
  test('the same start and end is ONE day, not zero', () => {
    expect(templateRangeDays(range('2026-11-02', '2026-11-02'))).toBe(1);
  });

  test('both ends are included', () => {
    expect(templateRangeDays(range('2026-11-05', '2026-11-11'))).toBe(7);
    expect(templateRangeDays(range('2026-01-01', '2026-01-02'))).toBe(2);
  });

  test('month, year and leap boundaries are counted by calendar days', () => {
    // Across a month end.
    expect(templateRangeDays(range('2026-11-28', '2026-12-02'))).toBe(5);
    // Across a year end.
    expect(templateRangeDays(range('2026-12-30', '2027-01-02'))).toBe(4);
    // A leap day is a real day (2028 is a leap year)...
    expect(templateRangeDays(range('2028-02-27', '2028-03-01'))).toBe(4);
    // ...and a non-leap February simply has one fewer.
    expect(templateRangeDays(range('2026-02-27', '2026-03-01'))).toBe(3);
  });

  test('a DST change never adds or loses a day', () => {
    // Both sides of the usual clock changes: the count is calendar days, never
    // 86 400-second blocks.
    expect(templateRangeDays(range('2026-03-07', '2026-03-09'))).toBe(3);
    expect(templateRangeDays(range('2026-10-24', '2026-10-26'))).toBe(3);
  });
});

describe('validating a range before any write', () => {
  test('accepts an ordered range of real days', () => {
    expect(validateTemplateRange(range('2026-11-05', '2026-11-11'))).toBeNull();
    expect(validateTemplateRange(range('2026-11-05', '2026-11-05'))).toBeNull();
  });

  test('names the broken endpoint instead of guessing', () => {
    expect(validateTemplateRange(range('2026-1', '2026-11-11'))).toBe('invalid-start');
    expect(validateTemplateRange(range('2026-11-05', ''))).toBe('invalid-end');
    // 31 February is not a day, even though it has the right shape.
    expect(validateTemplateRange(range('2026-11-05', '2026-02-31'))).toBe('invalid-end');
    expect(validateTemplateRange(range('2026-11-11', '2026-11-05'))).toBe('end-before-start');
  });
});

describe('applying a range', () => {
  test('a single day calls the existing applier exactly ONCE', async () => {
    const { days, applyDay } = recorder();
    const result = await applyTemplateRange(range('2026-11-02', '2026-11-02'), { applyDay });
    expect(days).toEqual(['2026-11-02']);
    expect(applyDay).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      kind: 'complete',
      totalDays: 1,
      completedDays: 1,
      lastCompletedDate: '2026-11-02',
    });
  });

  test('walks every day from Start THROUGH End, in order, one at a time', async () => {
    const days: string[] = [];
    let inFlight = 0;
    let maxInFlight = 0;
    const sequential = jest.fn(async (iso: string) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await Promise.resolve();
      days.push(iso);
      inFlight -= 1;
    });

    await applyTemplateRange(range('2026-11-05', '2026-11-11'), { applyDay: sequential });

    expect(days).toEqual([
      '2026-11-05',
      '2026-11-06',
      '2026-11-07',
      '2026-11-08',
      '2026-11-09',
      '2026-11-10',
      '2026-11-11',
    ]);
    // Never Promise.all: one day is written at a time.
    expect(maxInFlight).toBe(1);
    expect(sequential).toHaveBeenCalledTimes(7);
  });

  test('reports progress as completed DAYS out of the inclusive total', async () => {
    const { applyDay } = recorder();
    const progress: Array<[number, number]> = [];
    await applyTemplateRange(range('2026-11-05', '2026-11-07'), {
      applyDay,
      onProgress: (done, total) => progress.push([done, total]),
    });
    expect(progress).toEqual([
      [0, 3],
      [1, 3],
      [2, 3],
      [3, 3],
    ]);
  });

  test('crosses a month, a year and a clock change without skipping a day', async () => {
    const { days, applyDay } = recorder();
    await applyTemplateRange(range('2026-12-30', '2027-01-02'), { applyDay });
    expect(days).toEqual(['2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02']);

    days.length = 0;
    await applyTemplateRange(range('2026-03-07', '2026-03-09'), { applyDay });
    expect(days).toEqual(['2026-03-07', '2026-03-08', '2026-03-09']);
  });

  test('imposes no arbitrary maximum length', async () => {
    const { days, applyDay } = recorder();
    const result = await applyTemplateRange(range('2027-01-01', '2027-12-31'), { applyDay });
    expect(days).toHaveLength(365);
    expect(days[0]).toBe('2027-01-01');
    expect(days[364]).toBe('2027-12-31');
    expect(result).toEqual({
      kind: 'complete',
      totalDays: 365,
      completedDays: 365,
      lastCompletedDate: '2027-12-31',
    });
  });

  test('an invalid start writes NOTHING', async () => {
    const { applyDay } = recorder();
    await expect(applyTemplateRange(range('2026-1', '2026-11-11'), { applyDay })).rejects.toThrow(
      'invalid-start',
    );
    expect(applyDay).not.toHaveBeenCalled();
  });

  test('an invalid end writes NOTHING', async () => {
    const { applyDay } = recorder();
    await expect(applyTemplateRange(range('2026-11-05', ''), { applyDay })).rejects.toThrow(
      'invalid-end',
    );
    expect(applyDay).not.toHaveBeenCalled();
  });

  test('a reversed range writes NOTHING and is never swapped', async () => {
    const { applyDay } = recorder();
    await expect(
      applyTemplateRange(range('2026-11-11', '2026-11-05'), { applyDay }),
    ).rejects.toThrow('end-before-start');
    expect(applyDay).not.toHaveBeenCalled();
  });
});

describe('a range that fails part way', () => {
  /** Fails on the n-th day (1-based), after the earlier days succeeded. */
  function failingOn(failAt: number) {
    const days: string[] = [];
    let calls = 0;
    const applyDay = jest.fn(async (iso: string) => {
      calls += 1;
      if (calls === failAt) {
        throw new Error(`day ${iso} rejected`);
      }
      days.push(iso);
    });
    return { days, applyDay };
  }

  test('stops before the later days and says the failed one may be partial', async () => {
    const { days, applyDay } = failingOn(3);
    const result = await applyTemplateRange(range('2026-11-05', '2026-11-09'), { applyDay });

    expect(result).toMatchObject({
      kind: 'partial',
      totalDays: 5,
      completedDays: 2,
      lastCompletedDate: '2026-11-06',
      failedDate: '2026-11-07',
      failedDayMayBePartial: true,
      unattemptedDays: 2,
    });
    // The failed day was attempted; the two after it never were.
    expect(days).toEqual(['2026-11-05', '2026-11-06']);
    expect(applyDay.mock.calls.map((call) => call[0])).toEqual([
      '2026-11-05',
      '2026-11-06',
      '2026-11-07',
    ]);
  });

  test('a first-day failure leaves every later day unattempted', async () => {
    const { days, applyDay } = failingOn(1);
    const result = await applyTemplateRange(range('2026-11-05', '2026-11-08'), { applyDay });

    expect(result).toMatchObject({
      kind: 'partial',
      totalDays: 4,
      completedDays: 0,
      lastCompletedDate: null,
      failedDate: '2026-11-05',
      failedDayMayBePartial: true,
      unattemptedDays: 3,
    });
    expect(days).toEqual([]);
    expect(applyDay).toHaveBeenCalledTimes(1);
  });

  test('a same-day failure reports zero completed and zero unattempted', async () => {
    const { applyDay } = failingOn(1);
    const result = await applyTemplateRange(range('2026-11-05', '2026-11-05'), { applyDay });
    expect(result).toMatchObject({
      kind: 'partial',
      totalDays: 1,
      completedDays: 0,
      unattemptedDays: 0,
      failedDate: '2026-11-05',
    });
    expect(applyDay).toHaveBeenCalledTimes(1);
  });

  test('nothing in the result claims a rollback or a retry', async () => {
    const { applyDay } = failingOn(2);
    const result = await applyTemplateRange(range('2026-11-05', '2026-11-06'), { applyDay });
    expect(result.kind).toBe('partial');
    // There is no "rolledBack"/"clean" flag at all: a failed day may be partly
    // updated, and that is exactly what the sheet has to say.
    expect(result).not.toHaveProperty('rolledBack');
    expect(result).not.toHaveProperty('retried');
  });
});
