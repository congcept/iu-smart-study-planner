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

## Course projections

Course lists, details and curriculum rows now include the Bayesian ratingDifficulty,
ratingCount, observed average and shared prior/source. Each collection resolves the
prior once inside a repeatable-read transaction, so concurrent votes cannot combine
an older count with a newer mean. Duplicate elective placements share one global
course estimate. Missing database rows do not receive fabricated rating metadata.

Ten real PostgreSQL tests verify API consistency, cold starts, metadata preservation,
one aggregate query for fifty courses, duplicate placements and concurrent snapshot
isolation. Full build, type, lint and test gates pass301 server/143 client tests.
The seed difficultyLevel remains intact; badges and scoring consumers are next.

## Curriculum badges

Course cards show the server estimate to one decimal and the real vote count. Zero
votes say No ratings yet; accessible copy explains the shared mean and that higher
scores mean greater difficulty. Rows without valid projection metadata render no badge.
Completion, prerequisite hover and sidebar scale behavior are unchanged. Desktop/mobile
browser inspection passed; ten client cases cover counts, cold starts and missing/invalid
metadata. Full gates pass301 server/153 client tests. Rating entry is next.

## Private saved votes

GET /api/users/me/ratings returns only the cookie account’s courseId/rating pairs,
including historical votes after uncompletion. Query parameters cannot select another
account, and an admin reads only their own votes. Public aggregates still contain no
identities. Six real PostgreSQL tests cover authentication and isolation. Full gates
pass 307 server/153 client tests. This supports displaying saved votes in the upcoming form.

## Student rating entry

Protected /ratings and the signed-in Ratings navigation use the cookie account’s
completed courses and saved votes. Native selectors explain1–5; each explicit save
replaces that account’s one vote, refreshes the course estimates and returns keyboard
focus to Course. Empty, loading and reload states are explicit. The server rechecks
completion even if the displayed catalog is stale.

A sessionStorage journal is written before POST. Failed/uncertain responses retain
the course/value and lock editing until the same vote is acknowledged on retry.
Reloading never writes or discards the pending vote. Corrupt/unavailable storage blocks
writes; account changes ignore late responses.429 displays the server retry interval.
This tab-local recovery is not a cross-device draft; closing the tab loses its journal.
Concurrent deliberate edits from multiple tabs retain the API’s last-committed-vote
semantics; immutable request history is specific to grades, not ratings.

Twenty-five new client cases cover adapter validation, routing, completion filtering,
empty/error states, saves, duplicate clicks, locked retries, storage, quota and account
isolation. Full gates pass 307 server/178 client tests. A real simulated vote changed
4→3, retained count1 and refreshed the estimate; desktop/mobile checks passed at390px
without page overflow. UI review/documentation used a disclosed inline fallback after
subagent account usage limits. Curriculum means and scoring integration remain pending.

## Workload and personalized course selection

Workload averages, risk scores, difficulty warnings, ranking penalties and selection
limits now consume ratingDifficulty. Personal recommendation reads project the catalog
and account records in one repeatable-read snapshot, retaining counts in returned
courses. Recommendation limits are validated; malformed/nonfinite/out-of-range values
return400. Difficulty-related legacy performance matching uses a half-point band for
continuous estimates and excludes missing grades. Numeric highest-score grade fit is
still pending; no0–100 to4-point conversion was invented.

Thirteen cases verify real API projections and cold starts, hand-computed workload
values, inverted seed/estimate rankings, difficulty constraints, warnings, nearby
estimates and invalid limits. Full gates pass 320 server/178 client tests. Semester
planning, client scoring, saved-plan cached difficulty and curriculum priors follow.

## Database-authoritative semester prerequisites

The duplicated RULES array and code-based prerequisite/bonus/corequisite insertion
logic are removed. Every database prerequisite is mandatory regardless of legacy flags.
Candidate availability is calculated before filling a semester, so a planned parent
only unlocks its dependents in a later slot. No code name invents a missing relationship.

Eleven real PostgreSQL cases cover all flags, transitive chains, multiple parents, live
relationship changes, absent dependencies, cycles, self-dependency and completed-course
exclusion. Full gates pass 331 server/178 client tests. The existing planning horizon
and graduation heuristic remain; incomplete schedules need explicit reporting, and
semester rating scoring follows separately.


## Semester rating ranking

Semester candidates now use the same snapshot-consistent Bayesian projection as the
course and workload APIs. Lower estimated difficulty breaks otherwise equal placement,
category and unlock scores. The server-configured penalty defaults to 10, accepts 0–50,
and can be disabled with 0. Every prerequisite still requires an earlier semester.

Shared planning DTOs describe the actual slot `recommendedCourseIds` payload, replacing
the unused client declaration that incorrectly promised course objects in each slot.
Five real PostgreSQL cases cover inverted seed/estimate ranking, zero-vote estimates,
mandatory prerequisites, disabling the weight and API metadata. Build, types, lint and
all 336 server/178 client tests pass. Graduation estimates remain heuristic; incomplete
schedule reporting is the next increment. Curriculum-specific priors remain pending.


## Incomplete semester schedules

Planning statistics now distinguish the number of suggested semesters from completion:
`planningComplete`, `unplannedCourseIds` and `plannedSemesterCount` expose gaps.
`semestersToCompletion` and the graduation estimate are null if any provided course
remains unscheduled. An empty/already-completed catalog has zero semesters remaining
and no invented graduation date. Feasible suggestions are retained when other courses
are blocked. Complete schedules retain the existing approximate calendar estimate.

Nine real PostgreSQL cases cover empty/completed catalogs, complete chains, cycles,
missing prerequisites, oversized courses, partial plans, horizon limits and API output.
Build, types, lint and all 345 server/178 client tests pass. Completion here means all
provided catalog courses were scheduled; curriculum elective/degree requirements and
a verified academic calendar are still pending.


## Saved semester difficulty

Creating or replacing a saved semester's course list now averages the same Bayesian
course projections used by workload analysis, resolved in one repeatable-read snapshot.
Credits, course order and submitted positions stay authoritative. Empty lists keep zero
totals, and invalid lists still fail before any semester is saved. Metadata-only edits
preserve the prior cached estimate; later rating changes are reflected on a course-list
save, not by silently rewriting existing plans.

Seven additional real PostgreSQL cases check the hand-computed mean, workload agreement
(accounting for display rounding), zero votes, rating changes, metadata-only edits,
authorized reads and failed-save preservation. Existing semester validation expectations
now use the shared zero-vote prior. Build, types, lint and all 352 server/178 client tests
pass. Curriculum priors, client recommendations and multi-objective scoring remain pending.


## Curriculum recommendation highlights

The map now calls a pure tested selector: earliest curriculum placement first, then
lower Bayesian difficulty within the same semester, then stable course code/ID order.
Zero-vote shared estimates participate normally. Missing/invalid legacy projections
stay unknown and follow known estimates in the same slot; individual seeds are never
substituted. Mandatory prerequisites must already be completed. Both GPA paths filter
before credits, and duplicate elective placements consume a global course's credits once.

Seventeen new client cases plus existing map regressions cover estimate ranking,
placement, unknown/invalid metadata, prerequisites, duplicates, credit fitting and GPA
paths. Build, types, lint and all 352 server/195 client tests pass. The running signed-in
map was checked at desktop and 390px: Low mode selected nine credits; mobile had no
page overflow. Layout and controls were preserved. Finish/documentation review used an
explicit inline fallback because subagents could not start under the account usage limit.
Curriculum-specific priors and multi-objective scoring remain pending.
