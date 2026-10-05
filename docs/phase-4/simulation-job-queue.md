# Durable simulation queue requests

This increment stores immutable scenario requests separately from explicit worker execution. Enqueueing does not compute an allocation, capture live inputs, schedule a timer
or register a student. The original queued response remains an immutable receipt. Explicit single-job execution
and terminal status reads are now available; see [the worker guide](simulation-job-worker.md).

## API

`POST /api/admin/allocation-jobs` requires a cookie-authenticated current ADMIN and strict
`curriculumId`, `semester`, `year`, `requestId`, and `expectedActorId`. UUIDs normalize to
lowercase; years use the existing 2000–2100 scenario bounds. The actor precondition prevents
saving under a switched cookie account. The server does not accept author, status, result,
policy, resource, student, scheduling or execution overrides, including query parameters.

Current authorization, actor matching, per-actor retry lookup, context existence and
creation share a Serializable transaction. New requests return 201; an identical retry
returns 200 with the same ID/time. Changing scope with an existing key returns 409. Missing
context returns 404. Bounded serialization/unique retries preserve the original key;
uncertain persistence conflicts return 409 so callers can explicitly retry that key.

`GET /api/admin/allocation-jobs/:id` accepts a strict UUID and no query overrides. All current
admins may inspect the request. Current authorization and retrieval share RepeatableRead.
Replies contain only ID, simulation/reference labels, scope, `status: QUEUED`, queued time
and `inputsCaptured: false`. Creator IDs, retry keys and private student data are excluded.
Invalid stored public metadata fails closed rather than producing a partial receipt.

## Storage and limits

The additive `SimulationAllocationJob` table has an actor/request unique key and scoped
chronological index. Curriculum deletion is restricted. Creator deletion sets its private
FK to null while preserving the original request. A SQL trigger rejects updates to source
fields or author reassignment; anonymization/no-op is permitted. There is no update/delete
API, source rewrite, reset or seed operation.

Enqueue/read do not read live policies, cohort, resources, grades, ratings or allocation
results. Unverified reference contexts and absent resources can still hold a request; this
is not a validation or execution claim. The explicit worker captures coherent live
inputs at execution time and retains the preview's size and verification gates. Terminal
execution outcomes remain separate from this immutable source manifest.

## Verification

84 pure contract cases and 41 real PostgreSQL cases cover strict inputs/privacy, mandatory
actor guards, fresh role reads, same-key replay/conflict, distinct actors, true concurrent
enqueues, creator anonymization, SQL source/year/FK/unique constraints and unchanged
academic/resource/run records. Independent source/migration review found no blocker.
Build, typecheck, zero-warning lint and 1769 server / 1193 client tests pass on the exact
isolated source snapshot. The sole reviewed additive migration was applied with deploy;
its checksum and actual scoped index name match. Generated shared/Prisma outputs were
refreshed without recreating the running app or database.

Explicit atomic single-job execution and sanitized terminal outcomes are shipped in the
worker increment. Next: browser queue/outcome controls and an explicit execution action. Full-semester/per-student allocation persistence and official
calendar/resource/degree verification remain pending.
