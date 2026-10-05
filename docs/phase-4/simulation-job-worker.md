# Explicit atomic simulation worker

The worker executes one explicitly selected immutable queue request. It captures the
current simulated cohort, mandatory prerequisites, highest-score numeric GPA, Bayesian
ratings, policies and saved resources, then stores the existing one-course aggregate run
with its terminal outcome atomically. It does not register students, persist individual
allocations, create full-semester timetables or open curriculum/calendar validation gates.

## Run one request

After applying additive migrations and building shared/generated Prisma outputs:

```bash
npm run allocation:run-one --workspace=server -- --apply <job-uuid>
```

The UUID comes from `POST /api/admin/allocation-jobs`. The command requires the exact apply
flag and one UUID; it never drains the queue, starts a timer, opens an HTTP listener or
runs during application startup. Invalid arguments exit 2 without processing work.
Success prints a private-free outcome. No available unlocked pending request for that ID
prints `processed:false`; this can mean completed, actively locked or absent, rather than
an empty global queue. Operational errors print a fixed redacted message and exit 1.
Inspect the outcome before retrying an uncertain command.

## Atomic execution and authorization

One Serializable transaction locks the selected pending request with `FOR UPDATE SKIP
LOCKED`. It holds the original author's row with `FOR SHARE` while verifying ADMIN role,
capturing input and saving the result. Role changes/deletion serialize with that work.
A deleted/demoted author produces `FAILED/AUTHOR_UNAVAILABLE` with no run. Confirmed domain
preview rejection produces `FAILED/PREVIEW_UNAVAILABLE`. New terminal requests are needed
after these conditions recover; the original request/outcome remains historical.

The preview uses the supplied transaction for all source reads; the normal synchronous
preview retains its existing RepeatableRead path and releases its transaction before CPU
work. Each successful worker generates a separate private run retry UUID, avoiding the
public queue retry-key namespace. Aggregate run creation and unique terminal outcome use
the same transaction. Interruptions, unknown database/configuration/corrupt-state errors
and transaction expiry roll back both writes, leaving no orphan result and allowing an
explicit retry. A lost successful response is recovered through the outcome read; another
worker sees the stored terminal result and does not capture again. Known serialization,
deadlock and unique races retry a bounded five fresh transactions.

The transaction timeout is fifteen seconds, with a three-second connection wait. Cohorts
above the existing 500-student limit fail before full history reads; 100 choices/student
and 10,000 total choices remain checked by the preview. These are operational bounds,
not institutional capacity rules. Historical input size and CPU work may still be large;
the caps do not guarantee completion within fifteen seconds. A timeout remains pending
and does not silently truncate student history. A future larger/full-semester workload
may need leases and work outside the transaction.

## Read outcomes

`GET /api/admin/allocation-jobs/:id/outcome` requires a current ADMIN and rejects query
or body overrides. Its RepeatableRead snapshot returns strict simulation/reference labels,
job ID/scope/queued time, `executionModel: ATOMIC_SINGLE_JOB`, status, nullable run ID,
nullable completion time and a nullable fixed failure code. Actor/retry/student identities,
scores and raw failures are excluded.

`PENDING` means no terminal outcome has committed and includes active in-flight work.
`SUCCEEDED` links one pinned V1 immutable aggregate capture. It verifies the immutable private run-to-job link, creator
provenance, exact scope and capture/storage/completion chronology against enqueue time.
`FAILED` has no run and only a fixed public failure code. Invalid stored state or linked
history fails closed. All admins can inspect terminal history after creator deletion;
private creator fields anonymize while the results remain unchanged.

The original `/allocation-jobs/:id` response remains an immutable QUEUED receipt showing
that inputs were not captured when it was enqueued. Use the outcome endpoint for execution
state; a receipt is not a current status screen.

## Storage

The additive one-to-one `SimulationAllocationExecution` table stores only terminal
SUCCEEDED/FAILED state. Database checks require exactly one successful run or a supported
failure code, unique job/run links and restrictive foreign keys. A SQL trigger rejects
terminal updates, allowing no-op only. A separate nullable unique private run-to-job
foreign key identifies exact worker provenance; earlier manual captures remain null and
public history omits the field. Its existing immutability trigger protects the new link. There is no terminal edit/delete API. Queue manifests,
aggregate runs, academic records and resource settings are not rewritten.

## Verification

83 pure outcome contracts, 44 PostgreSQL execution cases and 8 CLI cases pass. They cover
real concurrent workers/locks, blocked role changes, committed source writers, rollback
after each write, a real 15-second transaction expiry, 500/501 cohort bounds, SQL terminal
state/uniqueness/immutability/FKs, exact private provenance, corrupt links and historical
reads after creator deletion. CLI tests target private fixture IDs and verify explicit
apply/selection, no-drain behavior, safe replay and redacted transport errors. The linked
run field was added only after confirming no persisted worker success existed; no old
history was rewritten. Existing preview/capture/history regressions pass.

Build, typecheck, zero-warning lint and 1904 server / 1193 client tests pass on the exact
isolated source. All additive migration checksums match; generated shared/Prisma output
was refreshed and the retained backend remains healthy. Independent review found and
closed two gaps in capture chronology and malformed-roster failure classification, then
recommended the exact immutable job link. The app/database and unrelated drafts remain.

Next: safe browser queue/outcome controls and a protected explicit execution action.
Full-semester/per-student persistence and verified curriculum/resource/calendar metadata
remain pending.
