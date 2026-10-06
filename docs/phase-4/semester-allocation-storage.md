# Private semester simulation storage

Semester simulation history has separate run and participant tables. A run retains a private
captured V1 replay result, exact scenario, capture/storage times and an account-scoped retry
key. Participant rows retain each captured student UUID, exact frozen student outcome and
a nullable live account link. No academic plan, grade, progress or resource row is modified.
Existing one-course aggregate runs, jobs, workers and HTTP routes remain unchanged.

The storage helper accepts a trusted server-produced result, current actor/scenario
preconditions and a capture-completion time. There is no HTTP writer or uploaded-roster
endpoint in this increment. New saves require a Serializable transaction. The current ADMIN
actor is locked FOR SHARE through commit; the mandatory expected actor rejects account
changes before retry-key lookup. Every participant must still be a STUDENT in the exact
curriculum and is locked FOR SHARE while the run and participant rows commit atomically.
This protects access linkage; it does not establish official academic eligibility.

Existing actor/key saves recover first, before parsing a new producer result, capture time
or current cohort. Scope mismatches reject with 409. Recovery verifies the entire captured
snapshot and exact participant set, then returns the original aggregate. Serialization and
uniqueness conflicts have bounded retries; unknown errors roll back and preserve the key for
explicit recovery. The standalone wrapper has a fifteen-second transaction limit. Its
caller-transaction helper requires the caller to supply Serializable isolation and handle
commit/retry; success inside that helper does not prove the outer transaction committed.

Frozen V1 definitions validate stored scope, envelope, policy, supplied choices, deterministic
round ordering, score arithmetic, credit budgets, section/seat accounting and completeness.
They import no evolving preview/configuration schema. Stored participant JSON must equal the
corresponding replay outcome exactly. A bounded 501-row read rejects excess, missing, duplicate
or inconsistent participants. Corrupt history fails closed and is never recalculated from
today's curriculum, grades, ratings or resources. Future semantic changes require a new
version while these readers stay pinned.

Admin reads project aggregate counts, stop reasons, credits, course ledgers and captured
simulation resources. Participant UUIDs, individual choices/utilities, assignment traces,
retry keys and author identifiers are absent. Owner reads authorize only through the live
participant account FK, then verify the whole run before returning that one student's credit
target, assigned course IDs/credits, shortfall and reason. They never return another student's
identity or outcome. Changing an account's current curriculum does not rewrite historical
results. There are no new HTTP reads in this foundation; protected routes are a later increment.

Update guards preserve captured fields. Account deletion may null author/participant access
links; null links cannot be rebound to another or recreated account. Captured student UUIDs
remain in private replay data, so deletion revokes access rather than anonymizing or erasing
that history. No application deletion route is provided. Privileged/test fixture deletions
remain possible, matching existing history tables; missing participant data is detected on
reads. This is not a data-retention guarantee.

The computed result keeps its original `persisted:false` meaning. The stored wrapper adds
`snapshotStored:true` and `simulationAssignmentsStored:true`; all official eligibility,
allocation and timetable flags remain false and public projections say
`academicPlansChanged:false`. These are stored simulation outcomes, not enrolment or verified
semester plans. Row/choice limits do not bound all replay JSON parsing cost or guarantee
completion inside the worker timeout. Coherent server cohort production, explicit capture/
execution recovery, private/public routes, calendars, lab/staff metadata and deployment
remain open work.
