# Admin semester request history browser

The admin dashboard shows a separate read-only request history for its confirmed curriculum,
semester and year. Up to five original queued receipts and coherent outcomes are shown,
newest queued first. Explicit older-page continuation retains its last confirmed queued
receipt. Reload starts from the latest page; empty latest and exhausted older pages differ.

Browser GET adapters validate copied inputs, exact scenario/boundary and strict private-free
responses. Fresh current cookie ADMIN checks precede and follow both successful and failed
reads. A local expected owner is a precondition, not server authority. Queue timestamp
precision and UUID ordering are checked before publishing older pages.

Checking a selected request separately confirms its whole original immutable receipt and
then its outcome. A pending outcome may advance; a previously confirmed terminal outcome
cannot change or regress. Exact confirmation updates the matching page row so pending and
completed results are not shown for the same request. Historical failure copy describes
conditions when execution was attempted, not present administrator/scenario availability.

Owner/scenario remounts and generation, busy and render-intent guards reject stale handlers
and replies. All IDs/results disappear while a read is pending or fails. Private refs retain
the exact failed page or selection for explicit retry. Confirmed terminal observations are
bounded to the last confirmed page. Session invalidation masks/remounts history while
unrelated resource revisions/transport failures preserve dirty forms appropriately.

History never queues or executes a job, writes browser storage, polls, refreshes on focus,
or changes academic records. Outcomes reflect their last explicit check. Simulations remain
references; this screen does not verify registration, calendar/staff/lab or official curricula.

Tests cover privacy, strict echoes and ordering, account/role/scenario switches, stale replies
and handlers, mutated mock inputs, exact recovery, irreversible terminal metadata, parent
masking and dirty-form preservation. Final isolated build/types/zero-warning lint and all
1910 client tests pass; the identical server/shared history API passed 2658 real PostgreSQL
tests. Independent source/test review approved the corrected final behavior.

Desktop 1280 and mobile 390 fixture checks confirm no horizontal overflow and 44px controls.
Lost replies hide evidence, same-request retry updates the page and focuses the selected
heading, and older paging remains usable. Fixture reads use simulated review data and never
capture or execute live jobs. The dated AGENTS checkpoint records publication/runtime limits.
