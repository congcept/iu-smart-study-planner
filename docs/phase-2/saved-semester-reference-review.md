# Saved semester reference review

In Planner, open a saved plan and semester using View courses. Choose a **Reference academic
year** within the degree and **Reference academic semester**, then select Review reference slot.
No slot is inferred from the stored calendar year. Changing either input immediately hides
and cancels old review evidence; retry performs a fresh read.

The read-only review checks each recognized saved course against the account's current
curriculum. It reports no current placement, no matching reference slot, exclusion by the
current numeric GPA path, an undetermined GPA fork, and unmet mandatory prerequisites.
Prerequisite counts describe missing recorded completions, not missing numeric grades.
All contextual prerequisite rows are mandatory, including recommended/corequisite flags.
Saved peers, other saved semesters and numeric scores alone never satisfy prerequisites.

Reference courses need a placement to be assessed. The GPA catalog and completed-parent
membership follow existing Grades/current-context readers: all CurriculumCourse members,
including members without placement rows, contribute their eligible grades/completions.
A bare member still cannot be assessed as a placed target. Courses outside the current
curriculum never contribute. Numeric GPA uses highest retakes, credit weighting, exact >70,
physical-training exclusions and no inferred conversions of letter grades. A nonfork
curriculum has no GPA path; matching year-4 semester-2 fork courses with no eligible numeric
GPA show an explicit blocker rather than silently allowing both paths.

No blockers means only that these particular reference checks found none. It does not
validate elective requirements, academic load, offerings, timetable, academic calendar,
original plan curriculum, or eligibility to save/register. No grade, completion, study plan,
JSON, assignment or curriculum activation is changed. Saving remains disabled in this view.

## API contract and consistency

POST `/api/users/me/study-plans/:planId/semesters/:semesterId/reference-review` accepts only
`expectedScope: {userId,curriculumId}`, a positive safe integer `academicYear` and an integer
`academicSemester` from 1–3. These are reference indices, not a university calendar. The cookie
is authoritative; admins also see only their own plans. Wrong account/context preconditions
return 409; missing/foreign plans and semesters share 404. Query overrides are rejected.

Owner, current curriculum, plan, semester, guarded saved JSON, labels, memberships, placements,
prerequisites, completions and numeric attempts share one RepeatableRead snapshot. The existing
100-entry / 65,536-byte JSON transfer guard and exact database numeric-position checks remain.
Those limits bound recognized saved-reference transfer, not total context/grade query cost or
endpoint memory. Unsupported/over-limit formats and unassigned contexts return explicit
unavailable reasons; a recognized empty array remains distinct.

The strict reply contains the owned snapshot, chosen reference slot, review entries in saved
order and permanently false calendar/original-curriculum/saving validation flags. Shared
cross-field checks reject missing/reordered evidence, contradictory membership/blockers,
invalid prerequisite counts, duplicate blockers and inconsistent GPA conditions.

The browser validates live session before and after successful or failed requests and rejects
mismatched owner/context/plan/semester/slot responses. A failed session check invalidates parent
labels too. Keyed remount, cancellation, generation and synchronous form-intent guards discard
late replies and batched stale submits. Review results are component-local; no cache or polling
is introduced. Parent focus/reload performs a fresh course read and drops review state.

## Verification and next integration

Real PostgreSQL regressions cover scope/ownership, exact numeric recognition, unavailable and
empty lists, all mandatory edges, saved-peer exclusion, membership/placement differences,
highest retakes/exact GPA boundaries and a committed writer during the production snapshot.
Client cases cover explicit inputs, error/retry, session loss, stale slots, unmount, malformed
responses and parent invalidation. Final quality evidence is recorded in AGENTS.md; browser
geometry is not claimed without a visual run.

This completes the read-only review contract. Atomic save enforcement must read and validate
again inside its write transaction; this mutable review cannot authorize a later save. A
separate contract is still needed for chronological earlier reference slots before saved
semesters can satisfy prerequisites. Do not infer that chronology from calendar labels.
