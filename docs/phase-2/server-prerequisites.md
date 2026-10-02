# Server prerequisite validation: first slice

Both existing record mutations (`POST /api/users/:id/records` and
`POST /api/users/:id/records/toggle`) now validate completion and cascade
uncompletion in a serializable PostgreSQL transaction.

- Every prerequisite must be completed by the same student. This includes
  recommended and corequisite rows, following the confirmed mandatory policy.
- Missing prerequisites return HTTP 409 with their IDs, codes, and names in
  `details`. No records change on rejection.
- Changing a course away from completed removes all completed transitive
  dependents, including paths through incomplete courses. Cycles are safe;
  independent courses and other students' records stay intact.
- Successful responses include `details.uncompletedCourseIds` for reconciliation.
  The legacy toggle still removes the initiating record when sent `PLANNED`;
  repeating that removal succeeds. The regular record endpoint stores its status.
- Concurrent completion and uncompletion cannot leave an invalid completion.
  Serialization conflicts are retried twice, then return HTTP 409.

Regression tests use real PostgreSQL, create isolated student/course fixtures,
and remove those fixtures afterward. Run:

```bash
npm run test --workspace=server -- studentRecords.test.ts --runInBand
```

This slice does not finish Phase 2. Cookie authentication and browser account
screens and [current-student progress APIs](current-student-progress.md) are implemented;
browser progress synchronization is implemented. Bulk import and legacy read access
hardening remain pending. Anonymous demo progress stays local.
