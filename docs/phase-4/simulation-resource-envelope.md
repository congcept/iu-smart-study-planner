# Shared simulation resource envelope

`GET /api/admin/resource-envelope` adds an ADMIN-only read for the existing strict
curriculum/semester/year scenario. It returns the applied policy, saved resource revision,
inventory and a shared classroom-section ceiling. Existing resources, demand, capacity,
recommendations and the admin screen retain their contracts and behavior.

## Explicit assumptions

Model `SHARED_CLASSROOM_SECTION_ENVELOPE_V1` treats a time block as one abstract, nonoverlapping
opportunity for a complete classroom section. It is not a lesson period, hour or verified calendar
slot. Each section uses one classroom and one interchangeable professor for one whole block.
Staff qualifications, actual availability and recurring course meetings remain unverified.

Deployment settings are canonical integers from 0 to 100:

- `SIMULATION_CLASSROOM_TIME_BLOCKS`, default 1.
- `SIMULATION_SECTIONS_PER_PROFESSOR`, default 1.

Missing variables use defaults; blank, malformed, fractional or out-of-range values fail startup.
Explicit zero means no modeled opportunities or teaching load. Settings are validated/frozen at
startup and captured before each resource read. Applying different values requires a backend
restart. The response includes the entire applied policy: resource revision alone cannot identify
an envelope when deployment assumptions change.

## Shared ceiling

```
classroom sections = classrooms × time blocks
professor sections = professors × min(time blocks, sections per professor)
shared sections = min(classroom sections, professor sections)
shared seats = shared sections × students per section
```

The staff clamp prevents a professor being counted in two simultaneous sections. For example,
10 classrooms, one professor, one block and a ten-section professor limit still produce one shared
section. Three classrooms, two professors, three blocks and a two-section professor limit produce
nine room opportunities, four staff opportunities and a shared ceiling of four sections.

The inventory is shared across sections within this one curriculum scenario. The ceiling is never
copied into each course, compared with undated intentions or claimed as semester supply. It does
not reserve resources, select courses or validate a feasible timetable/allocation. Other curricula
may refer to the same real resources; no cross-curriculum reconciliation is claimed.

Lab rooms remain raw inventory. Course capacity/professor overrides are unapplied, and no professor
reservation for labs is modeled. These omissions, teaching load, availability, qualifications,
offerings, complete demand, timetable and allocation limitations are explicit fixed false flags.

## Snapshot, validation and privacy

The existing production `readResources` wrapper reads current actor role, curriculum metadata and
the resource row in one RepeatableRead transaction. Full stored metadata, including unapplied
historical overrides, must validate before projection. Corruption yields a server failure.

Strict shared validation enforces scope identity, bounds, arithmetic and null agreement. Missing
settings return null inventory, revision and envelope; configured zeros produce known zero
ceilings. The maximum modeled seat ceiling is 10¹², within safe integer bounds. Audit identities,
timestamps, course/student data and override contents are not exposed. The endpoint performs no
writes, assignment, seed or migration.

## Verification

70 pure/schema cases, 16 configuration cases and 32 real-PostgreSQL cases cover arithmetic,
the concurrency clamp, bounds, missing/zero resources, strict scope/policy/response validation,
privacy, malformed historical metadata and unchanged grades/ratings/plans/assignments.

The default production reader is exercised with pass-through scheduling around its real actor
SELECT. An independent writer then commits a resource revision/inventory change and actor demotion.
The in-flight reader retains its original resource snapshot; the next read rejects with 403.
Another endpoint case demotes the actor after real middleware authorization but before the resource
reader, verifying that its current-role check also rejects the request. Fixtures are removed.

Independent source review found no blockers; both requested race regressions were added. The exact
isolated source passes build, typecheck, zero-warning lint, 1153 server tests and 992 client tests.
The earlier approval-service usage failure resolved before PostgreSQL verification. Shared exports
were compiled in both existing development containers; backend health and new-route 401 protection
were checked. Containers/database volumes were not recreated, and unrelated local edits are preserved.

## Next increment

Add complete eligible cohort demand: preserve the distinction between planned intentions and
recommendations, apply mandatory prerequisites/GPA context, and count a student once per course
across both sources. Keep term/offerings and curriculum activation gates explicit. Only then connect
tested resource policy to configurable multi-objective scores and scarcity allocation.
