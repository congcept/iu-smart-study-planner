# Simulation resource settings

The additive `SchoolResource` table stores one configuration per curriculum, semester
and year: professor/classroom/lab counts, maximum students per section, per-course
capacity/professor overrides, revision and server-recorded audit identity. The migration
adds numeric/year/revision bounds, object-shaped JSON, a unique scope and foreign keys.
Deleting a curriculum removes its configuration; deleting an actor retains it with null
audit identity. No existing courses, grades, progress or plans are rewritten or seeded.

Both `/api/admin/resources` endpoints require the current database ADMIN role. GET takes
exact curriculum/semester/year query fields and reads role, context and configuration in
one RepeatableRead snapshot. Unknown curriculum is 404; missing configuration is explicit
null. Every response carries `kind: SIMULATION` and minimal curriculum metadata. Reference
curricula are allowed for simulation; neither a calendar nor a real offering is asserted.

POST accepts a full replacement and `expectedRevision`. Zero creates only when absent;
positive values must match the current version. Serializable authorization, membership
validation and compare-and-swap increment happen together. Competing/stale writes return
409 without silently overwriting settings. The stable row identity is retained on update.
`updatedBy` comes only from the verified cookie actor; preconditions are never stored.

Overrides must name declared curriculum members, including unplaced members. Padding,
prototype keys, unknown fields, empty override values and more than 500 entries reject.
Zero override capacity is valid. Reads preserve historical overrides after membership
changes; full replacement writes revalidate current membership. Numeric bounds protect
storage/arithmetic and are not institutional capacity policy. Section size is positive.

Shared schemas and client adapters validate both requests and simulation snapshots.
Responses must match the requested curriculum and slot. Save confirmation requires the
expected next revision and a server actor; adapters never automatically replay a write.
Malformed stored projections are server errors rather than client validation errors.

Seventy-four new PostgreSQL and sixty-five adapter cases cover roles, validation, concurrent
creates/updates, revision exhaustion, constraints, audit history, membership and unchanged
academic data. Independent review found no blocking issue. Full quality totals are recorded
in AGENTS.md. The local additive migration and host/backend clients were generated; the
existing app remains healthy. No reset, seed, assignment or selector was used.

Next: a role-guarded simulation resource screen with deliberate conflict/recovery handling,
then demand/supply reporting, configurable scoring and scarcity allocation. This increment
does not compute supply, demand, utilization or enrollments, and it does not complete Phase 4.
