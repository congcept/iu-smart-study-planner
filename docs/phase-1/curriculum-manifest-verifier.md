# Curriculum manifest verifier

Importing IT or DS needs two different kinds of confidence, and they are not the same:

1. **The manifest matches the document.** Only review establishes this.
2. **The manifest is internally consistent.** This can be proved, and until it is proved nothing
   should be written.

This increment builds the second. A _manifest_ is a reviewed, portable transcription of one signed
curriculum document: program identity, the block structure with its credit allocation, the courses
with their lecture and laboratory units, the per-semester placements, the uncoded requirements, the
prerequisite edges, and the exclusions. The document's hash and page locators travel with it, so a
reader can check that the same bytes were transcribed.

## The command

```bash
cd server && npm run verify:curriculum-manifest -- ../docs/phase-1/<manifest>.json
```

It prints a JSON report and exits `1` when the manifest is not importable. The report always
carries `mode: 'REFERENCE_ONLY'` and a `nextStep` that says the document has not been re-read, even
when everything passes — a self-consistent manifest is not a verified cohort.

## What it proves

| Category            | Check                                                                                                 |
| ------------------- | ----------------------------------------------------------------------------------------------------- |
| `IDENTITY`          | Course codes match the published IU form and are unique                                               |
| `IDENTITY`          | A course's lecture plus laboratory units equal its declared credits                                   |
| `PLACEMENT`         | Every placement names a member course, one occurrence per slot and group, unique source order         |
| `PLACEMENT`         | Every required course has at least one placement                                                      |
| `ELECTIVE`          | A pool states its limit in courses **or** credits, never both, and only on a group                    |
| `ELECTIVE`          | All options in one pool state the same unit and the same amount                                       |
| `ELECTIVE`          | Declared pools or requirements total exactly the elective credits the blocks allocate                 |
| `CREDIT_ARITHMETIC` | Each block's declared required credits equal the credits of the courses it claims                     |
| `CREDIT_ARITHMETIC` | No course is required by two blocks                                                                   |
| `CREDIT_ARITHMETIC` | The blocks total the declared program credits                                                         |
| `PREREQUISITE`      | Both endpoints are members, no self-edge, no duplicate, no cycle                                      |
| `EXCLUSION`         | A physical-training exclusion names its course, agrees on credits, and is neither required nor placed |

The arithmetic checks are the ones that would have caught the mistakes already made in this
project: a DS reading that produced a 120-credit degree from a 124-credit document, and an elective
block whose 11 credits were mistaken for a single pool.

That second case caught a defect in this verifier. Its first version compared the pools against the
block allocation and treated uncoded requirements as an alternative — so a correct DS manifest, with
a 7-credit pool plus a 4-credit free elective, was rejected. The allocation is now spent by pools
and requirements together, and a case in the suite pins that shape.

## What it cannot do

An excluded course may still be **scheduled**: both documents place physical training in a semester
while excluding it from the credit total, so exclusion is a credit rule, not a calendar rule. It may
not be required by a block.

It proves the manifest agrees with **itself**. It cannot prove the document agrees with the
manifest, and it must not be used to resolve a contradiction inside a source document. The DS
document still cites `MA026IU` for `IT151IU` and schedules `IT154IU` where it means `MA033IU`; a
manifest cannot reconcile that, and a verifier that silently preferred one reading would manufacture
authority the source does not have.

## Verification

Sixteen pure cases cover a consistent manifest and every rejection path above, each asserting the
category and message rather than only the outcome. Four command cases prove the exit codes, that a
blocker is named in the report, that a missing or non-JSON file produces a readable error rather
than a stack trace, and that the usage guard holds.

## Status of the DS transcription

A DS manifest is **not** included here. The course table converts cleanly — 50 identities with
credits that match the document's own block totals of 38, 27 and 16 — but the per-semester schedule
does not: the fixed-width layout wraps names, prerequisite cells and semester labels across lines, and
a regex over the extracted text recovered 39 of roughly 50 rows and misattributed semesters.

Placements and prerequisite edges therefore have to be transcribed row by row against the source
locators, not parsed. That is the next increment, and it is why this gate exists: the transcription
will be checked by arithmetic rather than trusted.

No database is touched, no curriculum is created, and no reader changes. This is the gate that IT
and DS manifests will have to pass before an importer is written.
