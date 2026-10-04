# Coherent cohort and resource reference snapshot

`GET /api/admin/cohort-resource-snapshot?curriculumId=<uuid>&semester=FALL&year=2026`
returns the existing eligible cohort demand and shared simulation resource envelope together.
It requires a currently authenticated ADMIN. The response is a strict reference simulation with
`consistencyBasis: SINGLE_DATABASE_SNAPSHOT`, `demand` and `resourceEnvelope`.

## Consistency and policy

The production service opens one RepeatableRead transaction. The demand reader's actor check,
curriculum/rating projections, assigned STUDENT cohort, records and numeric retakes share that
transaction with the resource reader's actor check, curriculum metadata and saved resource row.
The service passes the transaction through both readers instead of opening independent snapshots.
Standalone resource/demand reads retain their existing transactions and behavior.

Both deployment policies are runtime validated, copied and frozen before any await, then passed
to the demand calculation and resource envelope projection. Replies retain the complete applied
recommendation policy, versioned resource policy and resource revision. A later config change
cannot mix policies within an in-flight read. HTTP queries cannot override either policy.

The composed shared schema validates both complete nested contracts and requires identical
curriculum ID, semester/year and curriculum code/name/school. Identity checks cannot prove database
consistency by themselves; the production wrapper establishes it. Invalid stored metadata or
inconsistent projections fail with a plain server error.

## Preserved limits

The eligible demand contract retains mandatory context prerequisites, highest-retake member numeric
GPA, physical-training exclusion from GPA and unknown-fork placement deferral. Demand counts
eligible saved intentions union reference recommendations once per student/course. It exposes no
student identity or individual history. Semester/year remains a scenario label rather than a
verified offering filter.

Missing resources still return null revision/inventory/envelope while demand remains readable.
Configured zero resources return known zero ceilings. The shared classroom/staff envelope remains
one ceiling shared across courses, never copied into each course. There is no comparison between
student/course selections and the shared seat ceiling: those quantities do not establish a
feasible allocation. Course supply/utilization stay null and all eligibility/offering/allocation
validation declarations remain false.

Lab sections, course overrides, teaching qualifications/availability, calendar and cross-curriculum
resource ownership remain unverified. Existing APIs and the admin screen retain their contracts.
The new endpoint performs no academic/resource writes, assignment, migration, reset or seed.

## Verification

15 contract/projection and 19 real-PostgreSQL cases pass. The default production wrapper is
exercised while an independent writer commits resource, cohort, context, course-membership,
progress and numeric grade changes after the actual actor SELECT. The original reply retains
both old diagnostics; a fresh read observes the committed state. Separate tests change both
deployment policies after the SELECT and confirm the calculated outcomes retain the captured
values, then verify fresh reads adopt the changed policies.

Current-role demotion after middleware rejects 403. Tests also cover strict query/output scopes,
nested arithmetic, private-field rejection, unchanged database evidence, corrupt metadata,
empty contexts and missing-versus-zero resources. Independent source/test review found no
blockers; requested arithmetic and policy outcome assertions were added.

Build, typecheck, zero-warning lint, all 1278 server tests and 992 client tests pass for the exact
isolated source. Shared exports were compiled in both existing local containers, backend health
and live route authentication checks pass, and the running app/database and unrelated drafts
remain preserved.

## Next increment

Define a pure, configurable simulation allocation/scoring contract using explicit shared resource
consumption and scarcity ordering. Keep reference curriculum and resource limitations visible and
test oversubscription/alternatives before persisting allocations or adding the admin preview.
