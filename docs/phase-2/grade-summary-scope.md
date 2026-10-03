# Grade summary scope

Grade read and immutable append replies now include `scope`: the cookie `userId`, stored
`curriculumId` (explicit null for an unassigned account), and `isGpaPath`. Scope and the
eligible summary are read in the same repeatable-read snapshot. A nonfork curriculum can
have a numeric GPA while its path remains null; unassigned accounts retain the legacy
fork policy. Body claims cannot assign a context or override this metadata.

The grade adapter validates present scope metadata, normalizes UUIDs, and rejects invalid
scope or a thesis/alternative path in a nonfork curriculum. Old persisted replies can
omit scope for compatibility; absence is not evidence of an unassigned account. The grade
dashboard rejects scoped reads/saved snapshots belonging to a different account. Assigned
summaries explain that current curriculum members contribute to GPA while other attempts
remain in history, and nonfork summaries explicitly state that no GPA thesis path applies.

Five new PostgreSQL cases cover current scope on read/append, numeric nonfork GPA, legacy
null context, changed context with unchanged attempts, and rejected body claims. Nine API
and seven dashboard cases cover metadata validation, historical attempt display, owner
recovery and saved-snapshot reconciliation. Build, typecheck, zero-warning lint, 706 server
tests and 382 client tests pass on an isolated source snapshot. Desktop/mobile browser
checks at 1440 × 1000 and 390 × 844 used a disposable nonfork reference/account: GPA was
90, both member retakes and the excluded historical 100 remained visible, and there was
no horizontal page overflow. Read-only inspection preserved all attempts and legacy
records; only those temporary fixtures/listeners were removed. Review was inline because
the account usage limit prevented further subagent review.

Account assignment remains gated. The subsequent scoped picker increment is recorded in
[grade-course-picker.md](grade-course-picker.md); its server already rejects new
nonmember/unplaced grades. Curriculum map rendering and its old GPA hook still require contextual/nonfork
handling; this metadata change does not enable a major selector or change existing scores.
