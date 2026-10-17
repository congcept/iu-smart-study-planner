# Saved reference course selection editing

In Planner, open a saved plan and semester, select View courses, then Edit saved course
selection. Choose an academic year/semester explicitly, remove/add courses from current
curriculum choices, and select Save course selection. Existing order is retained; additions
follow it. Empty lists are allowed. Calendar labels and plan activation are unchanged.

This saves a reference selection, not a registration or verified degree/calendar plan. Every
selected course must have a matching placement. The save checks every contextual prerequisite
against current member COMPLETED records, including recommended/corequisite rows. Grades,
saved peers and other saved semesters do not satisfy prerequisites. The exact numeric GPA
policy uses highest retakes, credit weighting and physical-training exclusion; null GPA blocks
applicable fork courses. Current member history includes bare memberships consistently with
Grades, while selected target courses need actual placements. Planned credits include PT.

## Atomic save and retry contract

GET/PUT `/api/users/me/study-plans/:planId/semesters/:semesterId/reference-selection` are
cookie-own, including administrators. GET returns one coherent snapshot, monotonic revision,
historical reference metadata and at most 1000 placed course choices. Larger catalogs fail
explicitly, without truncation. Unassigned contexts and unsupported/over-limit stored formats
remain read-only. The saved JSON reader's original transfer and precision guards remain.

The strict PUT body contains requestId, expected account/context and revision, explicit
reference indices and up to 100 distinct ordered normalized course IDs. Inside one Serializable
transaction, the server rechecks live ownership, current context and revision, evaluates the
proposed list using the same policy as reference review, recomputes credits/Bayesian difficulty,
compares-and-increments revision, and saves canonical JSON, reference metadata and an immutable
request receipt atomically. Serialization/key races have bounded retries; overflow/conflict
returns 409. No completion, grade, curriculum assignment or activation is written.

Receipts are unique per account/request key and bind the entire canonical input, target,
revision and result. Exact retries return the original acknowledgement before current context
and version checks; changed key input is rejected. Live ownership is checked before replay.
The acknowledgement describes the old save, never current state or eligibility. Corrupt
metadata/receipt evidence fails closed. Deleting the user/semester also deletes its receipts.

The additive migration gives existing semesters revision 0 and null reference metadata,
then adds the receipt table. Metadata records only the last reference save's context, explicit
slot, policy, revision and check time; it never reconstructs the original plan curriculum.
Accepted legacy updates advance revision and clear reference metadata; empty patches remain
rejected without changes. Legacy deletion now rechecks live authorization and plan/semester pairing in the transaction; the
existing middleware already checked the pairing before this transaction-time hardening.

## Browser recovery and limits

Session confirmation before and after reads/writes includes failed HTTP responses. Lost
confirmation hides parent course evidence. Account/context/plan/semester remounts, cancellation,
generation, busy and synchronous draft-intent guards reject stale handlers and replies.

Before sending, a strict tab-scoped journal binds the immutable request to account, plan and
semester. Invalid or inaccessible storage blocks new sends. A lost reply retains the same
request ID and payload for explicit retry; no automatic replay occurs. Confirmed responses or
definitive conflict/validation responses require a fresh scoped GET before unlocking. An
accepted save's fresh read must reach at least its acknowledged revision before recovery data
can clear. A receipt never replaces a newer displayed selection. Returning under a different
current curriculum can recover the same account's original acknowledgement without rebinding
the old request; absent receipts still enforce the original expected context.

Unsent drafts are view-local: focus refresh, tab/window changes or reload can discard them;
the UI explains this. Sent requests remain recoverable in that tab. Empty/oversized/unsupported
states, stale conflicts and uncertain outcomes are explicit. There is no polling, autosave,
reordering UI, calendar editing or automatic advancement of degree requirements.

## Verification and next steps

Tests cover atomic rollback, two-writer conflicts, identical retries, later edits/context
changes, malformed evidence, ownership, all prerequisite flags, GPA and legacy invalidation.
Client cases cover recovery binding, denied storage, stale inputs, session failures, lower
post-save revisions and parent refresh. Exact quality evidence is in AGENTS.md. No browser
geometry pass is claimed without a real visual run.

Next improve per-proposed-course blocker feedback and restore unsent drafts through explicit
revision-bound review. Reference metadata does not establish continuing eligibility: later
record/GPA/context changes require fresh checks. Chronological earlier-slot planning and
verified curriculum, degree, timetable and capacity gates remain separate.
