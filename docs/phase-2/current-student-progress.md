# Current-student progress: API increment

Two cookie-authenticated endpoints derive ownership from the session, never from
a submitted student ID:

- `GET /api/users/me/progress` returns `{ completedIds, plannedIds }` in the normal
  `{ success, data }` envelope. Completion values contain the elective-group claim
  or null; plans contain course UUIDs. Other statuses are excluded.
- `POST /api/users/me/complete` accepts `{ courseId, electiveGroup?, status? }`.
  Status defaults to `COMPLETED`; `PLANNED` moves the course into the plan and
  `DROPPED` removes it from completion/planning. Its response includes the full
  progress snapshot and `uncompletedCourseIds` for dependent completions removed
  by the cascade. Both snapshot and mutation occur in one serializable transaction.

All prerequisite rows are mandatory, including recommended/corequisite rows.
Rejected completion returns 409 without changing records. Unknown course IDs
return 404; invalid body fields or states return 400. Grades remain a later API
increment; these endpoints do not accept or overwrite grade metadata.

The additive migration adds nullable `student_records.elective_group`. Existing
records retain null claims. Repeating completion without a new claim preserves
the existing claim. Planning/dropping clears it. Duplicate elective memberships
still come from the legacy curriculum JSON; claims round-trip without assuming
the global Course row represents all memberships.

Apply migrations with `npm exec --workspace=server -- prisma migrate deploy`,
then `npm run db:generate --workspace=server`. Docker's separate backend Prisma
client also needs regeneration and a backend restart after schema changes.
The local database was migrated without a seed reset.

Browser clicks now use these endpoints. Signed-in progress hydrates before editing;
optimistic writes reconcile the server's full snapshot. Failed writes roll back and
reload authoritative state, including when a committed write's response was lost.
If recovery fails, editing stays blocked until retry succeeds. Account switches
invalidate late reads/writes, including switching away and back to the same account.

Anonymous demo selections remain browser-local. On first signed-in hydration,
pre-sync account cache is archived under `browser_progress_backup:<userId>` and
offered as a JSON download. A marker distinguishes confirmed server cache from
old browser-only selections. Guest selections are never copied into an account.
Bulk import of archived selections and hardening legacy public reads remain next.

Tests run against real PostgreSQL and cover session ownership, elective claims,
plans, mandatory prerequisites, transitive cascades, idempotence, metadata
preservation, and rejected writes. Existing service tests also cover cycles and
concurrent mutations.
