// Domain unit tests (spec 16.1) - ported intent of the Windows suites:
// completion rules (future-locked, idempotent done, sticky missed,
// empty-content), five-slot permanence/normalization, validators, photo
// rules, copy/template rules, analytics percentages (incl. the "–" case),
// sync frequency + backoff, payload round-trip and the string table.

import { MealCategoryKey, MealStatus, SyncFrequency } from '../src/domain/enums';
import { MealEntry, ReminderSettings } from '../src/domain/models';
import {
  isFutureMeal,
  markDone,
  markMissed,
  toLocalDateString,
} from '../src/domain/rules/completionRules';
import { ALL_SLOTS, findMissingSlots, newGuid, normalize } from '../src/domain/rules/mealSlotRules';
import {
  canAddPhoto,
  hasValidSignature,
  MAX_PHOTOS_PER_MEAL,
  mimeTypeFromExtension,
} from '../src/domain/rules/photoRules';
import { copyMealToDate, createDayTemplate } from '../src/domain/rules/mealCopyRules';
import { hasUserContent, isPlaceholder } from '../src/domain/rules/mealContentRules';
import { cadence, isDue, isPassivePullAllowed } from '../src/domain/rules/syncFrequencyRules';
import { validateMealEntry, validatePhoto, validateReminder } from '../src/domain/validation';
import { averagePercentage, addDays, forDay, forRange, startOfWeek } from '../src/domain/analytics';
import { backoffDelayMs } from '../src/cloud/syncEngine';
import { mealEntryFromPayload, mealEntryToPayload } from '../src/domain/payloads';
import { parseEnvelope, readEnvelopeHeader, serializeEnvelope } from '../src/domain/json';
import { sha256OfString } from '../src/domain/hashing';
import { STRINGS } from '../src/ui/strings.generated';
import { t, tFmt } from '../src/ui/strings';
import { toDriveName, toLogicalPath } from '../src/cloud/driveProvider';

const NOW = new Date('2026-01-10T12:00:00.000Z');

function makeEntry(overrides: Partial<MealEntry> = {}): MealEntry {
  return {
    id: newGuid(),
    localProfileId: newGuid(),
    date: '2026-01-10',
    mealCategoryId: newGuid(),
    mealCategoryKey: MealCategoryKey.Breakfast,
    title: 'Porridge',
    ingredients: 'Oats and berries',
    plannedTime: '07:30:00',
    status: MealStatus.Pending,
    completedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    revision: 0,
    syncStatus: 0,
    cloudRevision: null,
    contentHash: null,
    ...overrides,
  };
}

describe('CompletionRules (5.3)', () => {
  test('future meals are locked in PENDING', () => {
    const entry = makeEntry({ date: '2026-01-11' });
    expect(isFutureMeal(entry, NOW)).toBe(true);
    expect(markDone(entry, NOW).reason).toBe('future-locked');
    expect(markMissed(entry, NOW).reason).toBe('future-locked');
    expect(entry.status).toBe(MealStatus.Pending);
  });

  test('mark done is idempotent and keeps the original timestamp', () => {
    const entry = makeEntry();
    expect(markDone(entry, NOW).changed).toBe(true);
    const timestamp = entry.completedAt;
    const second = markDone(entry, NOW);
    expect(second.reason).toBe('already-done');
    expect(entry.completedAt).toBe(timestamp);
    expect(entry.revision).toBe(1);
  });

  test('empty content cannot be confirmed (empty-content)', () => {
    const entry = makeEntry({ title: '  ', ingredients: '' });
    expect(markDone(entry, NOW).reason).toBe('empty-content');
    expect(entry.status).toBe(MealStatus.Pending);
  });

  test('missed is sticky - it never cycles back to pending', () => {
    const entry = makeEntry();
    expect(markMissed(entry, NOW).changed).toBe(true);
    expect(entry.completedAt).toBeNull();
    expect(markMissed(entry, NOW).reason).toBe('already-missed');
    expect(entry.status).toBe(MealStatus.Missed);
  });
});

