# Aggregate admin allocation preview

`GET /api/admin/allocation-preview?curriculumId=<uuid>&semester=FALL&year=2026`
requires the current database ADMIN role. The strict scope accepts only curriculum,
semester and year; callers cannot override students, choices, weights or resources.
This is a read-only simulation of one course per student in one allocation round.
It does not create a registration job, save assignments or edit student progress.

## Source and policy consistency

The reader captures recommendation, resource-envelope, allocation and utility
policies before its first awaited read. Current role, curriculum metadata, assigned STUDENT
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
student utility blends difficulty fit `(5 - BayesianDifficulty) / 4` and immediate
unlock fit `n / (n + 1)`. A distinct placed child counts only when completing the
candidate satisfies its sole remaining mandatory context prerequisite. Other parents
must be current-member COMPLETED records; IN_PROGRESS is insufficient. Completed,
in-progress, unplaced or GPA-ineligible children do not count. Unknown GPA defers
fork-only placements, and repeated placements/edges count once. Unlocks are immediate,
not transitive and not a prediction of graduation time.

The captured strict utility policy is returned as `utilityPolicy`, with basis
`BAYESIAN_DIFFICULTY_AND_IMMEDIATE_UNLOCKS_V1`. Deployment configuration defaults to
`ALLOCATION_DIFFICULTY_FIT_WEIGHT=0.70` and
`ALLOCATION_IMMEDIATE_UNLOCK_WEIGHT=0.30`; both normalized weights must sum to one.
Difficulty-only weights (1/0) reproduce the former utility. The eligible demand union
and reference recommendation policy are unchanged. Private unlock counts and student
scores remain internal. Category, grade-fit and graduation-timeline metadata are not
inferred; GPA still controls eligibility. The existing allocation policy combines
student utility, resource fit and scarcity/fairness.

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
remain false, and the response states its configured utility basis. Labs,
per-course overrides, staff qualifications, cross-curriculum capacity and calendars
remain unmodeled as declared by the resource envelope.

## Admin dashboard adoption

The ADMIN-only resource dashboard mounts the read-only allocation panel after a
confirmed scoped resource read. It shows cohort outcomes, per-course eligible demand,
opened sections/seats and assigned-seat utilization, with distinct missing/zero
resource states and honest simulation limits. Large-cohort limits, empty contexts,
loading, malformed data and authorization changes have retry/recovery copy.

The client validates the complete strict payload and exact normalized scope. Fresh
ADMIN identity checks precede fetching and publication. Account, scope and confirmed
resource revision changes invalidate in-flight results. Confirmed resource saves
refresh the preview; manual preview reload leaves unsaved resource fields and recovery
journals intact. A newer snapshot revision is reported without silently replacing the
resource form. The course comparison is a keyboard-focusable scrolling region on
narrow screens. No student identities, assignments or writes are exposed by this panel.

## Verification and next increment

Pure contract tests cover exact union choices, mandatory prerequisites, highest
retakes and the exact GPA threshold, difficulty estimates, privacy, missing/zero
resources, zero-demand rows, scope/cohort reconciliation and arithmetic corruption.
Real PostgreSQL API tests verify cookie/current-role access, strict scopes, privacy,
unchanged academic/resource evidence, shared-seat exhaustion, empty contexts,
corrupt stored state, preview limits, all four policy captures and a committed
concurrent writer while retaining the original production snapshot.

Forty-five client API/panel/integration regressions verify response corruption,
privacy, owner/scope/revision isolation, both session checks, retry/limit states and
resource-form recovery. Build/types/lint and all 1471 server / 1042 client tests pass.
Independent source/test review found no blocker; desktop/mobile visual checks confirm
readable wrapping and contained horizontal table scrolling.

Seventy-seven new server cases verify configured weight parsing, hand-calculated
utility, mandatory unlocks, status/context/GPA exclusions, unchanged academic evidence,
real allocation choice, corrupt policy and concurrent prerequisite writes. Five new
client cases reject incompatible/corrupt provenance and display configured weights.

Aggregate simulation-run capture/read persistence is now available; see
[run history](allocation-run-history.md). Next: client run capture/recovery and
history review, then registration-window jobs; category/grade-fit metadata and full-semester scheduling
remain separate gates. Phase 4 remains
incomplete; no verified curriculum activation or account assignment is implied.
