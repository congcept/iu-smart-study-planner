# Recorded semester GPA

Grade read and append replies now include an optional `semesterGrades` summary beside the
existing `scope` and cumulative `summary`:

```ts
semesterGrades?: {
  terms: { year, semester, gpa100, gradedCredits, gradedCourseCount }[];
  undatedAttemptCount: number;
};
```

Fresh `GET` and `POST /api/users/me/grades` replies always include it, computed inside
`readStudentGradeSnapshot` from the same repeatable-read snapshot as scope, attempts and the
cumulative summary. The field is optional in the shared DTO so older persisted snapshots stay
readable; absence means "unavailable", never an empty or zero term list.

## Calculation

- A term exists only from an attempt's explicitly stored `year` **and** `semester`. Creation
  time and curriculum placement are never used to infer a term.
- Term evidence uses the same eligibility gates as the cumulative summary: current curriculum
  membership, a numeric score, positive credits, and exclusion of `PT001IU`/`PT002IU`.
  Excluded or nonmember attempts cannot create a term on their own.
- Each term takes the highest score per course within that term, so the same course may count
  once in every term it was attempted in. The lifetime cumulative GPA keeps its own single
  highest score per course.
- Term GPA is credit-weighted through the existing `calculateGradeSummary` Decimal path; no
  duplicate weighting math and no letter-grade conversion.
- `undatedAttemptCount` counts GPA-eligible numeric attempts missing `year` or `semester`
  (attempts, not unique courses). They never join a term but still count toward the cumulative
  GPA.
- Terms are ordered by ascending year, then shared/Prisma `Semester` declaration order
  (`FALL`, `SPRING`, `SUMMER`). This is a stable sort key, not an academic calendar.
- `summary.gpa100`, `summary.gpaPath`, credits, counts and `courseScores` are unchanged. No
  term-specific path or eligibility rule is introduced.

## Client

The strict `StudentSemesterGradesSchema` rejects malformed values: non-numeric or out-of-range
GPA, fractional/zero credits or counts, unknown semesters, invalid years, duplicate or
out-of-order terms, and extra keys. `readGrades` validates the field only when present and
rejects malformed data for both reads and append replies.

`SemesterGpa` renders below the score distribution inside the existing dashboard account/load/
error/save reconciliation, with no new cache, storage or fetch. It states the per-term highest
score rule and the cumulative distinction, labels terms as recorded metadata rather than an
official calendar, shows `Recorded terms` and `Scored attempts without a term`, and exposes a
keyboard-scrollable `Recorded semester GPA table`. Empty terms and unavailable legacy snapshots
are separate states, and GPA values use the dashboard's two-decimal format.

## Limits

These figures are reference-only. A term label is self-recorded and is not verified semester,
calendar, registration, offering or degree-planning evidence; cumulative GPA and the
thesis/alternative path remain the authoritative summary.

## Tests

Focused cases cover per-term highest versus lifetime highest, cross-term retakes, credit
weighting, PT/zero-credit and nonmember exclusion, partial dates, zero and fractional values,
deterministic ordering, empty terms, input immutability, adapter rejection, and dashboard
rendering/account/saved-snapshot integration. PostgreSQL API cases use a disposable database
and existing fixture cleanup.

The pinned Node 24.22.0 runtime passes the production build, all workspace typechecks,
zero-warning lint and `npm test`: 109 server suites / 2989 tests, 109 client suites / 2507
tests and 10 startup lifecycle cases. An independent review found no blockers, reporting 79
client and 44 pure server cases passing. The full `npm run format:check` command flags only
the unrelated ignored generated `.impeccable/hook.cache.json`;
`npm run format:check -- "!.impeccable/hook.cache.json"` passes.

Browser QA ran against an isolated backend on port 3015, client on 5185 and a disposable
database. Real demo sign-in reached the Grades empty state, then saving 84.125 for FALL 2025
displayed 84.13. Adding a 95 in SPRING 2026, a 60 in FALL 2025 and an undated 75 produced the
server values 86.42857142857143 cumulative, 73.78571428571429 for FALL 2025, 95 for SPRING
2026 and `undatedAttemptCount` 1. At 1280 × 1000 and 390 × 844 there was no horizontal page
overflow, the mobile term table scrolled within its own region, keyboard focus showed a solid
outline and ArrowRight advanced `scrollLeft` by 40, and full-page axe reported zero violations
at both sizes. Captures `/tmp/semester-gpa-desktop.png` and `/tmp/semester-gpa-mobile.png`
were inspected. The T3 preview snapshot timed out twice at 15 seconds, so the pass used an
isolated local Chromium fallback with temporary Playwright/axe packages under `/tmp`; no
repository dependency changed.
