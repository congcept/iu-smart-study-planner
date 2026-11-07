# Current gaps, missing data, and inputs needed from you

**Checked:** 22 October 2026, Asia/Ho_Chi_Minh.
**Scope:** an inventory of the existing project, not an implementation plan. Feature work remains on hold. No curriculum assignment, seed, migration, resource configuration, academic record, or application code was changed for this audit.

## 1. What was actually checked

- The supplied screenshot and the full recap at `main:docs/october-2026-recap.md`.
- Published `main` at `24de1fd6a3f591d7fecb86220d0ca1eb920e5616`, confirmed through GitHub as well as local history. Its GitHub Actions run `39746542663` completed successfully.
- The source contracts, Prisma schema, seed, curriculum manifests, and relevant feature notes. Historical feature notes describe their own increment; their “next” paragraphs are not reliable statements of today's shipped functionality.
- The running local Compose PostgreSQL database using explicit read-only transactions. These observations describe this database only, not a fresh install, another developer's database, or production.
- The unmerged CS 2025 evidence branch and PR #136. Its state was OPEN at inspection, with no merge date. It is evidence under review, not shipped `main` functionality.

The working checkout is `codex/curriculum-gpa-disabled-states` at `e3f6793`, not `main`. The recap is present in `main` but absent from this checkout. This audit does not switch branches, copy the recap over, merge changes, commit, or push. The schema and demo-auth source inspected here agree with `main` for these checks.

## 2. Double-check of the earlier output

| Earlier claim                                                                            | Audit result                                                                                                                                                                                                                                                                              |
| ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The recap was committed as `24de1fd` on `main`, with a README link and green CI.         | Confirmed. The commit changes the recap and README; the README links it; the recorded CI run succeeded. This does not mean this audit re-ran the application suites.                                                                                                                      |
| It is about 4,300 words.                                                                 | Reasonable approximation: `wc -w` reports 4,392 words.                                                                                                                                                                                                                                    |
| It covers 2–22 October 2026, with 133 squashed PRs.                                      | Confirmed from first-parent history: 133 PR-labelled commits, plus the recap commit itself. The requested window starts on 1 October, but the first landing in that window is 2 October.                                                                                                  |
| 585 files changed, +120,709 / −3,203 lines.                                              | Correct for the implementation range, from the parent of `861c16e` through `2d83de0`, excluding the recap commit. Including the recap/README addition gives 586 files, +121,134 / −3,203. These are net tree-diff statistics, not a sum of every PR's churn.                              |
| `main` was quiet from 13 June until 2 October.                                           | Confirmed for landing history. This does not establish when branch work was authored or how much human effort it took.                                                                                                                                                                    |
| All three named demo accounts have null curricula.                                       | Confirmed in the local database, including the populated account. It is a snapshot, not an invariant: demo login preserves an existing row rather than resetting its assignment.                                                                                                          |
| Every curriculum-context feature is hidden unless the current account has an assignment. | Too broad. Account-context student views do require assignment, but public reference list/detail APIs and admin reference selection can inspect a curriculum without assigning the admin. Legacy grades, ratings, saved-plan browsing and much admin functionality are already available. |
| Setting `curriculum_id` is what is needed to see the new work.                           | Incomplete and unsafe as operational advice. An assignment selects contextual readers, but does not validate the curriculum, graduation rules or historical selections, and does not enable assigned-context editing. Do not manually assign an account just to make screens appear.      |
| CS 2025 evidence exists as part of the current project.                                  | It exists on PR #136's branch, not on published `main`. The recap itself calls #136 open, but also lists its evidence among “what exists already”; keep that distinction explicit. A recorded hash and a filename containing “Signed” do not verify approval authenticity.                |
| The feature-viewing table says “Nothing” is needed for several screens.                  | Read this as “no additional feature implementation,” not “no setup or data.” Authentication, relevant completion/grade records, saved plans/semesters and configured admin resources still determine what is visible.                                                                     |

**Corrected explanation for the invisible changes:** much of October is authorization, scope isolation, atomic writes, recovery and validation behind familiar screens. Some student views also need a curriculum assignment that ordinary workflows do not provide. Other views need saved data. Not all invisible work is behind the assignment gate, and filling that field would not make the project institutionally validated.

## 3. Data that is present versus actually blank locally

Read-only snapshot taken at approximately 16:22–16:23 on 22 October 2026:

