/** NEW UI behavior only. Reuse each card's existing cancelEdit callback.
 * No dates, validation, persistence, template or sync logic belongs here.
 */
export interface RegisteredEditor {
  id: string;
  /** Read mutable refs at invocation; never captured render-state snapshots. */
  isEditing: () => boolean;
  isSaving: () => boolean;
  /** Synchronous, clears editingRef before invoking existing cancelEdit(). */
  cancel: () => void;
}

export type CancelResult =
  | { kind: "blocked"; cancelled: 0 }
  | { kind: "empty"; cancelled: 0 }
  | { kind: "cancelled"; cancelled: number };

export function cancelOpenDrafts(
  registry: Iterable<RegisteredEditor>,
  batchBusy: boolean,
  /** Dashboard clears forceEditing request + stale partial notice BEFORE cancel callbacks. */
  beforeCancel: () => void
): CancelResult {
  const registered = [...registry];
  // A closed editor can still be finishing a write: check ALL registered cards.
  if (batchBusy || registered.some((editor) => editor.isSaving())) {
    return { kind: "blocked", cancelled: 0 };
  }
  const targets = registered.filter((editor) => editor.isEditing());
  if (targets.length === 0) {
    return { kind: "empty", cancelled: 0 };
  }
  // One synchronous JS event: don't introduce an async gap that permits a save to interleave.
  beforeCancel();
  targets.forEach((editor) => editor.cancel());
  return { kind: "cancelled", cancelled: targets.length };
}
