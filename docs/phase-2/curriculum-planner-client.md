# Curriculum Planner preview

The protected Planner now checks `/auth/me` before loading data. A fresh session must
match its route account and contain an explicit null or valid curriculum UUID.
Missing metadata from old caches is not evidence of an unassigned account. Loading or
failure withholds results and offers reload; no browser selection cache decides scope.

For an assigned account, the page reads only the cookie-authoritative semester preview.
It never loads the global catalog, legacy workload widget, or legacy recommendations.
The screen shows selected and scheduled counts/credits, reference year/semester slots,
course difficulty with actual vote counts, unscheduled reasons, ignored historical
selection counts, and unresolved free-elective requirements. Unknown/nonfork GPA paths
remain unrestricted without a manual GPA control. The preview is read-only and cannot
save plans or alter progress.

Intensity changes, reload, window focus, and visible-tab refresh recheck session scope
and clear prior results. Owner, intensity and request generations prevent stale success
or failure from restoring a previous account/context result, including A → B → A.
Overlapping refreshes share one pending request. Confirmed unassigned accounts retain
the existing saved-selection workload and read-only recommendation screen.

`CurriculumSemesterPreviewSchema` validates the runtime response before rendering. It
requires reference-only/unvalidated scope flags and null degree/graduation estimates,
valid course/placement identities, a consistent curriculum prior, unique selected and
scheduled references, matching placements, and consistent counts, credits and difficulty
totals. The API helper also rejects a reply for a different curriculum. Invalid or legacy
responses show retry instead of a global fallback.

Verification: 29 dashboard cases and 27 API-boundary cases, alongside the existing
Planner regressions. Build, typecheck, zero-warning lint, 701 PostgreSQL-backed server
tests and 366 client tests pass for an isolated source snapshot excluding unrelated
pending UI edits. A disposable assigned CS-reference account passed actual API schema
validation and desktop/mobile browser checks at 1440 × 1000 and 390 × 844. Both had no
horizontal overflow; the new select/reload controls were 44 pixels tall. Low intensity
changed the 10-credit thesis selection to an explicit credit-cap blocker. The temporary
account and listeners were removed; existing accounts, plans and the running app were
not changed. Subagents produced the UI/tests; the final review was inline after the
account usage limit prevented an independent review, and must not be described as one.

This increment does not enable account assignment or a major selector. The curriculum
map, progress/cache mutation flow, grade scope and remaining recommendation consumers
still require contextual hydration and rendering. Transfer validation for completions,
claims and cached plans remains a prerequisite for assignment. Reference slots are not
a timetable: elective rules, degree totals, offerings and calendar dates remain unverified.
