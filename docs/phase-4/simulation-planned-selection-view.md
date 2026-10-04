# Admin planned-selection view

The ADMIN-only resource screen at `/admin` now renders the read-only `/api/admin/demand`
report below resource entry. It shows every unique member course once, including zero-count
members, distinct cohort students and total selections. Completed courses and nonmember
selections are excluded from course counts; their exclusion is explicit.

## Evidence and scope

The labels preserve `SIMULATION` / `REFERENCE_ONLY` and current PLANNED selection semantics.
Semester/year selects the scenario, not a filter on undated intentions. Supply, utilization,
recommendation demand, eligibility and official offerings remain unvalidated. Empty cohorts,
empty selection sets and empty references have specific messages without catalog fallback.

Every load first confirms the cookie owner still has ADMIN role. The strict shared response
schema and exact requested scope must pass before any counts appear. Account, curriculum,
term or confirmed resource revision changes remount the report; request generations suppress
stale replies, including StrictMode cleanup and A–B–A transitions.

## Form boundary

“Reload planned selections” clears only the count report and issues private reads. It does not
reload resource form values, write browser journals, clear an unconfirmed save or issue a POST.
A report revision mismatch asks the admin to explicitly reload saved settings and warns that
this replaces unsaved edits. A confirmed resource save remounts/refetches counts; a lost save
retains its original immutable request and locked fields.

## Interface convention

The report is a separate read-only section below the resource form. Its semantic two-column
table keeps course names wrapped and counts right-aligned with tabular numerals. The independent
reload control follows existing typography, palette, spacing and buttons; no design-system change
is introduced.

## Verification

35 panel tests cover authorization, strict reports, scope/revision transitions, loading/error
recovery, empty cohorts and stale responses. Three actual parent/child integration tests cover
unsaved form preservation, byte-identical lost-save journals and confirmed-save refetch without
another POST. The full isolated snapshot passes build, types, zero-warning lint, 973 PostgreSQL
server tests and 954 client tests.

Desktop (1280×900) and mobile (390×844) browser verification used disposable simulated accounts,
curriculum and selections on isolated ports. Count reload preserved a professor draft; UI save
produced exactly revision 2; completing one fixture course reduced three selections to two while
resource revision/settings remained unchanged. Fixtures and listeners were removed afterward.
No production account assignment, migration, seed/reset or curriculum activation was performed.

Independent source and fresh visual finish reviews found no blocking issue (disposition: ship).
A fresh general agent fulfilled the shipped reviewer role because no specialized agent selector
was available. The detector reported no findings. Existing PRODUCT/context drift was reported
without changing unrelated design records.
