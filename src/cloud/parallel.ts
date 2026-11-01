// Bounded, ordered prefetching - the backbone of the fast pull phase.
//
// The JavaScript thread of a React Native app is single threaded, so there is
// no CPU parallelism to win here (and none is needed: downloading a document is
// 99 % waiting). What sync clients actually do - Drive for desktop, Dropbox,
// rclone, Syncthing - is overlap *I/O*: while one document is being applied,
// the next handful of downloads are already in flight in the native HTTP stack
// (and on iOS/Android the network client runs those on its own threads).
//
// That is exactly what this module provides: a sliding window of `concurrency`
// requests whose results are handed back IN THE ORIGINAL ORDER, so a caller can
// keep applying documents one by one (SQLite, foreign keys and the watermark
// demand that order) while the network never idles between two documents.
//
// Why the window is bounded: an unbounded `Promise.all` over a 300-photograph
// account would open 300 sockets, blow the provider's per-user quota and hold
// every response in memory at once - which is how a "fast" sync becomes an
// out-of-memory crash on a mid-range phone.

/** What the consumer of a prefetch window sees. */
export interface OrderedPrefetcher<T> {
  /**
   * Resolves the next item in the original order, waiting only for THAT item.
   * Must not be called more than `items.length` times.
   */
  next(): Promise<T>;
  /** Stops starting new work (an interrupted pass); in-flight work settles. */
  cancel(): void;
}

/**
 * Sliding-window prefetch over `items`.
 *
 * `run` is started for up to `concurrency` items ahead of the consumer. A
 * failure is delivered to the consumer at its position in the order (never to
 * another document's slot), and it never becomes an unhandled rejection while
 * earlier documents are still being applied.
 */
export function prefetchInOrder<TItem, TResult>(
  items: readonly TItem[],
  run: (item: TItem, index: number) => Promise<TResult>,
  concurrency: number,
): OrderedPrefetcher<TResult> {
  const limit = Math.max(1, Math.min(Math.floor(concurrency) || 1, items.length));
  /** index -> in-flight result (never more than `limit` entries). */
  const pending = new Map<number, Promise<TResult>>();
  let started = 0;
  let consumed = 0;
  let cancelled = false;

  const start = (index: number): void => {
    const promise = Promise.resolve().then(() => run(items[index], index));
    // The consumer may never await this one (cancel, or an earlier failure):
    // an observed rejection here must not surface as an unhandled one.
    promise.catch(() => undefined);
    pending.set(index, promise);
    started += 1;
  };

  /** Keeps the window full: `limit` items between the consumer and the newest start. */
  const fill = (): void => {
    while (!cancelled && started < items.length && started - consumed < limit) {
      start(started);
    }
  };

  fill();

  return {
    async next(): Promise<TResult> {
      if (consumed >= items.length) {
        throw new Error('prefetchInOrder: the window is exhausted');
      }
      const index = consumed;
      fill();
      const promise = pending.get(index);
      if (promise === undefined) {
        throw new Error(`prefetchInOrder: item ${index} was never started`);
      }
      try {
        return await promise;
      } finally {
        pending.delete(index);
        consumed += 1;
        if (!cancelled) {
          fill();
        }
      }
    },
    cancel(): void {
      cancelled = true;
      pending.clear();
    },
  };
}

/**
 * Window size of a pull phase.
 *
 * Eight is the value the mainstream sync clients settle on for "transfers"
 * (rclone's default is 4, Drive for desktop opens 6-8 per account) and it stays
 * far below the provider's per-user quota (12 000 queries / 100 s). A short
 * queue uses a window no larger than itself, so a two-document refresh does not
 * reserve anything.
 */
export const PULL_CONCURRENCY = 8;

/** Window size of a pull phase for a queue of `total` documents. */
export function pullConcurrency(total: number): number {
  if (total <= 0) {
    return 1;
  }
  return Math.max(1, Math.min(PULL_CONCURRENCY, total));
}

/**
 * Documents one push pass may send at the same time. Uploads are heavier per
 * request (a photograph can be a multi-megabyte multipart body), so the window
 * is smaller than the download window while still overlapping the round trips.
 */
export const UPLOAD_CONCURRENCY = 6;

/** Upload window for an outbox of `total` documents. */
export function uploadConcurrency(total: number): number {
  if (total <= 0) {
    return 1;
  }
  return Math.max(1, Math.min(UPLOAD_CONCURRENCY, total));
}
