# Bounded semester request history

ADMIN GET `/api/admin/semester-allocation-jobs` discovers five requests for one strict
curriculum/semester/year scenario, with optional exact UUID continuation. Each entry pairs
its immutable original enqueue receipt with its outcome from the same database snapshot.
Public data excludes author, retry key, participants, choices, grades and private results.
The original receipt remains QUEUED intent even when its separate outcome is terminal.

Ordering and continuation use immutable queue time and identifier descending, never
completion time. The response echoes the requested boundary. Missing, deleted, foreign-scope
and one-course cursors share a recoverable 409 response; unknown curricula return 404. Strict
query/body contracts reject identity, page-size, status and model overrides.

Fresh current ADMIN authorization is held with FOR SHARE through the bounded RepeatableRead
transaction. Context, cursor, page and outcomes share that snapshot. The cursor and all six
fetched rows, including lookahead, undergo whole private V1/participant verification and
exact provenance checks. A top-level linked-run read rejects nonterminal/failed orphans and
confirms successful links without per-entry extra queries. Corruption fails closed without
a partial page. Creator deletion preserves history while current role authorization remains.

Five rows plus one lookahead and an optional cursor bound the read to seven private snapshots,
with at most 501 participant rows fetched per run and over 500 rejected by existing verification.
Known serialization conflicts retry from fresh transactions at most five times, with 3s
acquisition/30s execution budgets. These are bounds, not a latency or maximum workload guarantee.

No job execution, academic mutation, migration, live-policy reinterpretation, activation,
reset or reseed is introduced. The existing exact-read verifier and immutable formats are
reused without changing existing one-course or semester readers. Real PostgreSQL tests cover
coherence across an actual worker/capture/participant/terminal commit, both role-lock orders,
stable tied-time pagination, new inserts, terminal updates, strict privacy and corrupt
cursor/page/lookahead/orphan data. Full checks and the next browser step are in AGENTS.md.
