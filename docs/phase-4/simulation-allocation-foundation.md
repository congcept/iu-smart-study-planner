# Pure simulation allocation foundation

`allocateSimulationRound(envelope, roster, policy)` is a pure internal service for one course per
student per simulation round. It accepts a validated shared resource envelope and a supplied
eligible-choice matrix with normalized student utility from 0 to 1. This increment adds no HTTP
endpoint, background job, database write or recommendation change.

## Shared consumption and scarcity

Opening a section consumes one shared classroom/staff section opportunity from the versioned
resource envelope. That section has `maxStudentsPerSection` seats and belongs to one course.
Reuse the chosen course's spare seats before opening its next section. Course choice may open
another course when a shared opportunity remains. The whole shared ceiling is never copied into
every course. Labs and historical course overrides remain unapplied.

After every assignment, recompute each pending student's capacity-feasible choices. A choice is
feasible if its course has spare opened seats or an unused shared opportunity can open another
section. Process students with the fewest feasible choices first, with normalized lexical UUID
ties. This count precedes congestion deferral, so a ranking preference cannot distort scarcity.
Input order, click order and timestamps have no role.

## Explicit scoring policy

Configuration stores frozen deployment settings:

- `ALLOCATION_STUDENT_UTILITY_WEIGHT`, default 0.60.
- `ALLOCATION_RESOURCE_FIT_WEIGHT`, default 0.25.
- `ALLOCATION_FAIRNESS_WEIGHT`, default 0.15.
- `ALLOCATION_CONGESTION_THRESHOLD`, default 0.85.

All values are canonical decimal numbers in 0–1; weights sum to one within floating-point
tolerance 10⁻¹⁰. Invalid settings fail startup. Restart to apply settings. The service requires an
explicit policy, copies it and records it in the result; scoring code contains no default weights.

```
utilization = original distinct course demand / course seats at this assignment
resourceFit = 1 - min(1, max(0, utilization - congestionThreshold))
fairness = 1 / current capacity-feasible choice count
score = utilityWeight × studentUtility + resourceWeight × resourceFit + fairnessWeight × fairness
```

Course seats include the next section only when current seats are full and that section can be
opened. Defer utilization ≥1 choices when the student has a feasible alternative below 1; retain
choices if every feasible alternative is saturated. Rank remaining choices by score then lexical
course UUID. A clamp handles accepted floating-point sum tolerance at score 1.

The fairness component is constant across one student's course candidates. Scarcity ordering
provides priority between students; the fairness weight does not independently redistribute that
student's course choices. Supplied utility is explicit: categories, GPA, grades, graduation timing
and official eligibility are not inferred from unverified curriculum metadata.

## Results and limits

Every roster student appears once in assignments or unassigned outcomes. Empty choices return
`NO_CHOICES` before resource checks. Missing settings return `RESOURCE_UNKNOWN`; configured zero
or exhausted opportunities return `CAPACITY_EXHAUSTED`. Missing envelope ceilings remain null;
opened course sections/seats report what this simulation actually opened, including zero.

Strict schemas normalize UUIDs and reject duplicate students/choices, malformed scores, extra
fields and invalid policies. Results validate exact roster partition, score decomposition,
per-course demand/utilization at each assignment, packed sections/seats and shared ceilings.
Input bounds are 10,000 students, 1,000 choices/student and 100,000 choices overall. The current
greedy implementation recomputes pending feasibility and is intended for bounded simulations.

Results carry internal student IDs and must not be exposed through aggregate public diagnostics.
The result is `INTERNAL_REFERENCE_ONLY`, `ONE_COURSE_PER_STUDENT_ROUND_V1`, with eligibility,
allocation, timetable validation and persistence explicitly false. Greedy processing does not
guarantee maximum assignments, full seat use or an optimal solution. A complete semester,
registration-window job, validated offerings/resources and persisted allocation remain pending.

## Verification

33 pure/schema and 25 configuration cases pass. They check scarce-student priority, exact packing
and additional sections, reusable seats with no remaining sections, saturated alternatives,
hand-computed scores/thresholds, configurable course ranking, shuffled/uppercase UUID invariance,
unknown versus zero resources, unchanged inputs, malformed/duplicate inputs and result accounting.
Accepted floating-point weight tolerance cannot produce an out-of-range score.

Design subagent review found no blocker; final source/test review was inline after the agent thread
limit. The exact isolated source passes build, typecheck, zero-warning lint, all 1336 server tests
(including existing real PostgreSQL regressions) and 992 client tests. Shared exports were compiled
in the existing local containers and backend health passes. The running app/database and unrelated
staged/interface drafts remain preserved.

## Next increment

Build a database-snapshot adapter from the exact assigned cohort's eligible planned/recommended
union, with mandatory prerequisites and numeric GPA paths shared with existing demand reads.
Derive only supported utility components and return aggregate admin preview diagnostics. Verify
that adapter and oversubscription before adding job persistence or the allocation dashboard.
