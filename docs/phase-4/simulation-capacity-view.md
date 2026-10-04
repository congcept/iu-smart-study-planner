# Simulation capacity view

The ADMIN-only resource screen now compares current planned selections with explicit declared
course seats. It reads one validated `/api/admin/capacity` snapshot; counts, capacities, exclusions
and resource revision are never assembled from separate demand/resource requests.

## Interpretation

The four-column table shows each unique current member course, students planned, declared seats
and selections above the limit. It includes zero-count courses. Zero capacity means no declared
seats; null capacity or excess displays `Unknown`. The UI does not recompute either projection.
The term identifies a resource scenario; current saved intentions are not filtered by that term.

The classroom proxy appears once, with its raw factors and one-simultaneous-section-per-room
basis. It is not course or semester supply. Labs and professors are not converted to seats.
Removed-member selections and overrides are explicitly excluded. Full demand, eligibility,
offerings, utilization, allocation and recommendation changes remain unvalidated.

## Session, scope and recovery

A fresh cookie session must confirm the expected owner and ADMIN role before the private read.
Strict schema and nested scenario validation precede rendering. Account, scenario and confirmed
resource revision remount the report; request generations reject stale replies. Loading/error
withholds previous data and provides explicit reload. A differing saved revision explains the
separate form reload and warns that it replaces unsaved edits.

Report reloads perform reads only. Existing resource drafts, locked uncertain-save recovery and
exact retry bytes are unchanged. Confirmed saves refetch the report without replaying a POST.

## Interface and verification

This extends the inherited admin form: light page, white resource form, blue primary save action,
flat comparison section and standard semantic table. At narrow widths the table retains readable
columns in an explicitly labeled, focusable horizontal region, with visible keyboard focus and
scroll instructions. The page itself does not overflow. No broader visual redesign is included.

44 panel cases and three parent/child integration cases cover missing/zero/positive capacities,
proxy/exclusion copy, strict validation, stale owner/scope responses, resource draft and uncertain
save preservation. The exact isolated source passes build, typecheck, zero-warning lint,
1035 server tests and 992 client tests.

Independent source review found no blocker. A fresh finish reviewer inspected all six responsive
captures and returned `disposition: ship`; the detector reported no findings. Existing untracked
PRODUCT.md documentation drift remains outside this increment and was preserved.

Live browser checks used disposable simulated accounts/context on separate ports. Reload preserved
a professor draft, save confirmed revision 2, and a subsequent PLANNED-to-COMPLETED fixture change
reduced a course count from two to one without altering resources. Desktop, 390px mobile, 320px
narrow and 640px CSS reflow were inspected; keyboard scrolling exposed the remaining columns.
640px is a reflow check, not a claim of actual browser zoom testing. Fixtures, verification servers
and the temporary tab were removed; the user's running app and unrelated edits were preserved.

Next, establish explicit shared section/time and staff assumptions plus complete eligible cohort
demand before configurable scoring and scarcity allocation. Curriculum activation and assignment
remain gated on verified source/elective rules.
