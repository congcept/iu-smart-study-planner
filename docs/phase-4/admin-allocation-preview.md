# Aggregate admin allocation preview

`GET /api/admin/allocation-preview?curriculumId=<uuid>&semester=FALL&year=2026`
requires the current database ADMIN role. The strict scope accepts only curriculum,
semester and year; callers cannot override students, choices, weights or resources.
This is a read-only simulation of one course per student in one allocation round.
It does not create a registration job, save assignments or edit student progress.

## Source and policy consistency

The reader captures the recommendation, resource-envelope and allocation policies
before its first awaited read. Current role, curriculum metadata, assigned STUDENT
cohort, progress, numeric grade history, ratings and resource configuration share
one RepeatableRead database transaction. Existing public demand readers retain
their aggregate response contract.

Eligible demand and private choices are derived together from the same union of
eligible PLANNED and reference-recommended courses. All context prerequisites are
mandatory. Completion, membership, placement and numeric GPA path rules apply;
an unresolved GPA defers final-semester fork-only placements. Empty contexts never
fall back to the global catalog. Students without choices remain in the roster.
The requested term identifies a resource scenario; offerings and calendars remain
unverified.

After closing the transaction, the pure allocator runs over captured inputs. Its
student utility is explicitly `(5 - BayesianDifficulty) / 4`, with the context's
current Bayesian estimates. It does not infer category, grade-fit or graduation
timeline metadata. GPA affects eligibility, while grade-fit personalization remains
unavailable. The configured resource/fairness weights and scarcity/congestion
behavior come from the existing pure allocation foundation.

The synchronous preview rejects more than 500 students, 100 choices per student or
10,000 total choices with an identity-free 409. It never truncates demand. These are
preview-only limits; existing demand readers and the pure allocator keep their
previous contracts. Larger cohorts need the planned background-job path.

## Aggregate contract

The strict `AllocationPreviewSchema` carries the coherent source snapshot,
allocation policy, assigned count, section count and separate unresolved counts:
no eligible choices, missing resources or exhausted capacity. These outcomes
partition the entire cohort. Missing resources differ from configured zero
capacity. Every member course appears once, including zero-demand rows.

Course rows show eligible demand, simulated assigned students, opened sections,
actual opened seat capacity and assigned-seat utilization. A course without an
opened section has null utilization. This ratio is assigned seats divided by its
opened seats, not the source diagnostic's unvalidated demand/supply utilization.
No shared ceiling is copied into each course's capacity. Course totals must match
the aggregate within the shared classroom/staff envelope.

Student IDs, private choices, individual outcomes and scores, emails, grade
history, elective claims and audit fields stay inside the server. The endpoint
returns no persisted assignments. Eligibility, timetable and allocation validation
remain false, and the response states its difficulty-only utility basis. Labs,
per-course overrides, staff qualifications, cross-curriculum capacity and calendars
remain unmodeled as declared by the resource envelope.

## Verification and next increment

Pure contract tests cover exact union choices, mandatory prerequisites, highest
retakes and the exact GPA threshold, difficulty estimates, privacy, missing/zero
resources, zero-demand rows, scope/cohort reconciliation and arithmetic corruption.
Real PostgreSQL API tests verify cookie/current-role access, strict scopes, privacy,
unchanged academic/resource evidence, shared-seat exhaustion, empty contexts,
corrupt stored state, preview limits, all three policy captures and a committed
concurrent writer while retaining the original production snapshot.

Next: adopt this runtime-validated aggregate in the admin dashboard with scoped
loading/retry and stale-response protection. Then extend supported utility metadata
and plan full-semester registration-window jobs and persistence. Phase 4 remains
incomplete; no verified curriculum activation or account assignment is implied.
