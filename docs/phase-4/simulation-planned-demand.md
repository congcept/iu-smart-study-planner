# Simulation planned-selection snapshot

`GET /api/admin/demand` is an ADMIN-only, read-only snapshot for the same strict curriculum,
semester and year query used by resource settings. It returns partial planning evidence rather
than complete enrollment demand. `kind: SIMULATION` and `usage: REFERENCE_ONLY` stay explicit.

## Count basis

The cohort contains current STUDENT accounts whose stored curriculum matches the requested
reference. Admin accounts, unassigned students and other curricula are excluded. Each current
member course appears once, including unplaced members and members with zero selections;
multiple reference placements never multiply counts.

`plannedStudentCount` on each course counts cohort students with that course currently PLANNED.
At the root, it counts distinct students with at least one member selection. `plannedSelectionCount`
is the sum of those course counts, not a distinct student count. Nonmember selections are excluded
and reported only as `ignoredNonmemberSelectionCount`; no account IDs, student names, emails or
individual records are exposed.

`planningBasis: CURRENT_PLANNED_SELECTIONS` describes these saved intentions. It does not prove
prerequisite eligibility, scheduled placement, offering availability, or registration.
Recommendations are not persisted, so `recommendationDemandAvailable` is false. They are not
silently recomputed or counted as if already chosen.

## Scenario term and resources

`termBasis: SCENARIO_ONLY` means semester/year selects a resource scenario, not a filter on
student intentions. Current PLANNED records have nullable year and free-text semester; progress
operations clear those historical values. Changing a scenario term therefore changes the matching
resource revision, while current cohort intentions keep the same count basis.

`resourceRevision` is the matching saved revision, or null when no settings exist. Course `supply`
and `utilization` remain null even when settings are present. Verified lab classification and a
declared supply model are still required; this read cannot turn classroom inputs into validated
per-course availability.

## Consistency and contract

Current database admin authorization, curriculum metadata, membership, cohort, PLANNED rows and
resource revision share one RepeatableRead transaction. The service validates its stored projection;
the client adapter verifies the strict response and exact requested scope. Empty cohorts and
empty references remain explicit; there is no legacy catalog fallback. Duplicate identities,
contradictory totals and invented supply or recommendation evidence reject at the boundary.

No account assignment, progress, resource setting, plan, seed or allocation is written. This API
does not complete the phase-4 demand/supply gate. The next increments are an admin count view,
explicit simulated capacity assumptions, recommendation/cohort snapshots and scarcity allocation.
