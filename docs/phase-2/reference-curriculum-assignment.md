# Reference curriculum assignment

This increment gives `users.curriculum_id` a reviewed writer. Until now no endpoint, service,
script or seed could set it, so every curriculum-context reader — the read-only reference view,
the contextual progress summary, the scoped planner preview, the contextual grade GPA and the
whole admin cohort/demand/allocation stack — was reachable only by editing the database directly.

It is an **administrator-only simulation reference assignment**. It is not cohort activation, it
is not institutional validation, and it does not enable assigned-context editing.

## Contract

`GET /api/admin/users/students` — `requireAdmin`

- Lists `STUDENT` accounts only. Administrator rows are never returned.
- 50 accounts per page, ordered by `studentId`, with an optional `after` keyset continuation.
- Each account reports `curriculumId` and, when assigned, `{ id, code, name }` of that curriculum.
- An `after` value that no longer identifies a student account returns `409`; the caller reloads
  instead of silently restarting from the first page.

`POST /api/admin/users/students/:userId/curriculum` — `requireAdmin`

- Body (strict): `{ curriculumId: uuid | null, expectedCurriculumId: uuid | null }`.
  `curriculumId: null` clears the assignment.
- Reply (strict): `{ userId, curriculumId, usage: 'REFERENCE_ONLY', changed }`.

## Transaction and preconditions

One `Serializable` transaction, retried at most five times on `P2034`, or on raw PostgreSQL
`40001`/`40P01` surfaced through `P2010`:

1. The acting administrator's row is read `FOR SHARE` and held through commit, so a demotion
   cannot commit while the assignment is still deciding. A demoted actor is refused with `403`.
2. The target row is locked `FOR UPDATE`. A missing target is `404`; a non-`STUDENT` target is
   `403`, so an administrator account can never be assigned to itself or to another administrator.
3. If the stored value already equals `curriculumId`, the reply is `200` with `changed: false`.
   **This check runs before the precondition**, so a retry after a lost reply recovers instead of
   conflicting. No receipt table and no request key are needed.
4. A non-null `curriculumId` must exist, otherwise `404`.
5. `expectedCurriculumId` must equal the stored value, otherwise `409`. A conflict is never
   rebased or replayed.
6. `users.curriculum_id` is updated. Nothing else is written.

No `StudentRecord`, `GradeAttempt`, `CourseRating`, `StudyPlan`, `ReferenceSelectionReceipt` or
`SchoolResource` row is created, changed or deleted. Existing records stay byte-identical; courses
outside the newly assigned curriculum continue to appear as preserved history through
`studentAccountViews.ts`, exactly as they did before this increment.

There is **no assignment history or audit row**. The column is a single mutable value, and the
`changed` flag describes only the request that produced it. A demonstration that needs an audit
trail would require a new table and migration; that is deliberately out of scope.

## Client

`/admin` gains a _Reference curriculum assignment_ section above the simulation settings. It reads
its own account list and curriculum references, writes nothing on mount, and requires an explicit
button press. The administrator session is confirmed before and after both successful and failed
writes; a lost confirmation hides every student row rather than showing stale identities. The
unconfirmed request stays visible after a failure so the same bytes can be retried. The panel
states the reference-only boundary and the operational consequence: an assigned account loses the
legacy editable map and its progress store becomes read-only.

## Verification

Twelve real-PostgreSQL server cases cover authorization and identity, stripped-body rejection,
assignment and session propagation, idempotent retry, stale precondition, clear and round trip,
unknown account/curriculum and administrator targets, byte-identical preservation of
records/attempts/ratings/plans, bounded student-only listing, continuation conflicts, a
concurrent two-writer race resolving to one winner, and a real row-lock demotion rejected with
`403`. Eight client cases cover the read-only first paint, prefill and dirty gating, attach and
clear, conflict retention, session loss before and after the reply, unavailable case
confirmation, and cursor paging.

## Still open

Assigned-context editing, completion/claim transfer, context-keyed browser cache activation, and
validation of existing records against the assigned curriculum remain separate increments. No
curriculum is verified or activated by an assignment, and the IT/DS sources still need
reconciliation before any cohort is trusted.
