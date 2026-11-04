// Character policy of the INLINE MEAL EDITOR only.
//
// The domain keeps its own, much wider limits (`MAX_TITLE_LENGTH` 120 /
// `MAX_INGREDIENTS_LENGTH` 2000 in domain/validation.ts) because imported and
// synced data written by Windows has to stay valid. This module narrows only
// what a PHONE user may TYPE into one meal card, so the compact editor can be a
// pair of shallow single-line fields instead of two growing text wells.
//
// Two rules keep that narrowing from ever losing data:
//
//   1. a change is accepted when it fits the limit, or when it does not GROW
//      text that is already longer than the limit - so a legacy value can be
//      kept or shortened, never silently cut,
//   2. nothing is ever sliced. An over-limit change (typing or a paste) is
//      refused AS A WHOLE and the previous draft stays; a surrogate pair or an
//      emoji sequence is therefore never split in half.
//
// Counting is by Unicode code point (`Array.from(value).length`), NOT by the
// UTF-16 length React Native's native `maxLength` would use. The two disagree
// for every emoji ("🍲".length === 2), which is why this editor sets no native
// maxLength at all: the controlled guard below is the single ceiling.

/** Longest meal name the compact editor accepts. */
export const EDITOR_TITLE_LIMIT = 40;

/** Longest description the compact editor accepts. */
export const EDITOR_DESCRIPTION_LIMIT = 80;

/** Length of a string in Unicode code points, for counters and guards alike. */
export function characterCount(value: string): number {
  return Array.from(value).length;
}

/**
 * True when a keystroke or paste may replace `previous` with `next`: it fits the
 * limit, or it is no longer than the value it replaces (an existing longer
 * value may stay as it is or be shortened, but never grow).
 */
export function canAcceptTextChange(previous: string, next: string, limit: number): boolean {
  const nextLength = characterCount(next);
  return nextLength <= limit || nextLength <= characterCount(previous);
}

/**
 * The SAVE-side half of the same policy, called by the shared `runSave` path so
 * that a single Save and a dashboard "Save all" apply one rule:
 *
 *   * content within the limit is always fine,
 *   * content over the limit is fine while it is unchanged or shortened against
 *     the text the edit session opened with - a time-only edit of a long saved
 *     meal must not force the user to rewrite it.
 */
export function isDraftLengthAllowed(original: string, draft: string, limit: number): boolean {
  const originalLength = characterCount(original);
  const draftLength = characterCount(draft);
  return draftLength <= limit || (originalLength > limit && draftLength <= originalLength);
}
