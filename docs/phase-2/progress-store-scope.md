# Confirmed scope in the legacy progress store

The editable legacy map accepts progress only from the private scoped snapshot endpoint with
its expected account owner and explicit `curriculumId: null`. Its confirmed scope is cleared
on owner change or hydration. Cache contents and old server-cache markers never authorize writes.
Assigned snapshots clear visible selections and lock the map without publishing assigned data
into the null-context account cache. Assigned reference screens remain read-only.

Completion and archived import attach the hydrated `expectedScope` as a server transaction
precondition. Their flat POST responses are ignored. A separate validated scoped GET confirms
current saved selections before reconciliation; pending locks cover that read too. Owner/load
generations are checked after each asynchronous boundary, including A→B→A account transitions.

Failed or lost responses recover through the same scoped read. A successful POST and matching
confirmation retire an import archive. Lost-response recovery retains it for an explicit additive
retry. A changed curriculum keeps the archive and old cache while withholding edits. First-null
hydration archives the original disk selections even after assigned hydration cleared the display.
Guest selections stay local; denied storage never invalidates a confirmed server operation.

Existing owner-only cache keys are used solely for null-context snapshots. Full context-keyed
cache activation, assigned editing, assignment/switch UI, and ratings/planner adoption remain
separate increments. No curriculum assignment or database migration is enabled by this change.

Validation: 780 real-PostgreSQL server tests and 534 client tests; build, types, zero-warning lint.
Thirty-three new client cases exercise real adapter validation, assigned/invalid snapshots,
separate confirmation, archive retention, generation races and write preconditions. Independent
source review found no blocking issue. A disposable local browser account saved one completion;
after its test assignment changed, the stale action was rejected and the original completion
remained visible as 4 earned credits in the read-only reference after reload. Test fixtures and
listeners were removed without stopping the user's application.
