# Own semester simulation discovery

Cookie-account GET /api/users/me/semester-allocation-runs discovers saved own results without
an externally supplied run identifier. The query accepts only an optional strict UUID `after`;
identity, curriculum, semester, year and page-size overrides are rejected. Pages contain at most
five strict frozen V1 own outcomes, a normalized requested boundary and a next boundary only
when a sixth accessible record exists. Each result exposes the captured scenario, timestamps,
own target/assigned/remaining credits, terminal reason and assigned course identifiers/credits.
No roster, participant identity, author, request key, private utility, cohort aggregate or
current course metadata is returned.

Authorization, cursor verification and newest-first keyset reads share one RepeatableRead
snapshot. Access uses only the live participant account FK. Historical results survive later
role/curriculum changes; account deletion removes access, and recreating the same UUID cannot
reattach it. Missing, deleted and nonowned cursor identifiers receive the same recoverable 409
response. Ordering uses immutable storage time, then identifier descending; newly inserted
captures do not shift continuation boundaries. The response contract preserves submillisecond
ordering when validating serialized timestamps. The database stores millisecond DateTimes.

The existing verified own projection is shared with exact-ID reads; the frozen V1 definitions
are unchanged. Whole private snapshots and their bounded child records are verified before
projection, including a cursor and the six-record lookahead. Unsupported or inconsistent
snapshots and missing/mismatched other participants fail closed without partial page data.
Only owned-access records are inspected. Current courses, grades, progress, cohort eligibility,
resources and live scoring configuration are not used to reinterpret history.

Reads fetch six runs and at most 501 participants per run. A separate owned cursor may add one
run verification. The explicit transaction limits are three seconds acquisition and thirty
seconds execution; record/choice bounds do not guarantee those latency budgets. Full-scale
profiling remains a deployment gate. No migration, background job, reset/seed, academic mutation
or resource mutation is introduced. Twenty-five real PostgreSQL and seven pure contract cases
cover ownership/privacy, coherent concurrent reads, pagination/ties, historical roles/scopes,
deleted-account revocation, corruption and strict contracts. Full quality results/publication
are recorded in AGENTS.md. Browser own-result reading controls remain the next increment.
