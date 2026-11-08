/**
 * Backoff for retries inside a serializable transaction loop.
 *
 * Concurrent writers that collide on a serialization failure all retry at the same moment, so they
 * collide again. Repeating that a fixed number of times converts a recoverable conflict into a
 * refusal: the loop gives up while every participant is still racing. A short randomised delay
 * between attempts breaks the lockstep, which is why the remedy is decorrelation rather than a
 * larger attempt count.
 *
 * The ceiling grows with the attempt so the first retry is nearly immediate and later ones spread
 * out, and it is bounded so a caller's own timeout is never consumed by waiting.
 */
export function retryDelayMs(attempt: number, random: () => number = Math.random): number {
  const ceiling = Math.min(200, 5 * 2 ** Math.max(0, attempt));
  return Math.floor(random() * ceiling);
}

/** Awaits the jittered delay for one attempt. Callers keep their own attempt bound and error policy. */
export async function pauseBeforeRetry(
  attempt: number,
  random: () => number = Math.random,
): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, retryDelayMs(attempt, random)));
}
