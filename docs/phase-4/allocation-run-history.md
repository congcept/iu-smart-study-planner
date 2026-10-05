# Aggregate simulation run history

`POST /api/admin/allocation-runs` accepts only `curriculumId`, `semester`, `year`
and a UUID `requestId`. The current database ADMIN role is required. A new request
captures the server's coherent allocation preview and stores an immutable aggregate
summary; it returns 201. Repeat the same actor/request ID and scenario to recover
the original run with 200. Reusing the key for another scenario returns 409.
Different admins have independent retry keys. Callers cannot upload results, change
weights or supply students. Progress, grades, plans and resource settings are untouched.

`GET /api/admin/allocation-runs/:id` requires a current ADMIN and returns historical
data by run ID. It accepts no query overrides, returns 404 for an unknown ID and
fails closed with a plain 500 for corrupt or unsupported stored data. No current
curriculum labels, cohort, resources or configuration are used to rewrite history.
There is no list, update or delete endpoint in this increment.

## Capture and safe recovery

An initial short RepeatableRead transaction verifies ADMIN status and looks for
the actor/request key. A matching result is validated and returned before any live
preview/configuration read. Recovery still works if today's preview cannot run.

On a miss, the existing preview reader captures its database snapshot and deployment
policies. Allocation/projection work finishes before persistence begins. A short
Serializable transaction rechecks ADMIN status and the retry key, then creates the
run or returns the concurrent winner. Serialization/unique conflicts restart fresh
transactions with bounded retries and the same captured result. A role change during
capture cannot silently create a run. A changed live cohort or resource revision
does not rewrite a captured experiment while it waits to be stored.

`capturedAt` records capture completion; `createdAt` records storage. The source
snapshot was read before capture completion. Neither timestamp is an official
registration window. `snapshotStored: true` means an aggregate summary was saved;
`result.assignmentsPersisted: false` explicitly states that individual assignments
were not saved. The summary omits actor/student identities, request keys, individual
choices, grades and scores.

## Stable storage and immutability

The pinned `AllocationRunSummaryV1Schema` / `AllocationRunV1Schema` depend only on
Zod and their own fixed fields, not the evolving live preview schema. Format version
1 preserves scope and curriculum identity, cohort outcomes, course demand/assigned
seats, resource provenance/ceilings and captured scoring/recommendation weights.
Counts, distinct identities, seat arithmetic, outcome partitions, policy sums and
capture/storage chronology must agree. Stored scope columns must match the summary.
Future formats require separate validators; keep V1 available for old runs.

The additive table has an actor/request unique key and a scoped chronological index.
A database trigger rejects result or source-metadata updates. Creator deletion may
set its private foreign key to null while retaining the result. Curriculum deletion
is restricted while history exists. There is no migration data rewrite, reset or seed.

## Remaining work

Add client capture/recovery and history review, then a background-job lifecycle and
registration-window scheduling. This increment stores aggregate experiments only.
Per-student allocations, full-semester plans, official offerings/calendar validation,
verified category/grade-fit metadata and curriculum activation remain pending.

## Verification

Twenty-five pure contract/projection cases and thirty-three real PostgreSQL cases
cover arithmetic/privacy/version rejection, capture/replay, concurrent retries,
scope/actor isolation, role changes, policy-independent recovery, raw corruption,
SQL immutability and foreign-key deletion behavior. Build, types, zero-warning lint,
1529 server tests and 1042 client tests pass on the exact isolated source snapshot.
Independent source/migration/test review found no blocker. The live backend remained
healthy after generated Prisma/shared output refresh.
