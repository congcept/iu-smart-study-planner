# Curriculum-aware profile and record reads

Owner/admin profile and record reads now resolve the requested account's stored context
in a repeatable-read snapshot. UUID-shaped identifiers retain primary-key precedence,
and owner access guards normalize UUID casing before comparison and downstream queries.
Non-UUID student-ID aliases remain case-sensitive. Public-user selection excludes password
fields.

For assigned accounts, `GET /api/users/:id` returns current member records in
`studentRecords` and nonmember records in `historicalRecords`. The active course metadata
comes from curriculum placements and priors, without global category, group, slot or
prerequisite fallback. History exposes basic course identity and preserves the stored
status, legacy letter grade, grade points, elective claim and dates. Reads never rewrite
records. An empty context has no active courses.

Profile statistics count active recorded rows; this count is not a degree denominator.
Earned credits exclude physical training. Numeric `gpa100`, highest-retake course scores,
coverage and the decimal-exact GPA path use current member attempts. No letter-grade
conversion is inferred; nonfork curricula have a null path. Assigned profiles omit the
old `gpa` statistic so the 0–100 score is not mislabeled as a 4-point average.

Active saved study plans retain their exact cached course JSON and totals, even if a
historical selection is outside the current membership. Scope explicitly declares
`studyPlansValidated: false`. These reads do not recalculate, validate or adopt a saved
plan as a current contextual schedule. JSON remains `unknown` in the shared cached-plan
DTO, and dates use ISO strings.

`GET /api/users/:id/records` returns assigned data as
`{ records, historicalRecords, scope }`, with envelope `count` counting active records.
The profile and record scopes expose the requested owner's context and rating prior,
including when an administrator reads another account. Unassigned accounts retain the
legacy profile statistic and record-array shapes, including global prerequisite relations.

Twelve PostgreSQL cases cover context isolation, historical claims, numeric GPA and exact
boundaries, physical/zero-credit exclusions, priors, privacy, cached plans, empty contexts,
aliases, access guards and legacy compatibility. They pass alongside progress-summary and
access regressions (41 focused cases). Independent review found no blocking issue.

No assignment API or client activation is introduced. Current client profile types expect
legacy shapes; contextual hydration and rendering remain required before assignment.
