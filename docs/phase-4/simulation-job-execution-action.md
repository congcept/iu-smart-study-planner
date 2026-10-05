# Explicit admin execution action

`POST /api/admin/allocation-jobs/:id/execute` executes only the selected simulation request.
It does not start a worker, drain a queue, or create student assignments. The existing CLI
remains available; neither entry point executes jobs automatically.

The strict body contains `curriculumId`, `semester`, `year`, and mandatory
`expectedActorId`. It accepts no query overrides, replacement inputs, or additional retry
key. The selected immutable job ID is the retry identity.

The API requires a cookie-authenticated ADMIN. The worker also reads the current acting
account under `FOR SHARE` inside its Serializable transaction and holds that lock through
capture and terminal commit. A missing account returns 401; a non-admin returns 403. An
expected-account mismatch returns 409 before the job is looked up. A missing job returns
404; a scenario mismatch returns 409 before any claim or capture. A current administrator
can execute a request queued by another administrator, but the original author must still
be available as an ADMIN for a new capture. The original author remains the capture's
author; the action does not replace the immutable manifest or claim authorship.

The successful envelope contains `{ processed, outcome }`, verified against
`AllocationJobExecutionSchema`. `processed: true` means this transaction committed a
terminal result, either SUCCEEDED or a confirmed domain failure. `processed: false` means
this invocation did not execute the selected request. Its outcome can be a previous
terminal result or snapshot-coherent PENDING when another transaction holds the job lock.
It does not assert that the request will remain pending after the response.

Terminal replay still requires the current acting ADMIN and matching account/scenario.
It validates the stored private run-to-job provenance and returns the immutable result
without recalculation. It does not require the original author's current role, because
the capture has already committed. Source-account deletion can anonymize provenance links
without discarding history.

Execution uses the existing bounded atomic worker: capture and terminal state commit
together; unexpected source/configuration, database or transport errors roll back and
leave the job retryable. On an uncertain HTTP response, explicitly read the selected
job's outcome before retrying that same ID. Repeated or concurrent actions cannot create
multiple captures. No mutation is sent as part of a GET, page load or startup.

This is a synchronous action with a 15-second transaction timeout, bounded retries, and
the existing cohort/choice output limits. Those limits do not bound every history/CPU
input or guarantee completion. Larger full-semester execution, leases, polling and
individual assignment persistence remain separate work. The simulation still uses the
reference one-course allocation round and unverified calendar/resource assumptions.

The next client increment must preserve account/scenario identity, durable enqueue keys,
runtime response validation and explicit outcome recovery. It must not silently retry
a write under a different account, create replacement jobs after uncertain responses,
or describe the immutable QUEUED receipt as current execution state.
