# Saved plan semester references

In the protected Planner, choose **View semesters** on an account-owned saved plan. The
semester view replaces the plan list and shows up to five stored semester labels, years,
credit totals and saved/updated timestamps. Rows are newest saved first, not an academic
sequence. Older/latest navigation, reload, empty, retry and unavailable-plan recovery are
read-only. Back to saved plans always performs a fresh metadata-list read.

These are historical references. Saved credit totals have not been checked against current
courses, curriculum, prerequisites, GPA or a timetable. Unusual historical integer values
remain visible rather than being silently converted. There is no save, edit, activation,
registration or progress mutation, and the browser does not display course JSON or difficulty.

## API and privacy

`GET /api/users/me/study-plans/:planId/semesters` accepts only an optional UUID `after` query.
The cookie determines the account. Even administrators cannot use this endpoint to inspect
another account's saved plan. Missing and nonowned plans share the same 404 response; missing,
deleted, foreign and different-plan continuation boundaries share the same 409 response.
Unknown query/body fields and malformed identifiers reject.

One RepeatableRead snapshot reads the live account/current curriculum scope, owned selected
plan metadata and semester count, owned continuation and at most six semester metadata rows.
Only five rows are projected; lookahead determines continuation. Ordering uses stored creation
time and ID descending. Current account scope is explicit with `studyPlansValidated: false`;
it does not retroactively give an older plan a curriculum identity. Plan metadata can change
between requests and is not treated as an immutable simulation receipt.

The query selects no semester course JSON, difficulty, grade records or other account data.
No migration, curriculum activation or database seed/reset is part of this feature.

## Client confirmation and recovery

The adapter validates strict shared schemas and checks the live account and expected
curriculum before and after successful or failed reads. Returned plan, account, curriculum,
cursor and older-row boundaries must match the request. Inputs are copied before awaits.
The child remounts for account/plan/context changes and rejects stale replies through abort
and generation guards. Pending/error states hide previous metadata. Back navigation stays
available while a detail read is pending and rechecks the newest list before rendering it.
Focus refresh invalidates selected details through the parent and returns through a fresh
list read. A selection from an older rendered page cannot override a newer pending reload.

The drafts received independent backend/schema review. Final integration and client review
were completed inline after subagents reached their usage limit; this is not represented as
an independent final review. Focused interaction/adapter cases and the complete quality gates
are recorded in AGENTS.md. Desktop/mobile geometry remains unverified because no browser
surface or automation package was available for this session.

Verified scheduling/saving requires a separate atomic prerequisite/GPA validation and
reference-slot/calendar design. The read-only references do not satisfy that gate.
