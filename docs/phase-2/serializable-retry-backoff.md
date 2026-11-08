# Jittered backoff for serializable retries

Three continuous-integration failures in three different services, all with the same signature: a
test asserting that concurrent writers all succeed, returning `409` instead of `200`.

| Run     | Service                     | Test                                     |
| ------- | --------------------------- | ---------------------------------------- |
| PR #171 | `courseRatings`             | four concurrent votes across two courses |
| PR #171 | `adminAllocationJobs`       | concurrent same-key enqueues             |
| PR #175 | `semesterAllocationStorage` | concurrent identical saves               |

Each of those services bounded its serializable retry loop at four or five attempts. None of them
waited between attempts.

## The mechanism

A serializable transaction that loses a conflict is retried immediately. When four writers collide at
the same instant, all four retry at the same instant, and collide again. The loop is not converging on
a resolution, it is repeating one collision until the bound runs out. A loaded CI runner widens every
window, which is why the failure appeared on the runner and not on a developer machine.

That answers the question recorded two failures ago — _why does every attempt collide_ rather than
_how many attempts should be allowed_. The bound was never the problem.

## The change

`server/src/services/retryBackoff.ts` adds `retryDelayMs` and `pauseBeforeRetry`: a randomised wait
whose ceiling grows `5, 10, 20, 40, 80, 160` and is capped at 200 ms. Applying it at each retry site
means concurrent retries land at different moments and the first one to commit wins a clean race
instead of a stampede.

Ten retry sites across nine services were converted. **Every attempt bound, error classification and
final error is unchanged** — only the timing between attempts differs. Where a service retried on
`attempt < 4`, it still does; where it threw a domain error after the loop, it still throws the same
error with the same status and message.

The wait is bounded so it can never consume a caller's own transaction timeout: the largest possible
total added delay is under a second across a full retry sequence.

## Why not simply raise the bound

Raising four to eight would have made the symptom rarer without touching the cause, and the next
concurrency-sensitive test with six writers would fail the same way. A larger bound also spends more
database time per request on the happy path's error case. Decorrelating is the standard treatment for
serialization failures and is what was actually missing.

## Verification

Five cases pin the helper: a first retry can be near-zero, the window widens with each attempt,
the ceiling is bounded, distinct draws produce distinct delays — the property that matters — and
`pauseBeforeRetry` actually waits.

120 server suites / 3,081 tests pass, with build, typecheck and zero-warning lint. One run of
`adminAllocationRuns` failed once during the change and passed three times immediately afterwards
along with the complete suite; it is recorded rather than explained away, because a failure during a
concurrency change deserves that suspicion. The current suite has not repeated it.
