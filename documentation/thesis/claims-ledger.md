# Thesis claims ledger

Every factual or numeric claim in `documentation/thesis/` must map to something a reader can check.
This file exists because the chapters had drifted four months behind the code: the abstract still
described a graph library the project had deleted, the conclusion listed authentication as missing,
and the results chapter reported performance figures for code that no longer existed.

Use it in both directions. When a claim changes, update the evidence column. When evidence changes,
grep the chapters for the claim.

**Status:** re-baselined 7 November 2026 against `main` at `9499445`.

## How to re-verify

```bash
# build the document
cd documentation/thesis && tectonic -X compile thesis.tex --keep-logs
grep -E "Output written" thesis.log          # page count
grep -iE "Reference .* undefined" thesis.log # must be empty

# current suite sizes
cd server && npx jest --listTests | wc -l
cd client && npx vitest list | wc -l
```

Counts drift with every increment. The chapter states a count, so re-run before submission.

**Last re-verified:** 8 November 2026 on `main` at `34c1776` — 115 server suites / 3,050 tests and
110 client files / 2,516 tests, both fully green. The chapter previously carried 3,001 over 110
suites, which had gone stale within a day of being written.

## Chapter 1 — Introduction

| Claim                                                                   | Evidence                                                                                       |
| ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Shared courses are placed per program, not globally                     | `server/prisma/schema.prisma` (`CurriculumPlacement`), `docs/phase-1/curriculum-foundation.md` |
| Prerequisite edges are program-scoped and never unioned across programs | `CurriculumPrerequisite`; `docs/phase-1/curriculum-context-reads.md`                           |
| The final year forks on a grade threshold                               | `server/src/services/gpaPath.ts`; `docs/phase-2/grades-gpa.md`                                 |
| Reference program, not a verified cohort                                | `docs/phase-1/cs-reference-backfill.md`; `docs/current-data-and-inputs-audit.md` §4A           |
| No deployment, no user study                                            | `docs/phase-5/deployment-readiness.md`; there is no study artefact                             |
| Open stability finding                                                  | `AGENTS.md` "Active Checkpoint — 2026-11-07"                                                   |

## Chapter 2 — Literature review

| Claim                                                                  | Evidence                                                                                                 |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Degree audit and planning systems assume institution-supplied rules    | External literature; `\cite{tam2019}`                                                                    |
| Prerequisite graphs are a planning structure, not a validity structure | `\cite{parhami2015}`, `\cite{wang2020}`                                                                  |
| Timetabling is distinguished from sequencing                           | `\cite{schaerf1999}`                                                                                     |
| Shrinkage is the empirical-Bayes remedy for sparse groups              | `\cite{gelman2013}`; `server/src/services/bayesianDifficulty.ts`                                         |
| Serializability and snapshot isolation                                 | `\cite{cahill2009}`, `\cite{kleppmann2017}`; `Prisma.TransactionIsolationLevel.Serializable` in services |
| Accessibility rules and automated detection limits                     | `\cite{wcag22}`, `\cite{axecore}`; `docs/ui-quality-pass.md`                                             |

## Chapter 3 — Methodology

| Claim                                                                                                                                    | Evidence                                                                                    |
| ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Five increments (foundation, context, grades, planning, administration)                                                                  | `AGENTS.md` phase tables; `docs/phase-1` … `docs/phase-4`                                   |
| Nineteen schema migrations applied additively                                                                                            | `server/prisma/migrations/` (one directory per migration)                                   |
| Twenty-three models, six enums                                                                                                           | `server/prisma/schema.prisma`                                                               |
| Reference source counts (9 slots, 72 rows, 71 coded placements, 56 unique courses, 15 repeats, 1 uncoded requirement, 3 elective groups) | `docs/phase-1/cs-reference-manifest.json` → `counts`                                        |
| Credit total is unknown, not zero                                                                                                        | `Curriculum.totalCredits` nullable; `docs/phase-1/cs-reference-backfill.md`                 |
| Import is verifier → preflight → idempotent `--apply`                                                                                    | `server/src/scripts/verifyCsReference.ts`, `inspectCsBackfill.ts`, `backfillCsReference.ts` |
| Server tests run on real PostgreSQL                                                                                                      | `server/jest.config.js`; no database mocking in `server/src/__tests__/`                     |
| One Ubuntu gate                                                                                                                          | `.github/workflows/ci.yml`; `docs/phase-5/continuous-integration.md`                        |

## Chapter 4 — Implementation

