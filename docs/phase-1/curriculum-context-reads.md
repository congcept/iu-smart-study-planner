# Read-only curriculum contexts and scoped priors

`GET /api/curricula` lists reference metadata in code order.
`GET /api/curricula/:id` returns one consistent context snapshot. IDs are validated UUIDs;
uppercase input is normalized, malformed IDs return 400 and absent contexts return 404.
These public catalog reads contain no user identities or assignments. All contexts are
explicitly `REFERENCE_ONLY`; unknown degree totals and source provenance remain visible.

The detail projection contains unique global course identities with context placement arrays,
uncoded requirements, and context prerequisite edges. Repeated elective appearances retain
their order, slots, claims and selection counts. Global legacy placement/category fields and
prerequisite relationships are not used as fallbacks. Preserved flags accompany an explicit
`mandatory: true` policy marker. The new shared DTOs are separate from legacy course responses.

Cached course vote averages/counts stay global. The Bayesian prior is the mean of actual votes
on unique member courses, from any student (`CURRICULUM_RATINGS`). With no such votes, it uses
the mean seed difficulty of unique member courses (`CURRICULUM_SEED`), even when unrelated
global votes exist. Repeated placements do not weight the prior. Empty contexts have a null
prior and no invented course estimates. All evidence and prior reads share RepeatableRead;
aggregation runs once for the collection, rather than once per course.

Fourteen PostgreSQL cases cover shared-course isolation, placements, requirements, mandatory
context edges, seed/rated/vote-weighted priors, empty contexts, UUID handling, batched queries,
concurrent-vote snapshot consistency and read-only behavior. Shared-first build/typecheck,
zero-warning lint, 508 server tests and 310 client tests pass for the isolated snapshot.
The compiled HTTP smoke check returns all 56 CS identities, 71 placements, one requirement and
21 mandatory edges with one consistent prior. Final review was performed inline after the
earlier agent thread limit.

The current student UI and mutations still use legacy paths. No student is assigned and no
selector is enabled. Next resolve account-scoped completion/import/cascade and saved progress
through context membership and placement claims, then grades, recommendations and semester
planning. Context-sensitive course requirement categories still need verified metadata before
subject/category personalization can change. Signed IT/DS source reconciliation remains a gate.
