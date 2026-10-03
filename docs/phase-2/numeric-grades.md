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
Retake storage is implemented; authenticated APIs are the next increment. The existing manual GPA-path
toggle is not yet driven by the new numeric summary, and legacy profile GPA remains on
its old scale until the grade dashboard is activated.

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
