# Numeric grades and retakes

The user confirmed actual 0–100 course scores on 2026-10-03. This supersedes the
master prompt's letter-to-four-point conversion for new grade entry. Existing legacy
letter grades and gradePoints remain intact; numeric scores are never inferred from them.

The pure calculator selects the highest numeric score for each course, counts its
credits once, and computes sum(score × credits) / sum(graded credits). PT001IU/PT002IU
and zero-credit courses are excluded. Zero is a real score; null is ungraded. No graded
credits returns null rather than zero. Precision is preserved so display rounding cannot
change eligibility at 70. Unknown courses and invalid scores/credits are rejected.

Twenty-one calculator tests cover hand-computed weighted retakes and boundary cases.
Retake storage and authenticated numeric grade APIs are implemented. The existing manual GPA-path
toggle is not yet driven by the new numeric summary, and legacy profile GPA remains on
its old scale for compatibility. The protected Grades dashboard displays the new 100-point summary.

## Retake storage

GradeAttempt rows link directly to the account and Course, so prerequisite uncompletion
does not erase history when it deletes a StudentRecord. Each row stores an actual numeric
score, optional semester/year, and an immutable account-scoped request UUID. Retrying the
same payload returns the original attempt; reusing a key with different data returns 409.
Database constraints reject nonfinite/out-of-range scores and invalid years.

The additive migration creates only the new table, indexes and foreign keys. It does
not backfill numeric scores or change legacy completion, claims, gradePoints or grades.
Apply with prisma migrate deploy, then regenerate Prisma in the host and Docker backend.
Twenty-three real PostgreSQL tests cover constraints, concurrent retries, isolation,
metadata preservation, and history surviving uncompletion. No seed reset is required.

## Current-account grade APIs

GET /api/users/me/grades returns rich attempt history, the unrounded numeric summary,
and completedCoursesWithoutNumericGrades for GPA-eligible completed courses missing
numeric coverage. Reads use one repeatable-read snapshot; legacy letters never become
zero or guessed percentages. POST on the same path accepts only courseId, requestId,
score, optional semester and year. UUIDs normalize to lowercase, score is finite0–100,
and year is 2000–2100. A success returns the full current-account grade snapshot.

Ownership comes from the cookie. Unknown courses return404, conflicting retry payloads
409, and malformed/extra fields400. Attempts may record failed scores without completing
a course; progress still requires mandatory prerequisites through the completion API.
Grade writes do not change completion, elective claims or legacy grade metadata.

Thirty-eight PostgreSQL API tests cover strict inputs, account isolation, role/session
access, request-origin protection, retries, GPA/coverage and preservation. The running
Docker API also passed a simulated40→90 retake and70 in a second course: weighted GPA
81.42857142857143, three immutable attempts, and identical progress before/after.
Automatic GPA-path activation remains a separate increment.

## Grades dashboard

Signed-in students and administrators can open /grades from the header. It displays the
server-calculated 100-point GPA, included courses/credits, missing numeric coverage, and
every retake with its highest score marked. Null GPA is distinct from a real zero.
Loading and retry states are explicit; late responses cannot expose another account’s
history. The narrow-screen table scrolls inside a keyboard-focusable named region.

Seventeen client adapter, dashboard and routing tests cover these behaviors. Desktop
1440px and mobile 390px browser checks confirmed a contained table and no page overflow.

## Grade entry

The Grades page records actual 0–100 course scores and optional semester/year metadata.
The current catalog is the seeded CS course list; curriculum-aware selection remains
part of the deferred multi-curriculum work. Each save keeps a request in account-scoped
sessionStorage before POST. This tab can reconcile it after navigation or refresh.
A lost response triggers a history read: an identical saved request confirms success;
absence offers the same immutable retry key, while failed reads keep editing blocked.
A read showing absence cannot prove an earlier request has stopped, so ambiguous
requests cannot be discarded. Definitive validation/auth/not-found rejections unlock
the form. Closing the browser tab discards sessionStorage; recovery across devices or
closed tabs is not implemented. No completion or legacy grade metadata changes.

Eighteen client tests cover zero/decimals, input boundaries, full dashboard reconciliation,
double submits, lost responses, stable retries, blocked recovery, refresh, stale owners,
corrupt/unavailable storage and catalog failures. Build, typecheck, zero-warning lint and
209 server/143 client tests passed. A live simulated 95-point Calculus retake produced
84.28571428571429 GPA, retained all previous attempts, and displayed the optional term.
Desktop/mobile checks found no horizontal page overflow and 44px form controls.
