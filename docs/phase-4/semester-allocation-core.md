# Semester credit-budget simulation core

`allocateSimulationSemester` is a separate pure model. It accepts the existing simulation
resource envelope and allocation policy, a unique course catalog with supplied planning
credits, and students with supplied eligible choices, normalized utilities and credit
targets. It does not replace the pinned one-course V1 preview, worker or saved captures.
No route, job, database write or startup worker invokes the new model in this increment.

Inputs are strict and normalized. Supported bounds are 10,000 catalog courses, 500 students,
100 choices per student and 10,000 total choices. Course credits are whole numbers from zero through ten and student
targets are whole numbers from zero through thirty. These are supported simulation limits,
not official curriculum policy. Duplicate catalog/student/choice IDs and unknown course
references reject before allocation. Planning credits are supplied explicitly; completed
credit exclusions, including physical training, are not inferred here.
Unused catalog courses are allowed and remain in the final ledger with zero demand and
assignment counts.

Each round allows at most one course for each active student. After every assignment, the
allocator recomputes choices that fit remaining credits and current seat capacity. Scarcity
orders students before course ranking; ties use fewer already assigned credits and then
canonical student UUID. The existing utility/resource-fit/fairness weights and congestion
rule rank feasible choices, with canonical course UUID breaking score ties. Original
unique-student course demand remains the congestion denominator's numerator.
That demand counts every supplied choice, including choices that do not fit an individual's
target or belong to a target-zero student. It is a fixed simulation demand basis, not a
prediction of actual registrations. Stop-reason precedence is target reached, no choices,
no credit-fitting choice, unknown resources, then exhausted capacity.

One shared section and course-seat ledger persists across every round. Existing seats remain
usable when no more sections can open; newly opened sections consume the same shared
ceiling throughout the call. A course cannot repeat for a student, assigned credits cannot
exceed the target, and zero-credit choices still terminate because the eligible set is
finite. A reached target, including zero, stops further assignments.

Eligibility is frozen to supplied choices. Assigning a prerequisite never unlocks another
course in the same simulated semester. Unlock utility can influence ranking only. The
caller must supply choices validated against earlier completed prerequisites and current
curriculum/GPA rules before any later integration can claim eligibility validation.

Results retain internal per-student course and credit outcomes, score components and shared
course/section totals. Stop reasons distinguish reached targets, exhausted choices, credit
fit gaps, unknown resources and exhausted capacity. Assigned course count and distinct
assigned student count are separate. Strict contracts validate supplied-choice membership,
unique pairs, round barriers, credits, score arithmetic and shared capacity accounting.
The output is `INTERNAL_REFERENCE_ONLY`; eligibility, allocation and timetable validation
are false and `persisted` is false. It is a greedy simulation, not an optimal packing or
verified semester schedule. Internal student IDs must never be returned through existing
public aggregate history contracts.

Candidate scanning is quadratic in the worst case. Input bounds and fixture timings do not
guarantee completion inside the current worker's fifteen-second transaction limit. A later
increment must define separately versioned private per-student persistence, pinned replay
validation and explicit execution/read contracts before connecting this model to jobs.
Verified calendar, course/category/grade-fit, staff/lab metadata and deployment remain open.

On 2026-10-06, isolated production output allocated all 10,000 zero-credit choices for
500 students with twenty choices each in 2,707 ms and for 100 students with 100 choices each
in 3,056 ms. Both fixtures used a positive target, packed one retained section per course
and included strict result replay validation. These are two local measurements, not a
performance guarantee or evidence of database-worker integration.
