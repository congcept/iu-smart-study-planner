# Scoped saved progress snapshot

`GET /api/users/me/progress/snapshot` is a protected additive read endpoint. It accepts no query
overrides and returns `{ scope: { userId, curriculumId }, progress: { completedIds, plannedIds } }`.
The cookie owner and stored UUID/null curriculum are read with active selections inside one
RepeatableRead transaction. Missing owners do not receive an invented null scope. Assigned
membership hides nonmember history from active selections without deleting or remapping records.
Unassigned accounts retain global legacy selections. Existing progress endpoints stay compatible.

`ScopedStudentProgressSchema` validates the full shape. It normalizes owner, context and course
UUIDs, rejects ambiguous case-equivalent duplicate course identities and completed/planned overlap,
and accepts no unrelated degree or assignment metadata. Saved elective claim text is preserved
exactly, including legacy whitespace; read validation never converts or reassigns it.

`getScopedStudentProgress(expectedUserId)` validates the expected UUID before requesting private
data, checks the envelope and full schema, and rejects another cookie owner. It returns the fresh
stored context with its selections for later store activation; the caller cannot override context.

## Verification

All quality gates pass on the isolated owned source: build, typecheck, zero-warning lint,
780 real PostgreSQL server tests and 501 client tests. Added 11 database and 19 adapter cases
cover assigned/unassigned and empty snapshots, unchanged history, cookie ownership/access,
query overrides, malformed responses, casing, duplicates, overlap and a concurrent simulated
curriculum change within a repeatable snapshot.

The initial full run had one unexpected 401 in the existing administrator uppercase-UUID read
case. The focused 11-case suite and a complete unchanged-source rerun passed. The cause remains
unconfirmed and is recorded in AGENTS.md; no authentication policy was weakened to pass checks.
Final review is inline because requested workers reached an account usage limit.

## Next

Activate scoped hydration/recovery in the progress store; retain owner/context in its cache and
mutation generations; send the confirmed completion/import preconditions. Then guard rating
writes. The current store has not adopted this adapter, and assigned curriculum editing,
assignment, the selector, validated IT/DS data, full degree totals and school-admin allocation
remain gated or incomplete. This endpoint adds no mutation, migration, seed or data reset.
