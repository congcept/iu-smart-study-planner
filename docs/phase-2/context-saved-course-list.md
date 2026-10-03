# Current saved-course inspection

The contextual progress summary now displays current course code/name, saved status and
any elective claim in a compact list, sorted by code. Completed, in-progress and planned
rows come from the same validated private snapshot as counts. The outside-context historical
list stays separate. The list is read-only and adds no completion, assignment or degree
eligibility claim. It clears during reload and remounts across owner/context boundaries.

Two new component cases cover all three statuses, code sorting, elective claims, absence of
mutation controls and late responses during reload/account change. Build, types, zero-warning
lint, 721 server tests and 463 client tests pass on the exact isolated source snapshot.
Desktop/mobile checks at 1440 × 1000 and 390 × 844 showed the MA001IU Completed row in the
current list and IT058IU in history, with no horizontal overflow. Read-only inspection
preserved all fixture grade attempts and legacy records; temporary fixtures/listeners were
removed. Review was inline after the account usage limit.

Context-aware completion editing, cache isolation and pending mutation preconditions remain
required before account assignment. Full degree progress, signed IT/DS reconciliation and
required school-admin resources/allocation remain outstanding.
