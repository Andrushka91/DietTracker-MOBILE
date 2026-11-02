// "Only the newest answer counts" for asynchronous screen loads.
//
// The Statistics page has several requests in flight at once (a period switch
// plus a background sync reload). Without ordering, a slow response for the
// previous period could land AFTER the current one and leave the heading of the
// new period above totals and rows belonging to the old one.
//
// The runner hands every load a token; a result is only applied while its token
// is still the newest one. Kept free of React so it can be tested directly.

export interface LatestRequestRunner {
  /**
   * Awaits `load` and applies the result only if no newer request started in the
   * meantime. A rejected load is passed through to the caller unchanged.
   */
  run: <T>(load: () => Promise<T>, apply: (value: T) => void) => Promise<void>;
  /** Drops any answer still in flight (used when a screen stops caring). */
  invalidate: () => void;
}

export function createLatestRequestRunner(): LatestRequestRunner {
  let newest = 0;
  return {
    async run<T>(load: () => Promise<T>, apply: (value: T) => void): Promise<void> {
      newest += 1;
      const token = newest;
      const value = await load();
      if (token === newest) {
        apply(value);
      }
    },
    invalidate(): void {
      newest += 1;
    },
  };
}
