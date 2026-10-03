# Numeric grade fit in workload recommendations

The authenticated recommendation route reads the target account’s numeric GradeAttempt
history alongside completion records and the rated catalog in one RepeatableRead
transaction. Highest retake scores contribute once per course; physical training,
zero-credit courses and missing numeric scores contribute no evidence. History survives
removing completion, but only completion records unlock mandatory prerequisites.

A candidate receives a bounded preference from eligible history with the same existing
Course.category and a Bayesian difficulty distance within the configured tolerance:

`bonus = weight × (credit-weighted mean of highest scores) / 100`

Defaults: RECOMMENDATION_GRADE_FIT_WEIGHT=2 (0–20, zero disables) and
RECOMMENDATION_GRADE_DIFFICULTY_TOLERANCE=0.5 (0–4). Exact decimal difficulty
distances avoid excluding 2.2 vs 1.7 from a half-point band through binary rounding.
No four-point or letter grades are converted; stored legacy metadata is preserved.

Categories currently describe requirement types, not subjects. This is a transparent
preference policy, not a validated prediction of academic success. Verified subject
metadata and curriculum context remain later work. Required/core priorities, unlock
counts, credit/difficulty constraints and workload limits otherwise stay as before.

Hand example: 90×3 credits and 60×4 credits give mean 72.857142857 and bonus
1.457142857 at weight 2. A lower retake does not change it; a real zero for the
four-credit course lowers the bonus to 0.771428571.

Before activating the recommendations screen, separately apply the server GPA path
to its available-course set before ranking or credit budgeting. The curriculum map
already follows that path; this backend increment introduces numeric fit only.

Verification: 25 pure/config cases and nine real PostgreSQL recommendation-route cases
were added. Independent static review and complete build/typecheck/zero-warning lint
gates accompany 401 passing server and 234 passing client tests.
