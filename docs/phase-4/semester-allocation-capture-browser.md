# Browser semester simulation capture and recovery

The existing admin scenario includes an explicit semester capture control beside the read-only
semester preview. It saves the server-produced cohort simulation using saved resource settings.
Unsaved resource fields and their separate save journals are preserved. Only the last receipt
for this actor/curriculum/semester/year in this tab is shown; no semester history browser or
background job is introduced. The existing one-course capture, queue and history remain separate.

Before a POST, the panel checks the current cookie account is the exact ADMIN. It then verifies,
writes and reads back the strict versioned retry journal synchronously before sending. Both
successful and failed requests receive a fresh final account check. Account/scenario keyed
remounts and generation guards discard stale replies and errors. A lost response retains the
original request key; another POST occurs only on an explicit retry. Mount never resends a pending
capture. Confirmed receipts recover by the exact run ID with strict frozen V1 parsing and scope
checks. Starting another capture first re-verifies the previous receipt, then performs the same
separately guarded POST sequence.

Recovery checks the exact storage bytes observed before each asynchronous operation, including
noncanonical whitespace, as well as the normalized contents. Changed, invalid, unreadable,
unwritable or unconfirmed journals block replacement. Successful server capture with failed
receipt storage remains visible as a verified aggregate, but recovery is required before another
attempt with the retained key. Recovery never silently removes or overwrites an uncertain key.
Tab storage is a receipt cache, not a guarantee against browser deletion or closing a tab; keys
are private actor/scenario preconditions and no participant data is written to browser storage.

The historical aggregate displays distinct assigned students, course assignments, target/
assigned/remaining credits, rounds, all five stop reasons, timestamps, captured resource revision
and shared sections. It contains no participant identities, roster, choices, utility or other
students' individual results. Private outcomes are stored on the server; academic plans, progress,
grades and resource settings are unchanged. Targets remain reference budgets. Official
registration, eligibility, timetable, staff/lab availability and category/grade-fit/timeline
personalization remain unverified. No current course labels are presented as historical metadata.

The incumbent Button, section heading, border and definition rows are reused. Desktop, default
and phone views preserve clear reading order and a 44px control without page overflow. Fixture-
only browser adapters verified explicit lost-response retry without live application writes.
Sixty-one API/recovery/panel tests and three real-dashboard integration tests cover strict privacy/
math/identity validation, storage failures, exact-byte recovery, session barriers, stale account/
scenario replies and preservation of unsaved settings. Required full regression results and
publication are recorded in AGENTS.md. Protected own-result discovery and reading controls,
then separately versioned semester jobs, remain following increments.