| Item                                   | Observed state                                                                      | Meaning                                                                                                                         |
| -------------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Curriculum rows                        | 1: `CS-REFERENCE`                                                                   | A legacy reference exists; this is not an activated, verified cohort.                                                           |
| `CS-REFERENCE.totalCredits`            | NULL                                                                                | The stored contextual degree total is explicitly unknown, not zero.                                                             |
| Accounts assigned to any curriculum    | 0                                                                                   | The local reference cohort has no assigned users.                                                                               |
| School-resource configurations         | 0                                                                                   | No saved curriculum/year/semester resource configuration exists locally. Missing capacity is unknown, not zero capacity.        |
| Numeric grade attempts, whole database | 15                                                                                  | Numeric data is not wholly missing; completeness and membership still matter per account.                                       |
| Course ratings, whole database         | 8                                                                                   | Some votes exist, but this is not evidence of a representative student population.                                              |
| `demo.populated@example.test`          | 17 completed records, 10 numeric attempts, 5 ratings, 1 saved plan; null curriculum | Existing populated demonstration data, not an assigned cohort. Attempt count is not the number of distinct graded courses.      |
| `demo-student@example.test`            | 0 completed records, 0 numeric attempts, 1 rating, 0 saved plans; null curriculum   | The recap's description “empty” is not literally true at this snapshot. Retained rating history alone does not establish a bug. |
| `demo-school-admin@example.test`       | 0 completed records, 0 numeric attempts, 0 ratings, 0 saved plans; null curriculum  | The role exists; it does not supply resources or a student cohort.                                                              |

The recap also quotes a GPA, completed-credit total and planned-course count for the populated account. Those derived values were not independently recalculated here; do not treat this table as reconfirming them.

The committed seed creates a legacy sample student, records and a study plan; the dedicated development demo-login service creates/preserves two role identities. Neither is a reproducible declaration of every record currently in the populated local account. Do not assume a clean database will reproduce this snapshot, and do not reseed an existing database to try to reproduce it.

## 4. What information is missing or unresolved now

### A. Curriculum authority and academic rules

**Already available:** official CSE source links, legacy CS JSON, a portable legacy manifest, and a reference backfill preserving repeated placements and a three-credit uncoded free-elective requirement. IT/DS 2025 source inspection is documented. Additional CS 2025 evidence is on the unmerged branch.

**Still unresolved:**

- Which program/cohort document governs the project's academic claims, and which source takes precedence when HTML, catalog, schedule, syllabus and appendix disagree.
- Verified course identities, names, credits, prerequisites, equivalent/substitute courses, required/elective status and placements for that chosen cohort.
- Graduation-credit arithmetic, elective selection rules, treatment of free electives, physical/military training and English requirements, and the official thesis/GPA rule. The legacy 41/43-course targets and >70 fork are implemented reference behavior, not proof of the signed cohort's graduation policy.
- The legacy reference's unresolved 130/131 modeled path totals. The unmerged CS 2025 review records a stated 126-credit total; that is not permission to overwrite the legacy total or infer a new degree validator.
- IT/DS reconciliation. Existing notes record IT HTML 150 credits but differing elective pools (16/8 versus 12 credits per specialization in the signed 2025 document), and DS HTML 129 versus signed 2025 124. DS also has code/credit/prerequisite conflicts, including `IT097IU` versus `IT079IU`, `IT094IU` at three versus four credits, and math-code differences. These need source clarification, not guessed substitutions.

**Potential input from you:** the intended cohort and any authoritative clarification or contact able to resolve these conflicts. You do not need to find all PDFs again: source links are already recorded. If you do not know a policy, “unknown” is the correct answer; coding assumptions must not fill the gap.

Evidence: `docs/phase-1/cse-curriculum-sources.md`, `docs/phase-1/cs-reference-manifest.json`, `docs/phase-1/cs-reference-backfill.md`; unmerged `docs/phase-1/cs-2025-catalog-review.md` on PR #136.

### B. Account context and usable demonstration data

**Missing locally:** assigned student cohorts and resource configurations. An assigned student currently receives a read-only curriculum reference, not the legacy map's editable completion flow. Ordinary registration/login does not assign a curriculum.

**Not a blank you should fill manually:** curriculum assignment, context switching, completion/claim transfer and context-keyed browser-cache safety are existing product limitations. Supplying a cohort name does not resolve those contracts. No account needs changing during this pause.

**Potential input from you:** only the intended interpretation of demonstration data, if not already recorded. Current scope already permits simulated students; there is no requirement to obtain real student identities or private transcripts just to populate examples. Existing local demo data and repeatable fixtures must be distinguished in any demonstration description.

Evidence: `server/src/services/demoAuthService.ts`, `server/prisma/seed.ts`, `docs/phase-2/account-curriculum-reference.md`, `docs/phase-2/progress-write-scope.md`, `docs/phase-2/progress-store-scope.md`.

### C. Grades, ratings and course metadata

**Present:** immutable 0–100 attempts, highest-score credit-weighted GPA, preserved legacy letter grades, and stored 1–5 difficulty ratings.

**Missing or unverified:** numeric scores for records that have only a completion or legacy letter grade; representative rating coverage; verified subject-area tags; empirically supported difficulty priors. Existing categories describe requirement types, not subject aptitude. Seed difficulty is a heuristic, and numeric grade-fit is a bounded preference policy, not a validated prediction of success.

**Potential input from you:** actual numeric scores only if you want a specific account's real history represented, or explicitly labelled simulated scores for demonstrations. Never infer a 0–100 score from an old letter grade. No real-student dataset is required under the agreed simulated scope. Academic validation would require evidence beyond adding more made-up votes.

