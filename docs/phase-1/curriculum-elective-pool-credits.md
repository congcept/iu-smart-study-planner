# Credit-stated elective pools

Both signed 2025 curriculum documents state elective pools in **credits** — "select 12 credits",
"select a minimum of 7 credits". The schema could only say how many **courses** a pool admits, via
`CurriculumPlacement.electiveSelectCount`.

The two are interchangeable only when every option in the pool carries the same credit value, and
that is false for the DS pool: `IT120IU` and `IT153IU` carry 3 credits while the other thirteen
options carry 4. Expressing a 7-credit requirement as a course count would silently change what the
document requires, so the field is added rather than approximated.

## Contract

`CurriculumPlacement.electiveSelectCredits` is a nullable integer. A placement states its pool in
exactly one of the two units:

| `electiveSelectCount` | `electiveSelectCredits` | Meaning |
| --- | --- | --- |
| null | null | A required course, or a placement with no pool |
| positive | null | A pool that admits this many courses |
| null | positive | A pool that admits this many credits |

Sources that state counts — the CS reference import — keep writing `electiveSelectCount` and leave
the new field null, so their behaviour is unchanged.

## Enforcement

A migration constraint (`curriculum_placements_elective_pool_check`) rejects:

- a non-positive credit total;
- a placement that sets both fields;
- a credit total on a placement with no elective group, or on one that also counts courses.

The shared response schema enforces the same "never both" rule, so a malformed reply is rejected by
the client rather than rendered. The strict response contract forces every reader that projects
placements to include the field; the one production projection in `curriculumContexts.ts` was
updated with it.

## What this does not do

Nothing reads the new field yet. Eligibility, prerequisite resolution, the semester preview and the
allocation models still treat elective membership as a set of placements; a credit budget is not
consumed anywhere. That work belongs with the import that first needs it, and the constraint above
is what makes the distinction enforceable in the meantime.

No IT or DS data is seeded, no curriculum is activated, and no account is assigned by this change.

## Verification

Six real-PostgreSQL cases: a credit-stated pool stored beside a count-stated pool; the credit-stated
pool returned through `GET /api/curricula/:id` and accepted by the strict client schema; and
rejection of both-fields, missing-group and non-positive cases at the database, plus the same
"never both" rule at the client contract. Every placement fixture gained an explicit null so the
contract stays required rather than optional.
