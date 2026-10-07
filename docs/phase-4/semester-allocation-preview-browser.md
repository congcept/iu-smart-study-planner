# Browser semester simulation preview

The existing school-admin resource screen now includes a separate read-only semester allocation
preview for the confirmed curriculum/semester/year. It shows the configured reference target,
assigned/remaining credit totals, distinct assigned students, course assignment count, rounds,
five stop reasons and the persistent shared course-section ledger. Several assignments may
belong to one student. Every count and credit comes from the strict public preview contract.
Optional course labels come from the already loaded reference and are labeled separately;
missing labels use the course identifier. No additional course lookup invents snapshot labels.

Mounting a confirmed scenario issues one GET. Reload is explicit; no polling, capture, progress,
resource or browser-storage write occurs. Fresh ADMIN/account checks before and after successful
or failed requests, owner/scenario/resource-revision keyed remounts and generation guards prevent
stale success, errors or final-auth responses from exposing evidence for another account or
scenario. The response must match the exact requested scope and excludes participant data.
Loading hides old evidence and overlapping reads are blocked. Errors offer a clear reload.

Missing resources, configured zero capacity, empty cohorts/catalogs and different saved resource
revisions have distinct messages. Reload preserves unsaved resource fields and receipt journals;
a confirmed resource revision refreshes the preview. The keyboard-focusable table scrolls on
phones without widening the page. The incumbent Button, heading, border and definition rows
are reused; no visual system or unrelated interface is changed.

Targets remain configured references, not verified student requests or graduation estimates.
All mandatory earlier prerequisites and numeric GPA filtering apply before allocation; choosing
a prerequisite never unlocks another course in the same semester. Official offerings, eligibility,
registration, timetable, staff/lab and category/grade-fit/timeline personalization stay unverified.
The preview panel saves no assignments or academic plans. A separate explicit capture/recovery
control is described in semester-allocation-capture-browser.md. Protected student result
discovery remains a following increment.