Evidence: `docs/phase-2/numeric-grades.md`, `docs/phase-2/grade-summary-scope.md`, `docs/phase-3/difficulty-ratings.md`, `docs/phase-3/numeric-grade-fit.md`, `server/prisma/seed.ts`.

### D. Resource simulation inputs versus real scheduling information

**Blank in the current database:** every resource configuration. The existing form's base inputs are professor count, classroom count, lab-room count and maximum students per section, scoped to a curriculum, semester and year. Optional member-course overrides supply capacity/professor counts. Missing values and explicit zeros have different meanings.

**Potential input from you for an existing simulation:** a clearly labelled scenario containing those four counts and its scope. Hypothetical numbers are acceptable as simulation assumptions, not university facts. The model also captures abstract classroom time blocks and sections per professor; configuration defaults of one are assumptions, not verified teaching-load rules.

**Absent institutional evidence:** actual course offerings per term, section meeting times, room/lab suitability and occupancy, staff qualifications/availability/load, complete registration demand, cross-curriculum sharing and official student credit budgets. A placement in “Year 2, Semester 1” does not prove a Fall offering. Stored lab inventory and overrides do not imply every allocation model uses them.

**Current limitation, not a request to collect all of that now:** filling the existing resource form cannot turn the reference allocator into a verified timetable, reservation system or registration decision. Zero assigned users also means local contextual demand cannot demonstrate an assigned cohort. Do not assign users or fabricate institutional capacity during this audit.

Evidence: `docs/phase-4/simulation-resource-screen.md`, `docs/phase-4/simulation-resource-persistence.md`, `docs/phase-4/simulation-resource-envelope.md`, `docs/phase-4/eligible-cohort-demand.md`, `docs/phase-4/semester-allocation-preview.md`.

### E. Thesis evidence and written material

**Already available:** substantial feature notes, tests, recorded local profiling observations, and the October recap on `main`.

**Currently inconsistent:** the thesis abstract still describes React Flow, the results chapter still describes the early small test baseline, and the conclusion lists difficulty ratings as future work although ratings are implemented. These are documentation gaps, not missing student data. Historic setup/audit sections in `MASTER_IMPLEMENTATION_PROMPT.md` also describe the old baseline and must not be read as a current inventory.

**Evidence boundary:** passing tests establish tested software behavior; local profiling establishes observations for those fixtures. Neither proves official academic validity, improved graduation outcomes, representative recommendation accuracy or a completed user study.

**Potential input from you:** any existing supervisor rubric, approved research questions, evaluation requirements or source/policy feedback not already stored in the repository. No new survey, real-student recruitment or evaluation experiment is being requested or initiated here. Current papers/chapters are not rewritten in this audit.

Evidence: `documentation/thesis/chapters/00-abstract.tex`, `documentation/thesis/chapters/05-results.tex`, `documentation/thesis/chapters/06-conclusion.tex`, `docs/phase-4/semester-allocation-profile.md`, `docs/phase-4/semester-stored-verification-profile.md`.

### F. Operational information

Production hosting, public origin/domain, HTTPS/proxy/cookie topology, production database, secure secret provisioning, recovery and deployed-flow verification remain unconfirmed by the deployment-readiness note. Its origin parser is a configuration preflight, not evidence of deployment.

**Nothing is requested from you for deployment now.** These are unfilled operational decisions, not prerequisites for reviewing the local project. Do not paste passwords, keys or tokens into chat. This audit neither provisions hosting nor verifies an external production environment.

Evidence: `docs/phase-5/deployment-readiness.md`.

## 5. The short list of what is actually needed from you

Nothing is required from you to keep implementation paused or to read this audit. The useful unresolved inputs, when known, are:

1. **Academic reference:** which cohort/program should be treated as the intended reference, plus any authoritative clarification of the listed source conflicts. This is a documentation/policy answer, not permission to activate it.
2. **Existing supervisor requirements:** the rubric, accepted research questions and required evidence, if these are available outside the repository.
3. **Optional demonstration assumptions:** only if you want particular existing screens explained against a named scenario, provide labelled simulated resources and academic histories. Simulated students are already agreed; no fresh authorization or real personal data is needed.

You are **not** being asked to hand-transcribe all course PDFs, invent missing academic rules, obtain private student data, manually assign curricula, fill every database table, choose hosting, supply secrets, or authorize another implementation phase.

## 6. How to read the gaps without creating a new roadmap

- **Blank existing input:** no local resource row, missing numeric score, absent saved plan for an account. Some existing screens can accept such inputs, but this audit does not enter them.
- **Unresolved authority/evidence:** cohort rules, curriculum conflicts, empirical difficulty, subject metadata and evaluation claims. These must remain explicitly unknown, not filled with guesses.
- **Current product boundary:** no ordinary curriculum-assignment workflow, read-only assigned curriculum, reference rather than calendar-valid planning. More data alone does not remove these boundaries.
- **Stale explanation:** old thesis text and overbroad recap wording. These are not evidence that every described feature is absent.

This document records the state and responsibilities only. It proposes no feature order, delivery dates, new implementation scope, database repairs or automatic continuation.
