/**
 * Unit tests for the synchronous Cancel all registry (`cancelOpenDrafts`).
 *
 * Pinned behavior:
 *   • busy guard — returns blocked when any registered editor is still saving;
 *     no cancel callback runs.
 *   • empty — returns { kind: "empty" } when nothing is editing.
 *   • cancelled — fires one synchronous batch of all open editors, then returns
 *     the count; `beforeCancel` is called once before any `cancel()`.
 *   • partial — when some are editing and some are not, only the editing ones
 *     cancel; non-editing registered cards are left alone.
 */

import { cancelOpenDrafts } from "../src/ui/cancelOpenDrafts";

describe("cancelOpenDrafts", () => {
  function makeEditor(id: string, editing = true, saving = false) {
    const cancel = jest.fn();
    return {
      id,
      isEditing: () => editing,
      isSaving: () => saving,
      cancel,
    };
  }

  test('returns "blocked" and fires nothing while any editor is saving', () => {
    const beforeCancel = jest.fn();
    const a = makeEditor("a", true, false);
    const b = makeEditor("b", true, true);
    const result = cancelOpenDrafts([a, b], false, beforeCancel);
    expect(result).toEqual({ kind: "blocked", cancelled: 0 });
    expect(beforeCancel).not.toHaveBeenCalled();
    expect(a.cancel).not.toHaveBeenCalled();
    expect(b.cancel).not.toHaveBeenCalled();
  });

  test('returns "blocked" when the batch itself is busy, even if no editor saves', () => {
    const beforeCancel = jest.fn();
    const a = makeEditor("a", true, false);
    const result = cancelOpenDrafts([a], true, beforeCancel);
    expect(result).toEqual({ kind: "blocked", cancelled: 0 });
    expect(beforeCancel).not.toHaveBeenCalled();
    expect(a.cancel).not.toHaveBeenCalled();
  });

  test('returns "empty" when no editor is open', () => {
    const beforeCancel = jest.fn();
    const a = makeEditor("a", false, false);
    const result = cancelOpenDrafts([a], false, beforeCancel);
    expect(result).toEqual({ kind: "empty", cancelled: 0 });
    expect(beforeCancel).not.toHaveBeenCalled();
    expect(a.cancel).not.toHaveBeenCalled();
  });

  test('calls beforeCancel once, then cancels every open editor synchronously', () => {
    const beforeCancel = jest.fn();
    const a = makeEditor("a", true, false);
    const b = makeEditor("b", true, false);
    const result = cancelOpenDrafts([a, b], false, beforeCancel);
    expect(beforeCancel).toHaveBeenCalledTimes(1);
    // Synchronous: both are cancelled in the same tick.
    expect(a.cancel).toHaveBeenCalledTimes(1);
    expect(b.cancel).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ kind: "cancelled", cancelled: 2 });
  });

  test('only cancels editors that are actually editing', () => {
    const beforeCancel = jest.fn();
    const open = makeEditor("open", true, false);
    const closed = makeEditor("closed", false, false);
    const result = cancelOpenDrafts([open, closed], false, beforeCancel);
    expect(result).toEqual({ kind: "cancelled", cancelled: 1 });
    expect(open.cancel).toHaveBeenCalledTimes(1);
    expect(closed.cancel).not.toHaveBeenCalled();
  });

  test('returns the number of editors that were actually cancelled', () => {
    const beforeCancel = jest.fn();
    const e1 = makeEditor("e1", true, false);
    const e2 = makeEditor("e2", true, false);
    const e3 = makeEditor("e3", false, false);
    const result = cancelOpenDrafts([e1, e2, e3], false, beforeCancel);
    expect(result).toEqual({ kind: "cancelled", cancelled: 2 });
  });

  test('works with an iterator (not just an array)', () => {
    const beforeCancel = jest.fn();
    const gen = function* () {
      yield makeEditor("a", true, false);
      yield makeEditor("b", false, false);
    };
    const result = cancelOpenDrafts(gen(), false, beforeCancel);
    expect(result).toEqual({ kind: "cancelled", cancelled: 1 });
  });
});