describe('MealSlotRules (5.1)', () => {
  test('five permanent slots in canonical order', () => {
    expect(ALL_SLOTS).toHaveLength(5);
    expect(ALL_SLOTS[0]).toBe(MealCategoryKey.Breakfast);
    expect(ALL_SLOTS[4]).toBe(MealCategoryKey.Dinner);
  });

  test('normalize heals a database that lost a category row', () => {
    const healed = normalize([]);
    expect(healed).toHaveLength(5);
    const withHole = healed.filter((c) => c.fixedCategoryKey !== MealCategoryKey.Lunch);
    expect(findMissingSlots(withHole)).toContain(MealCategoryKey.Lunch);
    expect(normalize(withHole)).toHaveLength(5);
  });

  test('guids follow the lowercase .NET shape', () => {
    expect(newGuid()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
});

describe('PhotoRules (5.6)', () => {
  test('limit is three photos per meal', () => {
    expect(canAddPhoto(2)).toBe(true);
    expect(canAddPhoto(MAX_PHOTOS_PER_MEAL)).toBe(false);
  });

  test('extension mapping and signature sniffing', () => {
    expect(mimeTypeFromExtension('.JPG')).toBe('image/jpeg');
    expect(mimeTypeFromExtension('.gif')).toBeNull();
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(hasValidSignature('image/jpeg', jpeg)).toBe(true);
    const exe = new Uint8Array([0x4d, 0x5a, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(hasValidSignature('image/jpeg', exe)).toBe(false);
  });

  test('photo validation: format, empty, size', () => {
    const header = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(validatePhoto('a.jpg', 1024, header).isValid).toBe(true);
    expect(validatePhoto('a.gif', 1024, header).failures[0].code).toBe('photo.format.unsupported');
    expect(validatePhoto('a.jpg', 0, header).failures[0].code).toBe('photo.empty');
    expect(validatePhoto('a.jpg', 11 * 1024 * 1024, header).failures[0].code).toBe('photo.tooLarge');
  });
});

describe('Copy rules (5.7)', () => {
  test('copies are always PENDING without completion data', () => {
    const source = makeEntry({ status: MealStatus.Done, completedAt: '2026-01-10T08:00:00.000Z' });
    const copy = copyMealToDate(source, '2026-01-11', source.localProfileId, new Date());
    expect(copy.status).toBe(MealStatus.Pending);
    expect(copy.completedAt).toBeNull();
    expect(copy.revision).toBe(0);
    expect(copy.id).not.toBe(source.id);
    expect(source.status).toBe(MealStatus.Done); // source untouched
  });

  test('day templates drop completion evidence (never status/completedAt)', () => {
    const meals = [makeEntry({ status: MealStatus.Done, completedAt: 'x' })];
    const template = createDayTemplate(meals, meals[0].localProfileId, '2026-01-10', new Date());
    expect(template.isFullDay).toBe(true);
    expect(template.templateDay[0].title).toBe('Porridge');
    expect(JSON.stringify(template)).not.toContain('completedAt');
  });
});

describe('MealContentRules (7.3)', () => {
  test('placeholders are skipped during synchronization', () => {
    const blank = makeEntry({ title: '', ingredients: '', plannedTime: null });
    expect(isPlaceholder(blank)).toBe(true);
    expect(hasUserContent(makeEntry())).toBe(true);
    expect(hasUserContent(blank, 2)).toBe(true); // photos count as content
  });
});

describe('SyncFrequencyRules + backoff (8.8 / 16.3)', () => {
  test('cadences and due logic', () => {
    expect(cadence(SyncFrequency.Weekly)).toBe(7 * 24 * 60 * 60 * 1000);
    expect(cadence(SyncFrequency.Manual)).toBeNull();
    expect(isDue(SyncFrequency.Manual, null)).toBe(false);
    expect(isDue(SyncFrequency.Weekly, null)).toBe(true); // first cycle always due
    expect(isDue(SyncFrequency.Weekly, 1000)).toBe(false);
    expect(isDue(SyncFrequency.Weekly, 8 * 24 * 60 * 60 * 1000)).toBe(true);
  });

  test('the passive pull of an open app ignores the schedule but honours "only with the button"', () => {
    // The other device's changes must appear within a minute even on a weekly schedule.
    expect(isPassivePullAllowed(SyncFrequency.Weekly)).toBe(true);
    expect(isPassivePullAllowed(SyncFrequency.Monthly)).toBe(true);
    // "Only with the button below" is the user asking for no automatic cloud traffic at all.
    expect(isPassivePullAllowed(SyncFrequency.Manual)).toBe(false);
  });

  test('exponential backoff capped at five minutes', () => {
    expect(backoffDelayMs(0)).toBe(5000);
    expect(backoffDelayMs(1)).toBe(10000);
    expect(backoffDelayMs(10)).toBe(300000);
  });
});

describe('Validators', () => {
  test('meal entry requires title and description from editors', () => {
    const result = validateMealEntry(makeEntry({ title: '' }), true);
    expect(result.isValid).toBe(false);
    expect(result.failures[0].code).toBe('meal.title.required');
    expect(validateMealEntry(makeEntry({ title: '', ingredients: '' }), false).isValid).toBe(true);
  });

  test('completed meals carry a timestamp, others never', () => {
    expect(
      validateMealEntry(makeEntry({ status: MealStatus.Done, completedAt: null }), false).isValid,
    ).toBe(false);
    expect(
      validateMealEntry(makeEntry({ status: MealStatus.Pending, completedAt: 'x' }), false).isValid,
    ).toBe(false);
  });

  test('reminder weekday mask + snooze range', () => {
    expect(
      validateReminder({ weekdays: 0, snoozeMinutes: 10, mealCategoryId: 'x' }).failures[0].code,
    ).toBe('reminder.weekdays.empty');
    expect(
      validateReminder({ weekdays: 127, snoozeMinutes: 200, mealCategoryId: 'x' }).failures[0].code,
    ).toBe('reminder.snooze.outOfRange');
    expect(
      validateReminder({ weekdays: 127, snoozeMinutes: 10, mealCategoryId: 'x' }).isValid,
    ).toBe(true);
  });
});

describe('Analytics (5.8 / 8.6)', () => {
  test('day percentage = completed / 5', () => {
    const empty = forDay('2026-01-10', []);
    expect(empty.percentage).toBe(0);
    expect(empty.hasDecided).toBe(false);
    const day = forDay('2026-01-10', [makeEntry({ status: MealStatus.Done, completedAt: 'x' })]);
    expect(day.percentage).toBe(20);
    expect(day.decided).toBe(1);
  });

  test('period ratio uses the decided denominator; untouched period has no ratio', () => {
    const entries = new Map<string, MealEntry[]>();
    entries.set('2026-01-05', [makeEntry({ status: MealStatus.Done, completedAt: 'x' })]);
    entries.set('2026-01-06', [makeEntry({ status: MealStatus.Missed })]);
    const week = forRange('2026-01-05', '2026-01-11', entries);
    expect(week.decided).toBe(2);
    expect(week.percentage).toBe(50); // 1 of 2 decided
    const untouched = forRange('2026-02-01', '2026-02-07', new Map());
    expect(untouched.hasDecided).toBe(false); // UI prints "–"
    expect(averagePercentage(untouched.days)).toBe(0);
  });

  test('weeks start on Monday (ISO 8601)', () => {
    expect(startOfWeek('2026-01-10')).toBe('2026-01-05'); // Saturday -> Monday
    expect(startOfWeek('2026-01-05')).toBe('2026-01-05');
  });
});

describe('Calendar day stepping (8.5 - DST safe)', () => {
  it('addDays advances the calendar date across a DST change', () => {
    // Europe/Berlin (and every zone with DST) falls back at the end of
    // October and springs forward at the end of March; a millisecond step of
    // exactly 24 h would land on the same date again and hang the month loop.
    expect(addDays('2026-10-24', 1)).toBe('2026-10-25');
    expect(addDays('2026-10-25', 1)).toBe('2026-10-26');
    expect(addDays('2026-03-28', 1)).toBe('2026-03-29');
    expect(addDays('2026-03-29', 1)).toBe('2026-03-30');
  });

  it('walks a whole October without repeating a day', () => {
    const seen: string[] = [];
    let cursor = '2026-10-01';
    while (cursor <= '2026-10-31') {
      seen.push(cursor);
      const next = addDays(cursor, 1);
      if (next <= cursor) {
        break;
      }
      cursor = next;
    }
    expect(seen).toHaveLength(31);
    expect(seen[0]).toBe('2026-10-01');
    expect(seen[30]).toBe('2026-10-31');
  });
});

describe('Payload + envelope round trip (16.4)', () => {
  test('meal payload survives encode/decode with string enums', () => {
    const entry = makeEntry({ status: MealStatus.Missed });
    const payload = mealEntryToPayload(entry);
    expect(payload.status).toBe('Missed');
    expect(payload.mealCategoryKey).toBe('Breakfast');
    const back = mealEntryFromPayload(payload);
    expect(back.status).toBe(MealStatus.Missed);
    expect(back.title).toBe(entry.title);
    expect(back.completedAt).toBeNull();
  });

  test('envelope serializes camelCase with a readable header', () => {
    const envelope = {
      schemaVersion: 1,
      entityType: 1,
      entityId: newGuid(),
      localProfileId: newGuid(),
      revision: 3,
      updatedAt: '2026-01-10T12:00:00.000Z',
      deviceId: newGuid(),
      isDeleted: false,
      contentHash: sha256OfString('x'),
      payload: mealEntryToPayload(makeEntry()),
    };
    const json = serializeEnvelope(envelope);
    const header = readEnvelopeHeader(json);
    expect(header).not.toBeNull();
    expect(header?.entityId).toBe(envelope.entityId);
    expect(header?.revision).toBe(3);
    expect(readEnvelopeHeader('{ not json')).toBeNull();
    expect(parseEnvelope(json)?.payload).not.toBeNull();
    // Windows writes enums as strings (JsonStringEnumConverter).
    expect(json).toContain('"entityType": "MealEntry"');
  });

  test('corrupt documents never crash the header reader (7.4)', () => {
    expect(readEnvelopeHeader('')).toBeNull();
    expect(readEnvelopeHeader('{"entityId":"nope"}')).toBeNull();
  });
});

describe('Drive addressing parity (7.4)', () => {
  test('flat file names round-trip like Windows ToDriveName/ToLogicalPath', () => {
    const logical = 'entities/MealEntry/12345678-1234-1234-1234-123456789012.json';
    const flat = toDriveName(logical);
    expect(flat).not.toContain('/');
    expect(toLogicalPath(flat)).toBe(logical);
    expect(toDriveName('photos/x.bin')).toBe('photos__x.bin');
  });
});

describe('English string table (1.5 / 16.5)', () => {
  test('parity keys from the Windows resw exist', () => {
    expect(STRINGS.Meal_Breakfast_Name).toBe('Breakfast');
    expect(t('Nav_Dashboard')).toBe('Today');
    expect(t('NoSuch_Key')).toBe('NoSuch_Key');
  });

  test('.NET style {0} formatting', () => {
    expect(tFmt('Calendar_DaySummary', 1, 2, 3)).toBe('1 confirmed, 2 missed, 3 pending');
  });

  test('.NET numeric specifiers {0:0.#} are formatted, not printed', () => {
    // Statistics breakdown, storage usage and the account quota line carry
    // custom specifiers - they must never reach the UI as literal braces.
    expect(tFmt('Statistics_Breakdown', 42.5, 7.25, 50)).toBe(
      'Done 42.5 % · Missed 7.3 % · Pending 50 %',
    );
    expect(tFmt('Account_Quota', 14.83)).toBe('Cloud space left: 14.8 GB');
    expect(tFmt('Account_Quota', 15)).toBe('Cloud space left: 15 GB');
    expect(tFmt('Settings_StorageUsage', 2.5)).toBe('Stored photographs: 2.5 MB');
    expect(tFmt('Settings_StorageUsage', 0)).toBe('Stored photographs: 0 MB');
  });
});

describe('Reminder weekday bitmask (10.1)', () => {
  const reminder: ReminderSettings = {
    id: 'r',
    localProfileId: 'p',
    mealCategoryId: 'c',
    mealCategoryKey: MealCategoryKey.Breakfast,
    enabled: true,
    time: '08:00:00',
    weekdays: 127,
    snoozeMinutes: 10,
    updatedAt: '',
    syncStatus: 0,
  };

  test('Sunday = bit 0, all days = 127', () => {
    expect(reminder.weekdays).toBe(127);
    expect(reminder.weekdays & (1 << 0)).toBeTruthy(); // Sunday applies
    expect(reminder.weekdays & (1 << 6)).toBeTruthy(); // Saturday applies
    expect(toLocalDateString(NOW)).toBe('2026-01-10');
  });
});