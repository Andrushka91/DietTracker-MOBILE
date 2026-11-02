// Regression tests for the "only the newest answer counts" runner used by the
// Statistics page.
//
// The defect it pins: switching period briefly combined the new heading with the
// previous period's totals and rows, and a slow answer for the old period could
// land after the new one and win.

import { createLatestRequestRunner } from '../src/ui/latestRequest';

describe('createLatestRequestRunner', () => {
  test('a slow earlier request never overwrites the newer answer', async () => {
    const runner = createLatestRequestRunner();
    const applied: string[] = [];
    let releaseFirst: (value: string) => void = () => undefined;
    const first = new Promise<string>((resolve) => {
      releaseFirst = resolve;
    });

    const slow = runner.run(
      () => first,
      (value) => applied.push(value),
    );
    // The newer request (a period switch) finishes first.
    await runner.run(
      async () => 'new period',
      (value) => applied.push(value),
    );
    // …then the older one arrives, out of order.
    releaseFirst('old period');
    await slow;

    expect(applied).toEqual(['new period']);
  });

  test('a rejected load leaves the screen untouched and reports the failure', async () => {
    const runner = createLatestRequestRunner();
    const applied: string[] = [];
    await expect(
      runner.run(
        async () => {
          throw new Error('disk');
        },
        (value: string) => applied.push(value),
      ),
    ).rejects.toThrow('disk');
    expect(applied).toEqual([]);
  });

  test('invalidate drops an answer that is still in flight', async () => {
    const runner = createLatestRequestRunner();
    const applied: string[] = [];
    const pending = runner.run(
      async () => 'late',
      (value) => applied.push(value),
    );
    runner.invalidate();
    await pending;
    expect(applied).toEqual([]);
  });
});
