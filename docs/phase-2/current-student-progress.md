# Current-student progress: API increment

Three cookie-authenticated endpoints derive ownership from the session, never from
a submitted student ID:

- `GET /api/users/me/progress` returns `{ completedIds, plannedIds }` in the normal
  `{ success, data }` envelope. Completion values contain the elective-group claim
  or null; plans contain course UUIDs. Other statuses are excluded.
- `POST /api/users/me/complete` accepts `{ courseId, electiveGroup?, status? }`.
  Status defaults to `COMPLETED`; `PLANNED` moves the course into the plan and
  `DROPPED` removes it from completion/planning. Its response includes the full
  progress snapshot and `uncompletedCourseIds` for dependent completions removed
  by the cascade. Both snapshot and mutation occur in one serializable transaction.
- `POST /api/users/me/progress` imports an archived selection snapshot with
  `{ completedIds: { [courseUuid]: electiveGroupOrNull }, plannedIds: [courseUuid] }`.
  It adds to current progress; it never replaces the whole account snapshot.

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
The import API and account-scoped browser action are implemented; review/import controls remain the next slice.

## Archived selection import

Import is explicit and account-scoped. An existing completion keeps its elective
claim and grade/semester/year metadata; imported completions can promote an existing
noncompleted record while preserving its metadata. Imported plans create missing
records only, preserving all existing statuses. Unrelated records remain unchanged,
and empty imports are no-ops. Repeating an import does not duplicate records.

The API validates the entire batch before writing. Every prerequisite is mandatory
and may be satisfied by an existing completion or an earlier course in the same
batch. Input order does not matter, but a cycle of newly imported completions cannot
unlock itself. An unknown course returns 404; an unmet prerequisite or cycle returns
409; either leaves all records unchanged. The successful response is the full
authoritative progress snapshot from the same serializable transaction, with bounded
retries for concurrent changes.

Inputs are strict: UUID course IDs, at most 500 completions and 500 plans,
nonempty elective claims up to 100 characters, no duplicate planned IDs, and no
course in both lists. Submitted user IDs and grade fields are rejected. The browser
keeps backups until a confirmed import; guest
selections remain separate. No migration, dependency installation, or seed reset
is needed.

## Legacy read access

Legacy student reads now require a cookie session. `/api/users/:id`,
`/api/users/:id/records`, and `/api/users/:id/progress` allow the owner (database UUID
or ordinary student ID) and administrators. A UUID-shaped identifier always refers
to the database UUID, preventing a student ID from impersonating another user.
Only administrators can list `/api/users`.

`/api/study-plans/user/:userId` and `/api/recommendations/user/:userId` accept the
owner's database UUID or an administrator session; they do not resolve student-ID
aliases. Reading `/api/study-plans/:id` checks the plan's stored owner. Anonymous
requests return 401, authenticated requests for another student's data return 403,
and an authenticated request for a missing plan returns 404.

Public curriculum/course data, prerequisite chains, and stateless workload/semester
previews remain available to the guest demo. Their previews use submitted course IDs
and do not read a stored student's records. No migration or app restart is required.

Tests run against real PostgreSQL and cover session ownership, elective claims,
plans, mandatory prerequisites, transitive cascades, idempotence, metadata
preservation, and rejected writes. Existing service tests also cover cycles and
concurrent mutations.

## Browser import action

Archived data is validated with the shared import schema before it becomes importable.
Malformed data remains on disk and does not prevent normal account hydration. Existing
archives are never overwritten by a newer cache. Guest data is never imported.

The action posts only the archived completed/planned selections under the current
cookie session. It pauses editing without optimistically applying the archive, then
reconciles the full confirmed server snapshot. Successful imports clear the archive
best-effort; a storage cleanup failure cannot turn a confirmed save into an error.
Failures retain the archive and reload saved progress before another edit. If recovery
also fails, editing remains blocked until reload succeeds. Account switches invalidate
late responses and archive cleanup, including leaving and returning to the same account.

The next UI increment adds course/claim review and explicit Import/Later controls.
