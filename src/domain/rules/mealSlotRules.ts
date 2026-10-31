// Port of DietTracker.Core.BusinessRules.MealSlotRules.
//
// The five meal categories are immutable in number and identity. Users may
// change content, colour, icon, default time and display order, but they can
// never delete a card: every calendar date always exposes exactly five slots
// (spec 5.1).

import { MealCategoryKey } from '../enums';
import { MealCategory } from '../models';

/** Number of permanent meal slots per day (always five). */
export const SLOT_COUNT = 5;

/** The five permanent slot keys in canonical display order. */
export const ALL_SLOTS: MealCategoryKey[] = [
  MealCategoryKey.Breakfast,
  MealCategoryKey.MorningSnack,
  MealCategoryKey.Lunch,
  MealCategoryKey.AfternoonSnack,
  MealCategoryKey.Dinner,
];

/** Slots rendered as full size "main meal" cards. */
export const MAIN_MEAL_SLOTS: MealCategoryKey[] = [
  MealCategoryKey.Breakfast,
  MealCategoryKey.Lunch,
  MealCategoryKey.Dinner,
];

/** Slots rendered as compact snack cards. */
export const SNACK_SLOTS: MealCategoryKey[] = [
  MealCategoryKey.MorningSnack,
  MealCategoryKey.AfternoonSnack,
];

export function isPermanent(key: MealCategoryKey): boolean {
  return ALL_SLOTS.includes(key);
}

export function isMainMeal(key: MealCategoryKey): boolean {
  return MAIN_MEAL_SLOTS.includes(key);
}

export function isSnack(key: MealCategoryKey): boolean {
  return SNACK_SLOTS.includes(key);
}

let cachedDefaults: MealCategory[] | null = null;

/**
 * Creates the default definition of the five permanent categories (never fewer,
 * never more). Default pictograms are food emoji because the Segoe Fluent icon
 * font has no food glyphs. Colours/times/order match the Windows defaults.
 * Ids are stable per install via newGuid() at first creation.
 */
export function createDefaults(): MealCategory[] {
  return [
    {
      id: newGuid(),
      fixedCategoryKey: MealCategoryKey.Breakfast,
      name: '',
      color: '#FF0F6CBD',
      icon: '\u{1F950}\u{FE0F}', // croissant
      defaultTime: '07:30:00',
      displayOrder: 0,
    },
    {
      id: newGuid(),
      fixedCategoryKey: MealCategoryKey.MorningSnack,
      name: '',
      color: '#FF8764B8',
      icon: '\u{1F36A}\u{FE0F}', // cookie
      defaultTime: '10:30:00',
      displayOrder: 1,
    },
    {
      id: newGuid(),
      fixedCategoryKey: MealCategoryKey.Lunch,
      name: '',
      color: '#FF107C10',
      icon: '\u{1F37D}\u{FE0F}', // plate with cutlery
      defaultTime: '13:30:00',
      displayOrder: 2,
    },
    {
      id: newGuid(),
      fixedCategoryKey: MealCategoryKey.AfternoonSnack,
      name: '',
      color: '#FFCA5010',
      icon: '\u{1F36A}\u{FE0F}', // cookie
      defaultTime: '17:00:00',
      displayOrder: 3,
    },
    {
      id: newGuid(),
      fixedCategoryKey: MealCategoryKey.Dinner,
      name: '',
      color: '#FFB146C2',
      icon: '\u{1F372}\u{FE0F}', // pot of food
      defaultTime: '20:00:00',
      displayOrder: 4,
    },
  ];
}

/** Memoized defaults (ids stay stable across calls within the session). */
export function defaultCategories(): MealCategory[] {
  if (cachedDefaults === null) {
    cachedDefaults = createDefaults();
  }
  return cachedDefaults.map((c) => ({ ...c }));
}

/** Reports the permanent slots missing from a category collection. */
export function findMissingSlots(categories: MealCategory[]): MealCategoryKey[] {
  const present = new Set(categories.map((c) => c.fixedCategoryKey));
  return ALL_SLOTS.filter((key) => !present.has(key));
}

/**
 * Merges persisted categories with the permanent defaults so a database that
 * lost a row (partial restore) is healed instead of showing fewer than five
 * cards. Existing user customizations are preserved (spec 5.1).
 */
export function normalize(persisted: MealCategory[] | null | undefined): MealCategory[] {
  const existing: MealCategory[] = [...(persisted ?? [])];
  for (const def of createDefaults()) {
    if (existing.some((c) => c.fixedCategoryKey === def.fixedCategoryKey)) {
      continue;
    }
    existing.push(def);
  }
  const permanent = existing.filter((c) => isPermanent(c.fixedCategoryKey));
  const seen = new Set<MealCategoryKey>();
  const deduped: MealCategory[] = [];
  for (const c of permanent) {
    if (!seen.has(c.fixedCategoryKey)) {
      seen.add(c.fixedCategoryKey);
      deduped.push(c);
    }
  }
  return deduped.sort((a, b) => a.fixedCategoryKey - b.fixedCategoryKey);
}

/** Next slot key in display order (wraps around). */
export function nextSlot(current: MealCategoryKey): MealCategoryKey {
  const index = ALL_SLOTS.indexOf(current);
  return ALL_SLOTS[(index + 1) % ALL_SLOTS.length];
}

/** RFC 4122 v4 GUID, lowercase - same shape as .NET Guid "d" format. */
export function newGuid(): string {
  const bytes = new Uint8Array(16);
  const globalObject = globalThis as unknown as {
    crypto?: { getRandomValues?: (array: Uint8Array) => Uint8Array };
  };
  if (globalObject.crypto?.getRandomValues) {
    globalObject.crypto.getRandomValues(bytes);
  } else {
    // Test environments without WebCrypto - record ids do not need CSPRNG.
    for (let i = 0; i < bytes.length; i += 1) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}