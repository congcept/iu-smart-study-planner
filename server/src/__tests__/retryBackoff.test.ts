import { pauseBeforeRetry, retryDelayMs } from '../services/retryBackoff';

describe('serializable retry backoff', () => {
  it('never waits before the first retry can be spread', () => {
    expect(retryDelayMs(0, () => 0)).toBe(0);
    expect(retryDelayMs(0, () => 0.999)).toBeLessThan(5);
  });

  it('widens the window with each attempt so concurrent retries decorrelate', () => {
    const ceilings = [0, 1, 2, 3, 4, 5].map((attempt) => retryDelayMs(attempt, () => 0.999999));
    expect(ceilings).toEqual([4, 9, 19, 39, 79, 159]);
    ceilings.slice(1).forEach((value, index) => expect(value).toBeGreaterThan(ceilings[index]));
  });

  it('bounds the wait so a caller keeps its own timeout budget', () => {
    expect(retryDelayMs(20, () => 0.999999)).toBeLessThanOrEqual(200);
    expect(retryDelayMs(-1, () => 0.999999)).toBeLessThanOrEqual(5);
  });

  it('produces different delays for different draws, which is the point', () => {
    expect(retryDelayMs(3, () => 0.1)).not.toBe(retryDelayMs(3, () => 0.9));
  });

  it('waits before retrying and resolves afterwards', async () => {
    const started = Date.now();
    await pauseBeforeRetry(2, () => 0.999999);
    expect(Date.now() - started).toBeGreaterThanOrEqual(10);
  });
});
