# Difficulty ratings

## Bayesian calculation

The pure estimateDifficulty helper implements (v*n + m*5)/(n+5), returning the
unrounded score and ratingCount. With zero ratings it uses the supplied shared mean
exactly, even if a raw course average was supplied. Positive counts require a valid
1–5 observed average; the prior must also be1–5. Invalid counts and nonfinite means
are rejected. Hand-computed0/1/50-vote vectors and boundary/precision checks pass
in24 tests.

This helper is not yet wired to public APIs or scoring. Completion-gated authenticated writes, an hourly cap, curriculum/global mean resolution,
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
preservation and FK cleanup. Full gates passed253 server and143 client tests. Public
rating writes, completion guards, hourly limits and UI/scoring integration remain pending.
Historical votes remain after uncompletion; deletion of the account/course removes them.
