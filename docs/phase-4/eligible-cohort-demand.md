# Eligible cohort demand

`GET /api/admin/cohort-demand?curriculumId=<uuid>&semester=FALL&year=2026` is an
ADMIN-only, read-only reference diagnostic. It counts eligible saved PLANNED intentions and
reference recommendations for the current STUDENT accounts assigned to that exact curriculum.
It returns aggregate counts only. Existing demand, capacity, recommendations and admin screens
retain their contracts.

## Meaning of demand

For each student, resolve current curriculum membership, reference placements, mandatory context
prerequisites and the numeric GPA path. Completed and in-progress courses are unavailable.
Every prerequisite must be completed, including rows marked recommended or corequisite.
Global prerequisite edges, course categories and offering metadata cannot establish eligibility.

Eligible saved intentions survive even when reference recommendations omit them because of the
credit or difficulty budget. A student who plans and is recommended the same course contributes
one unit of course demand, with a separate overlap count. The response distinguishes distinct
students from student/course selections and includes zero-demand member courses. Nonmember plans
and unavailable member plans have separate exclusion totals. Historical records are preserved.

Reference recommendations use the existing context recommender and Bayesian rating estimates.
The entire cohort shares a captured deployment policy:

- `COHORT_DEMAND_MAX_CREDITS`: canonical integer 1–30, default 18.
- `COHORT_DEMAND_MAX_DIFFICULTY`: decimal 1–5, default 3.5.

Blank, malformed or out-of-range settings fail startup. The policy is frozen, returned in the
response and applied after a backend restart. It affects this diagnostic only. No per-student
request overrides or global categories are used; unverified category grade-fit remains disabled.

## GPA and term limits

GPA uses member numeric attempts, the highest score per course, credit weighting, physical-training
exclusion and the decimal-exact greater-than-70 fork. Legacy letters are never converted. When a
fork context has no numeric GPA, defer its Y4S2 placements rather than count both branches. Courses
with another placement remain available. The response counts students with unresolved fork GPA.
Y4S2 placements in a nonfork context are unaffected.

Semester/year identifies the requested simulation scenario. Saved intentions are undated and
reference placements do not establish actual offerings, so the term is not a selection filter.
`termBasis: SCENARIO_ONLY`, `eligibilityValidated: false`,
`offeringValidationAvailable: false` and `allocationValidated: false` make those limits explicit.
Supply and utilization remain null. The diagnostic assigns no course, reserves no resource and
claims no feasible timetable, official eligibility, degree completion or enrollment.

## Consistency and privacy

The production wrapper uses one RepeatableRead transaction for the actor's current role,
curriculum and ratings, exact cohort, records and immutable grade attempts. History reads are
batched, without one database query per student. Empty contexts stay empty; no legacy catalog
fallback is allowed. A second role check after middleware prevents a committed demotion from
authorizing the service read.

Stored context, records, attempts and output are runtime validated. Invalid stored metadata fails
with a plain server error. Strict response validation checks scope identity, duplicate courses,
safe nonnegative counts, distinct-student bounds, per-course unions and aggregate arithmetic.
Students appearing in both source groups may have disjoint courses; their distinct intersection
must not be confused with same-course overlap selections.

The endpoint exposes no user IDs, emails, student IDs, grades, record claims, request keys or
audit metadata. It performs no academic/resource writes, migration, assignment, reset or seed.

## Verification

41 pure/schema cases, 28 configuration cases and 22 real-PostgreSQL cases pass. They cover
unions and distinct counts, context isolation, all prerequisite flags, unavailable placements,
unknown/exact-boundary GPA, retakes, physical training, budgets, privacy, corruption and no writes.
The default production reader holds its original cohort/membership/progress/grade snapshot after
an independent real writer commits following its actor SELECT; a fresh read sees the changes.
A separate HTTP race demotes the actor after middleware and verifies the service rejects it.

Subagent source/test cross-review found no blocking issue; final integration review was inline
after the agent thread limit. Build, typecheck, zero-warning lint, 1244 server tests and 992 client
tests pass for the exact isolated source. Shared contracts were compiled in both existing local
containers; backend health and unauthenticated 401 checks pass. Containers/database volumes and
unrelated local drafts remain preserved.

## Next increment

Read eligible demand and the shared simulation resource envelope together in a single snapshot,
preserving their model/policy identity and missing-versus-zero semantics. Build an explicit
simulation allocation policy with shared resources, configurable objectives and scarcity order
before exposing allocations in the admin dashboard. Lab requirements, offerings, qualification,
calendar, verified curricula and cross-curriculum resource ownership remain separate gates.
