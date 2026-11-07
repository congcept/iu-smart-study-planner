# Curriculum cohorts

A curriculum belongs to an admission year. A student admitted in one year follows that year's plan
for their whole degree, and a later plan supersedes nothing: where the 2024 and 2025 Data Science
documents differ, both are correct, for different students.

Two consequences follow, and this increment implements the second:

1. A difference **between** two cohort documents is a change, not a contradiction. Only a
   discrepancy **inside** one document is a defect worth taking to the school.
2. A year whose plan is unchanged must **point at** the existing structure rather than carry a copy.
   Two copies of the same plan drift apart on the first correction to either.

## Model

`CurriculumCohort` records that a structure governs an admission year:

| Field                      | Meaning                                                               |
| -------------------------- | --------------------------------------------------------------------- |
| `curriculumId`             | the structure — courses, placements, prerequisites, requirements      |
| `cohort`                   | the admission-year label as the school states it, for example `K2025` |
| `sourceLabel`, `sourceUrl` | provenance of the document that governs _this_ cohort                 |

Provenance sits on the cohort rather than the structure, because two cohorts can share one structure
while being governed by two different documents. A unique constraint on `(curriculumId, cohort)`
stops one structure claiming the same year twice; a check constraint rejects an empty or padded
label.

The same cohort label legitimately appears on several curricula — the 2025 intake exists for every
major — so nothing here declares a cohort globally unique.

## Readers

- `findCurriculaForCohort(cohort)` returns **every** structure claiming that cohort, across
  programmes, ordered by curriculum code. More than one is normal; choosing is the caller's job
  because only the caller knows which programme it is asking about.
- `listCohortsForCurriculum(curriculumId)` returns the intakes one structure governs.
- `requireCohortGovernance(cohort)` fails closed: no claimant is `404`, several is `400` with the
  count, one is the answer. It has no "pick the first" branch on purpose.

## What this does not do

**Nothing writes cohorts yet.** No import, admin action or seed creates a `CurriculumCohort` row, so
every existing curriculum keeps today's behaviour exactly. The writer arrives with the first cohort
import, which is also the first caller that can say which programme it means.

No cohort is assigned to any account, no curriculum is activated, and no reader outside this module
consults the table.

## Verification

Seven real-PostgreSQL cases: one cohort governed by two programmes is reported, not resolved; one
structure governing two intakes is reported as two; `requireCohortGovernance` returns `400` for the
ambiguous case and `404` for the unknown one; the unique constraint rejects a repeat on one structure
while a different structure may claim the same label; the check constraint rejects padded and empty
labels; labels normalize before any query; and deleting a structure removes its governance rows.
