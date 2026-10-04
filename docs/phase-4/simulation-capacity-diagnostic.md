# Simulation capacity diagnostic

`GET /api/admin/capacity` is an ADMIN-only read with the strict curriculum/semester/year query
used by resources and planned selections. It projects declared scenario capacity while preserving
`/api/admin/demand` and its unknown `supply` / `utilization` contract. No allocation or score is
changed.

## Explicit model

`model: EXPLICIT_COURSE_CAPACITY_ONLY` interprets a saved course override's `capacity` as an
absolute simulated seat limit. Zero is a known zero limit. Missing capacity is unknown, including
professor-only overrides. Classroom totals never supply an implicit course baseline and overrides
are never added to a classroom baseline. This diagnostic records one narrow interpretation of
existing optional individual limits; it does not settle the final resource allocation policy.

For positive declared capacity, `plannedSelectionsPerDeclaredSeat` equals that course's current
PLANNED count divided by its declared capacity. Zero capacity leaves the ratio null. For any known
capacity, `excessPlannedSelections` is `max(0, count - capacity)`; unknown capacity has null excess.
These compare saved intentions with declared seats, without claiming validated enrollment
utilization, prerequisite eligibility, term offerings or recommendation demand.

`classroomSeatProxy` appears once for the complete scenario: classrooms × students per section,
under `ONE_SIMULTANEOUS_CLASSROOM_SECTION_PER_ROOM`. It describes one simultaneous classroom wave,
not semester supply. It is not copied into every course, summed with overrides, or compared against
total undated selections. Lab rooms and professors remain raw inputs. Verified lab classification,
teaching load and allocation feasibility remain unavailable.

## Snapshot and history

The nested `plannedSelections` preserves the existing count basis, strict scenario scope,
resource revision, distinct students and aggregate exclusions. Diagnostic rows align one-to-one
with its unique current members, including unplaced and zero-count courses. Historical overrides
for removed members are ignored and counted separately; no member is inferred from an override.
Absent settings yield null resources, proxy and all declared capacities.

Current database ADMIN authorization, curriculum membership, cohort intentions and the complete
resource row share one RepeatableRead transaction. Stored resource JSON and the final projection
must pass strict schemas. Invalid persisted metadata produces a server failure, never partial
capacity or a client validation error. The adapter verifies the exact nested scenario scope and
successful response with strictly validated data; it issues no POST or automatic retry.

## Remaining allocation gate

This diagnostic does not complete phase 4. A shared section/time model, staff load policy, course
lab/teaching metadata, eligible cohort alternatives and recommendation demand are still needed
before multi-objective scoring and scarcity allocation can claim feasible redistribution. No
account assignment, student editing activation, seed/reset, migration or allocation write is made.

## Verification

39 pure projection/schema tests, 23 real-PostgreSQL cases and 29 client adapter cases cover
unknown/zero/positive capacity, proxy arithmetic, scope/roles, invalid stored current and historical
JSON, member changes, privacy and unchanged academic/resource data. A pass-through demand-query
spy schedules a real independent writer between production reader queries: the default reader
retains the old coherent revision/capacity; a fresh call observes the committed revision. The
reader transaction and every fixture query remain real PostgreSQL. Disposable fixtures are removed.

Independent source review found no blockers after the production-wrapper race was added. The
exact isolated snapshot passes build, types, zero-warning lint, 1035 server and 983 client tests.
An initial unrelated curriculum-import response was 403 instead of 409; its 64-case targeted suite
and full recheck passed without changes. The finding remains recorded in AGENTS.md. Existing
Docker shared exports were updated without recreation, and backend health plus protected-route
authentication checks passed.
