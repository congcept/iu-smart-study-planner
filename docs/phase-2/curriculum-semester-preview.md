# Selected-course semester reference preview

`POST /api/recommendations/plan-semester` now uses optional cookie authentication.
The strict shared request schema accepts `intensityMode` and optional legacy
`completedCourseIds`. A supplied invalid/deleted session returns 401; it never becomes
an anonymous request. Unknown account/context override fields return 400.

For an assigned account, stored curriculum, records, numeric attempts and rating prior
are read in one repeatable-read snapshot. Client completion IDs are ignored in this
branch. The preview includes only member courses explicitly marked `PLANNED`; completed
courses unlock prerequisites, while `IN_PROGRESS` does not. Historical nonmember plans
are listed as ignored, without rewriting them. Empty selections or contexts produce an
empty reference preview, not a completed degree.

Courses may occupy only their own valid reference academic year/semester placements.
Repeated placements can supply another opportunity but never duplicate a course. The
member GPA policy removes opposite Y4S2 placements while preserving earlier appearances.
All contextual prerequisite flags are mandatory. Parents scheduled in earlier slots can
unlock children; courses chosen in the same slot cannot. The preview does not expand
selections, add missing parents, cycle the CS calendar or create calendar dates.

The existing intensity credit caps and reference-slot bounds live in a shared server
configuration. Physical training counts toward planned credits. Deterministic ranking
uses Bayesian difficulty, credits and feasible selected downstream placements; unrelated,
excluded, oversized or impossible downstream choices cannot supply an unlock bonus.
This heuristic does not optimize competition between all prerequisites or allocate
school resources. The actual selection always checks prerequisites and the credit cap.

Unscheduled selections report missing placements, excluded GPA choices, oversized
courses, reference-slot limits, prerequisite cycles, unmet parents or no remaining
placement after constraints. Cycle diagnostics use memoized traversal. Selected/scheduled
course and credit totals describe only the chosen courses.

Scope is `REFERENCE_ONLY`, with `planningBasis: SELECTED_COURSES`. Elective requirements,
offerings and calendar dates are explicitly unvalidated; free-elective requirements
remain visible unchanged. Degree remaining credits, semesters to completion and graduation
date remain null even when every selected course fits. These fields cannot certify a degree.

Guest/unassigned requests retain the existing legacy response and body completion behavior.
Their course/rating input is resolved in the same transaction as account context, avoiding
a split scope/catalog snapshot. Legacy intensity behavior is unchanged.

Twenty pure policy cases and fourteen PostgreSQL API cases cover these guarantees, with
existing planner/rating/access regressions. Independent review found no blocking issue;
its impossible-parent ranking finding was repaired and added to the regression matrix.
No record, saved plan, assignment or seed mutation is performed by this endpoint.

Client context DTO handling, curriculum-aware rendering and assignment remain separate
gates. A full degree schedule requires verified elective rules, curriculum totals and
offering/resource constraints; this preview does not complete those roadmap phases.
