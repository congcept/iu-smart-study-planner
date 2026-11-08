# External prerequisites: the decision

IT states four requirements as "`IT116IU` or `IT149IU`", and `IT149IU` is a Data Science course. The
manifest contract can name that alternative. The enforcement could not decide what it means, so IT
stopped at the transcription. This records the decision, so the implementation has one answer instead
of four plausible ones.

## The decision

**A requirement satisfied by a course outside the programme is satisfied by a completion of that
course in the student's own records.**

Records are global by course, so a student who passed `IT149IU` anywhere — in this programme, in
another, or through a transfer recorded as a record — already holds the evidence. The check is: does
this account have a `COMPLETED` record for the course carrying that code.

It is not satisfied by the course being _offered_, by the student being enrolled elsewhere, or by an
administrator assertion. Only a record counts, which keeps the rule the same shape as every other
prerequisite in the system.

## Why not the alternatives

| Alternative                                       | Why not                                                                                                                                                             |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ignore an external requirement                    | Honest in an advisory check, dishonest in the completion cascade: it would admit a student whose external prerequisite is unmet while appearing to enforce the rule |
| Refuse every submission that has one              | Blocks every IT student who took the in-programme route, which is most of them                                                                                      |
| Require an administrator to record an equivalence | Adds a workflow and a new authority for something the student's own record already answers                                                                          |

The first was the tempting one, and it is exactly the "one answer per call site" failure that made the
earlier attempt unsafe: the same `continue` is a defensible shrug in a review screen and a real defect
in the cascade.

## Consequences per consumer

Every consumer resolves the same way, which is the point of deciding it once.

| Consumer                                                       | Behaviour                                                              |
| -------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Completion cascade (`studentRecords`, `importStudentProgress`) | An unmet external prerequisite blocks, keyed on a record for that code |
| Progress-context lookup (`progressCourseContext`)              | Carries the external edge through, resolved the same way               |
| Saved-plan reference review (`ownStudyPlanReferenceReview`)    | Reports an external prerequisite as unmet unless a record exists       |
| Archive import validation (`importStudentProgress`)            | Same rule; it is the same function that already enforces members       |

## The model this needs

Already measured and reverted once:

- `curriculum_prerequisites.prerequisite_id` becomes nullable;
- a new `external_prerequisite` column carries the code;
- exactly one of the two is set, enforced by a check constraint;
- a partial unique index guards external duplicates, because `NULL`s are distinct in a plain unique
  index.

The verifier already accepts an `alternativeGroup`; it needs the external branch to skip the membership
requirement while keeping the code-shape, self-edge and cycle rules. Cycle detection stays over member
edges only, since an external code has no node in this programme.

## Implemented

The rule is enforced in one place. `prerequisiteSatisfaction.ts` holds it — an edge is met by a
completion of its member, or by a completion of the course carrying its external code, and an unknown
code is never met — and every consumer calls it rather than reimplementing the check:

| Consumer                    | What changed                                                                                                                                                     |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Completion cascade          | loads the student's completions and resolves external codes against the catalogue; an unmet external prerequisite refuses with `409` and the code in the details |
| Archive import              | the same call, so a batch cannot import past it                                                                                                                  |
| Progress-context lookup     | carries the external branch through instead of dropping it                                                                                                       |
| Saved-plan reference review | counts an external requirement as a missing parent, keyed so an unknown code can never be satisfied                                                              |

The legacy global prerequisite graph has no external branch, so both the cascade and the import
normalize it to the same shape before calling the shared rule. The cascade's dependency map skips
external edges, because an external code has no node in this programme.

The manifest contract gained `external` on an edge, and the verifier refuses to mark a **member** as
external, since that contradiction would silently move a real requirement out of the membership
check. The importer writes `external_prerequisite` instead of a member id for those edges.

**One gap, stated rather than hidden:** the reference view's response contract has no external branch,
so `GET /api/curricula/:id` projects member edges only. An imported programme with external
requirements would have them enforced but not shown. That is a UI-contract change, not an enforcement
one, and it is the next step.

## What this does not do

It does not decide whether a completion from a _different programme's_ course with the same code is
adequate evidence. That is a transfer-credit question, not a data-model question, and the honest answer
today is that the record exists and the system treats it as evidence — with the limitation stated in
the interface rather than hidden.

No IT structure is stored, and no curriculum is activated, until the enforcement lands and its tests
pass.
