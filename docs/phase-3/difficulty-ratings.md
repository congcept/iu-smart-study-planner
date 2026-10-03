# Difficulty ratings

## Bayesian calculation

The pure estimateDifficulty helper implements (v*n + m*5)/(n+5), returning the
unrounded score and ratingCount. With zero ratings it uses the supplied shared mean
exactly, even if a raw course average was supplied. Positive counts require a valid
1–5 observed average; the prior must also be1–5. Invalid counts and nonfinite means
are rejected. Hand-computed0/1/50-vote vectors and boundary/precision checks pass
in24 tests.

This helper is consumed by the rating summary API. Curriculum-specific prior resolution,
UI confidence badges and engine integration remain outstanding. Course.difficultyLevel
is preserved. No ratings or difficulty changes have been fabricated in the live app.

## Rating storage

CourseRating is global and unique by account/course. Integer1–5 values are checked in
PostgreSQL; API validation will reject fractional payloads before Prisma (which can
truncate numbers assigned to Int fields). The existing difficultyLevel stays intact.
Courses now carry nullable avgRating and ratingCount0 for no votes.

A database trigger recomputes the cache within the vote transaction, including updates,
deletes and account deletion cascades. It locks the affected course with NO KEY UPDATE
before reading aggregates, avoiding a lock upgrade against FK KEY SHARE locks. A first
real race test exposed that upgrade; the corrective migration preserves the already
applied local migration history. Apply both migrations with prisma migrate deploy and
regenerate Prisma. No reset or seed rewrite is required.

Twenty real PostgreSQL tests verify boundaries, uniqueness, retakes of a vote, full
precision, cache rollback, concurrent votes/updates, course moves, legacy record
preservation and FK cleanup. Full gates passed253 server and143 client tests. UI/scoring integration remains pending; the API work is described below.
Historical votes remain after uncompletion; deletion of the account/course removes them.

## Completion-gated APIs

GET /api/courses/:id/ratings is public and returns raw average, count, distribution1–5,
unrounded Bayesian difficulty, priorMean and priorSource. It reads one repeatable-read
snapshot and never reveals voter identities. Current data remains the global CS catalog:
use the global vote mean, or the mean of retained seed difficulties if there are no votes.
Curriculum-specific means require the pending curriculum joins.

POST /api/courses/:id/rate accepts only an integer rating1–5. The cookie determines the
account; students and admins must have a current COMPLETED record. Planned, failed,
dropped, in-progress and absent records cannot rate. Completion/legacy grades stay intact.
UUIDs normalize to lowercase. Writes and returned summaries use a serializable transaction
with conflict retries.

Changed votes consume a persistent fixed UTC-hour account quota (default60, configured
by RATING_WRITES_PER_HOUR1–10000). User-row locking shares the cap across courses and
API instances. An identical vote returns the same value without consuming another write.
At the cap,429 includes Retry-After; no partial quota/vote/cache changes commit. The single
quota row resets next hour and is removed on account deletion.

Thirty-eight real PostgreSQL API tests cover session/origin/role access, all statuses,
strict and fractional inputs, cold-start/Bayesian summaries, preservation, idempotency,
quota reset/isolation and races. Full gates pass291 server/143 client tests. Live simulated
votes4 and5 produced a shared mean4.5; a zero-vote course displayed4.5 exactly and the
one-vote course displayed4.416666666666667. Numeric progress remained unchanged.
