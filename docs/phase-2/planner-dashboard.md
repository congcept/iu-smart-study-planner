# Planner dashboard

The protected `/planner` page reads the current cookie account’s saved planned course IDs
and the course catalog. It deduplicates saved IDs in server order and blocks analysis when a
saved ID is unknown. Browser-cached selections are not treated as confirmed progress.

Reload replaces the prior analysis and suggestions. Owner/request generations ignore late
responses after account or selection changes, including A–B–A transitions. Concurrent analysis
clicks share one active request. Failed or malformed successful responses expose retry.

Selected courses display actual rating estimates and vote counts; an absent legacy estimate
stays unknown. Planned credits include physical training. Calculate uses the existing server
workload endpoint and reports its estimate, average difficulty, heuristic band and notes.
This is not a prerequisite, timetable, teaching-capacity or personal-study-time feasibility check.

Suggestions use the server’s numeric GPA path, highest-score grade fit, mandatory prerequisites
and Bayesian difficulty. Explicit null GPA retains both final-semester options; the map’s manual
choice is not persisted or applied here. Suggestions are read-only; change planned selections
in My curriculum. No Add/Save control is wired without a real progress mutation.

Verification: build, typecheck, zero-warning lint, 427 PostgreSQL server tests and 310 client tests.
76 new client cases cover hydration, missing/ambiguous catalogs, accounts, stale handlers,
selection changes, malformed results, retries, rating confidence, read-only actions and route
access. Desktop and 390px browser checks cover calculation, reload and horizontal overflow.
An independent source/capture review prompted darker recommendation labels and semantic risk
badges; broader timetable validation, curriculum context and resource allocation remain pending.
