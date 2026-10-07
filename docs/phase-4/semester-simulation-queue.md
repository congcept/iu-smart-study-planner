# Separate semester simulation queue

ADMIN-only POST `/api/admin/semester-allocation-jobs` stores a scenario-only request with a
mandatory local expected-actor precondition and a per-admin retry UUID. Strict input contains
only curriculum, semester, year, expected actor and retry key. Fresh role authorization is
locked with `FOR SHARE` through each bounded Serializable attempt. Actor matching precedes
retry lookup. Matching retries return the same identifier/time; changed scenarios conflict.
Conflicting/concurrent writes retry at most five times. Each transaction has explicit 3s
acquisition and 10s execution budgets; these are limits, not latency guarantees.

GET `/api/admin/semester-allocation-jobs/:id` returns the original immutable receipt after fresh
administrator authorization in a bounded RepeatableRead transaction. Known serialization
conflicts (including raw PostgreSQL 40001/40P01) retry from fresh transactions at most five
times in both submission and reads; authorization errors propagate immediately. It rejects query/body
identity or scenario overrides. Any current administrator can inspect the receipt; neither
author nor retry key is projected. Public data is limited to identifier, scope, enqueue time,
simulation/reference labels, pinned `SEMESTER_CREDIT_BUDGET_V1`, `QUEUED` and
`inputsCaptured:false`. This is enqueue intent, not a mutable execution-status response.

Enqueue/replay/read do not compute allocations or read cohort, grades, plans, policies or
resources. Requests can be stored before resource inputs are available. No capture, private
participant assignment, academic change, worker, timer, startup execution or browser control
is introduced. Explicit semester execution and terminal outcomes are separate increments.
Existing one-course jobs and frozen semester capture V1 formats are unchanged.

The additive table has a separate retry namespace, pinned-model/year checks, named indexes,
curriculum deletion/update restrictions and nullable creator provenance. Creator deletion
detaches the link while preserving intent. A trigger freezes all source fields except
one-way creator-to-null anonymization; reassignment and reattachment are rejected. Queue
history does not belong to a subsequently recreated account with the same UUID. Applied
migration checksum and live index/constraint/trigger names match reviewed source and Prisma.
The running app/database is preserved; no reset, reseed or curriculum activation occurred.

Thirty-three real PostgreSQL cases verify private-free receipts, actual concurrent same-key/
scenario races, role changes after middleware, role-writer blocking through queue commit,
fresh authorization after writer-first conflicts in submission and reads, schema/SQL
immutability, creator deletion, strict HTTP contracts, corrupt identity rejection,
real insert-then-failure rollback and unchanged academic/resource/capture data. Thirty-five
pure cases protect strict intent/receipt compatibility and reject captured/execution claims.
Required full build/type/lint/regression results and the next direction are in AGENTS.md.
