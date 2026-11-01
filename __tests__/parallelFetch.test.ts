// Unit tests of the pull phase's prefetch window (src/cloud/parallel.ts).
//
// The pull used to be strictly sequential: download a document, apply it,
// download the next one. Every document therefore cost a full round trip that
// the network spent waiting, and a first sign-in with a few hundred records
// took minutes even on a fast connection.
//
// The window below is what makes the same work overlap: the next N downloads
// are in flight while the caller applies the previous one, and the results are
// still handed back in the original order (SQLite foreign keys - a photograph
// only after its meal - and the retry watermark both depend on it).

import {
  PULL_CONCURRENCY,
  prefetchInOrder,
  pullConcurrency,
  uploadConcurrency,
  UPLOAD_CONCURRENCY,
} from '../src/cloud/parallel';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('the prefetch window overlaps the downloads', () => {
  test('it keeps several requests in flight, never more than the window', async () => {
    const items = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    let inFlight = 0;
    let peak = 0;

    const window = prefetchInOrder(
      items,
      async (item) => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await sleep(10);
        inFlight -= 1;
        return item * 2;
      },
      4,
    );

    const received: number[] = [];
    for (let index = 0; index < items.length; index += 1) {
      received.push(await window.next());
    }

    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThanOrEqual(4);
    expect(received).toEqual(items.map((item) => item * 2));
  });

  test('results arrive in the queue order even when a later one is faster', async () => {
    const delays = [40, 5, 1, 1];
    const window = prefetchInOrder(
      delays,
      async (delay) => {
        await sleep(delay);
        return delay;
      },
      4,
    );

    const received: number[] = [];
    for (let index = 0; index < delays.length; index += 1) {
      received.push(await window.next());
    }

    // The slowest document is first: the consumer waits for it once, and the
    // three others are already done instead of costing three more round trips.
    expect(received).toEqual(delays);
  });

  test('a failed document fails at its own position', async () => {
    const items = ['a', 'b', 'c'];
    const window = prefetchInOrder(
      items,
      async (item) => {
        await sleep(2);
        if (item === 'b') {
          throw new Error('drive.network.timeout');
        }
        return item;
      },
      3,
    );

    await expect(window.next()).resolves.toBe('a');
    await expect(window.next()).rejects.toThrow('drive.network.timeout');
    await expect(window.next()).resolves.toBe('c');
  });

  test('cancelling stops new work and never leaves an unhandled rejection', async () => {
    const started: number[] = [];
    const window = prefetchInOrder(
      [1, 2, 3, 4, 5, 6],
      async (item) => {
        started.push(item);
        await sleep(5);
        if (item > 3) {
          throw new Error('session ended');
        }
        return item;
      },
      3,
    );

    await expect(window.next()).resolves.toBe(1);
    window.cancel();
    // Nothing starts after the cancel: the window is dropped instead of being
    // filled again, and the requests already in flight settle unobserved.
    const before = started.length;
    await sleep(30);
    expect(started.length).toBe(before);
  });
});

describe('the window sizes stay inside what a phone and a provider accept', () => {
  test('a short queue never reserves a window larger than itself', () => {
    expect(pullConcurrency(0)).toBe(1);
    expect(pullConcurrency(1)).toBe(1);
    expect(pullConcurrency(3)).toBe(3);
    expect(pullConcurrency(500)).toBe(PULL_CONCURRENCY);
    expect(uploadConcurrency(0)).toBe(1);
    expect(uploadConcurrency(2)).toBe(2);
    expect(uploadConcurrency(500)).toBe(UPLOAD_CONCURRENCY);
  });

  test('both windows stay small enough for a per-user provider quota', () => {
    expect(PULL_CONCURRENCY).toBeGreaterThanOrEqual(4);
    expect(PULL_CONCURRENCY).toBeLessThanOrEqual(10);
    expect(UPLOAD_CONCURRENCY).toBeGreaterThanOrEqual(3);
    expect(UPLOAD_CONCURRENCY).toBeLessThanOrEqual(8);
  });
});
