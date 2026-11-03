// The "Save day as template" NAME prompt - what the field starts with and what
// it refuses.
//
// The name is TYPED, never guessed. The prompt used to be pre-filled with the
// day's `yyyy-MM-dd` (that same value was also its placeholder) and an empty
// answer fell back to that date behind the user's back, so "Save day as
// template" produced templates named "2026-11-03" that nobody had chosen - and
// the list then had to render them as dates to stay readable.
//
// Now the field starts EMPTY and hints at nothing, and an empty answer is
// refused in place with a message, so the day's date can never become a name
// again. A date typed DELIBERATELY is still accepted: it is the user's choice.

/** What the field holds when the prompt opens: nothing, on purpose. */
export const TEMPLATE_NAME_START = '';

/** Why a typed template name cannot be saved, or null when it can. */
export function templateNameProblem(value: string): 'blank' | null {
  return value.trim() === '' ? 'blank' : null;
}
