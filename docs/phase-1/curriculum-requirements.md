# Uncoded curriculum requirements

CurriculumRequirement stores an explicit FREE_ELECTIVE requirement without inventing a global
Course identity. The current legacy CS source contains a blank-code three-credit Free elective
at Year 3 Semester 2; it must survive a future source backfill as a requirement, not a course.

The additive table contains curriculum, kind, exact name, credits, optional year/semester,
source order and source label. Source order is unique within each curriculum. SQL enforces
positive credits/year, semester 1–3 and nonnegative order; unknown placement may remain null.
Context deletion cascades only requirements and clears existing user assignment; global courses
and student records survive. No backfill, current reader change, seed or user assignment occurs.

Populated migration fingerprints for all 13 existing data tables remain unchanged. The full
migration history also succeeds on a disposable fresh database. Eleven PostgreSQL cases cover
persistence without fake courses, source uniqueness/isolation, missing context, cascade direction,
credit/placement checks and explicit unknown placement. Build/typecheck/zero-warning lint and
468 server / 310 client tests pass. This increment was reviewed inline after the subagent thread
limit; earlier independent reviews do not cover it.

Next is an explicit atomic/idempotent legacy CS backfill. It must validate every code against
existing global rows, retain all repeated placements/group claims and this requirement, keep
unknown graduation totals null and preserve legacy provenance. Conflicting contexts must fail
without partial writes. Context APIs/readers and verified IT/DS remain separate.