| Claim                                                                                             | Evidence                                                                                          |
| ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `httpOnly`, `SameSite=Lax`, `Secure` in production                                                | `server/src/services/authService.ts` (`cookieOptions`)                                            |
| Role and program context re-read on every request                                                 | `server/src/middleware/auth.ts` (`requireAuth`)                                                   |
| Expected scope compared inside the write transaction                                              | `server/src/services/progressWriteScope.ts` and the per-feature services                          |
| Session-generation guard ignores a refusal from an earlier session                                | `client/src/lib/sessionExpiry.ts`, `client/src/context/AuthProvider.tsx`                          |
| Every declared prerequisite is mandatory                                                          | `CurriculumPrerequisite` flags are provenance only; `docs/phase-1/curriculum-progress-rules.md`   |
| Cascade is transactional and transitive on the server                                             | `server/src/services/studentRecords.ts`                                                           |
| Client computes the same closure optimistically                                                   | `client/src/features/curriculum/CurriculumProgressMap.tsx`                                        |
| Grade attempts are immutable with an owner-scoped request key                                     | `GradeAttempt.@@unique([userId, requestId])`; `server/src/services/gradeAttempts.ts`              |
| Highest score per course, credit-weighted, physical training excluded, decimal arithmetic         | `server/src/services/gradeSummary.ts`; `docs/phase-2/numeric-grades.md`                           |
| Term averages only from stored year and semester                                                  | `docs/phase-2/semester-gpa.md`                                                                    |
| Shrinkage formula and prior strength                                                              | `server/src/services/bayesianDifficulty.ts`; `docs/phase-3/difficulty-ratings.md`                 |
| Hourly rating write limit                                                                         | `RatingWriteLimit`; `docs/phase-3/difficulty-ratings.md`                                          |
| Saved-semester save validates ownership, program, revision, membership, prerequisites, grade path | `server/src/services/ownStudyPlanReferenceSelection.ts`; `ReferenceSelectionReceipt`              |
| Drafts are tab-scoped and bound to a base revision                                                | `client/src/lib/savedReferenceSelectionDraft.ts`                                                  |
| Resources use compare-and-set on `revision`                                                       | `SchoolResource.revision`; `server/src/services/schoolResources.ts`                               |
| Classroom proxy is never copied into every course                                                 | `server/src/services/schoolSupply.ts`; `docs/phase-4/simulation-capacity-diagnostic.md`           |
| Two versioned allocation models, frozen and replayed                                              | `shared/src/schemas/semesterAllocation*.ts`; `docs/phase-4/semester-allocation-core.md`           |
| Explicit single-job execution, no daemon                                                          | `server/src/scripts/runSemesterAllocationJob.ts`; `docs/phase-4/semester-simulation-execution.md` |
| Intensity bands 9 / 15 / 18 / 21 credits                                                          | `client/src/features/curriculum/CurriculumProgressMap.tsx` (`creditsPerSemester`)                 |
| Elective claim is stored with the completion                                                      | `StudentRecord.electiveGroup`; `docs/phase-1/curriculum-progress-rules.md`                        |
| Administrator reference assignment writes one column only                                         | `server/src/services/curriculumAssignment.ts`; `docs/phase-2/reference-curriculum-assignment.md`  |
| Accessibility defects found and fixed                                                             | `docs/ui-quality-pass.md`; the two accessibility PR bodies                                        |
| Graph view deleted, browser-local state demoted                                                   | `AGENTS.md` decisions D1/D2; `docs/october-2026-recap.md` §9                                      |

## Chapter 5 — Results

| Claim                                                                | Evidence                                                                                    |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| 3,050 server tests across 115 suites                                 | full Jest run, 8 Nov 2026                                                                   |
| 2,516 client tests across 110 files                                  | full Vitest run, 8 Nov 2026                                                                 |
| 10 startup lifecycle cases                                           | `npm run test:development`                                                                  |
| Fail-first: 17 integration + 5 unit tests for the session-expiry fix | session-expiry PR body in `git log`                                                         |
| Allocation medians 3,381–4,843 ms; replay 1,681–2,502 ms; Apple M2   | `docs/phase-4/semester-allocation-profile.md` and its dated JSON                            |
| Persisted verification 1.7–2.5 s; history 10.4–17.7 s; single sample | `docs/phase-4/semester-stored-verification-profile.md`                                      |
| Largest internal result ≈ 6.05 MB                                    | `docs/phase-4/semester-allocation-profile.md`                                               |
| Nine accessibility defects fixed                                     | `docs/ui-quality-pass.md`; PR bodies for the two accessibility increments                   |
| One deliberate non-fix at 390 px                                     | `docs/ui-quality-pass.md`; `docs/october-2026-recap.md` "What is deliberately not done yet" |
| Open flake, different suites failing per run                         | recorded in `AGENTS.md` checkpoint 2026-11-07 from two observed runs                        |

## Chapter 6 — Conclusion

| Claim                                         | Evidence                                            |
| --------------------------------------------- | --------------------------------------------------- |
| Seven contributions                           | Chapters 3 and 4                                    |
| No institutional validation                   | `docs/current-data-and-inputs-audit.md` §4A         |
| One program populated; IT/DS sources conflict | `docs/phase-1/cse-curriculum-sources.md`; audit §4A |
| No calendar or offering data                  | audit §4D                                           |
| Assigned contexts are read-only               | `docs/phase-2/account-curriculum-reference.md`      |
| Resources and allocations are simulated       | `docs/phase-4/simulation-resource-persistence.md`   |
| Not deployed                                  | `docs/phase-5/deployment-readiness.md`              |

## Deliberate non-claims

These must never appear in the thesis without new evidence:

- A validated degree, graduation rule set or official cohort for any program.
- Course offerings, timetables, room suitability or staff qualification.
- Any measured improvement in student outcomes, grades or graduation timing.
- Any latency, throughput or capacity guarantee derived from the local profiling runs.
- Any claim that the reference curriculum's credit total is 126, 130 or 131.

## Known stale artefacts to check before submission

- `documentation/thesis/figures/*.png` were captured before the accessibility pass. Re-capture from
  the current build if the cards or controls changed visibly.
- `thesis.pdf` is committed; regenerate it with the command above rather than editing it.
- The results chapter states a test count that will be wrong the moment another increment lands.
