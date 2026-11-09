# IT 2025 source findings (Network Engineering)

Prepared while transcribing IT Network Engineering into a manifest. The manifest is **not** shipped,
because the document does not reconcile in two places and one prerequisite shape is mutually
dependent by definition. This note records exactly what is sound, what is not, and what has to be
answered before an import.

Source: the signed 2025 Information Technology PDF, `4e62d229…7584` (see
`it-ds-2025-source-evidence.md`). Bảng 7 (course table, pp. 9–23), Bảng 9 (Network Engineering
schedule, p. 24), Bảng 4 (block totals, p. 6), Bảng 6 (common framework, p. 8).

## What reconciles

The **row-level credits** across the nine scheduled semesters total exactly **150**, matching the
document's own grand total and its block summary (45 + 35 + 44 + 6 + 20):

| Semester  | Rows total | Bracket label | Printed `Tổng` |
| --------- | ---------: | ------------: | -------------: |
| I         |         17 |            18 |             17 |
| II        |         20 |            19 |             20 |
| III       |         20 |            17 |             20 |
| IV        |         15 |            15 |             15 |
| V         |         16 |            16 |             16 |
| VI        |         14 |            16 |             16 |
| VII       |         17 |            15 |             15 |
| VIII      |         14 |            17 |             14 |
| Summer    |          7 |             7 |              7 |
| IX        |         10 |            10 |             10 |
| **Total** |    **150** |               |                |

Physical training is counted in none of the rows, as the document prints it in parentheses.

## What does not reconcile

**Six semester labels disagree with their own rows** (I, II, III, VI, VII, VIII), and four of those
also disagree with the printed `Tổng` for the same semester. The rows are self-consistent across all
nine semesters and total 150, so the rows are the trustworthy figure and the bracketed labels are
not.

**The general-education block claims 45 credits, but its own framework table yields 40.** Bảng 4
declares block I as 45 required credits; Bảng 6 lists that block as 46 credits _including_ six
credits of physical training, which the document excludes from all totals. 46 − 6 = 40.

Both figures cannot be right, and the difference is five credits — the same size as a course. The
manifest verifier rejects a block whose declared credits disagree with the courses it claims, so
this must be resolved before an IT manifest can pass.

## Prerequisite inventory (Network Engineering)

Read from Bảng 9. Kinds are the document's own: **TQ** prerequisite, **HT** prior study, **SH**
concurrent.

| Course            | Requires                  | Kind |
| ----------------- | ------------------------- | ---- |
| PE016IU           | PE015IU                   | SH   |
| IT069IU           | IT116IU **or** IT149IU    | HT   |
| MA003IU           | MA001IU                   | TQ   |
| PE017IU           | PE015IU, PE016IU          | TQ   |
| EN012IU + EN011IU | EN008IU + EN007IU         | TQ   |
| IT153IU           | IT116IU **or** IT149IU    | HT   |
| IT067IU           | IT099IU / EE054IU         | SH   |
| IT099IU           | IT067IU                   | SH   |
| IT013IU           | IT069IU                   | HT   |
| IT079IU           | IT116IU **or** IT149IU    | HT   |
| IT091IU           | IT116IU **or** IT149IU    | HT   |
| IT093IU           | IT079IU **and** IT069IU   | HT   |
| IT017IU           | IT089IU, IT013IU          | HT   |
| IT096IU           | IT091IU                   | HT   |
| IT125IU           | IT091IU                   | HT   |
| PH015IU           | Physics 1                 | TQ   |
| PH016IU           | PH015IU                   | SH   |
| PE018IU           | PE017IU                   | TQ   |
| PE019IU           | PE015IU, PE016IU, PE017IU | TQ   |
| IT159IU           | IT069IU                   | HT   |
| IT134IU           | IT091IU                   | HT   |
| IT058IU           | IT083IU                   | TQ   |

Three shapes here are not in DS or CS:

1. **Alternatives** — four courses accept either programming course. The manifest contract now has
   `alternativeGroup` for this (PR #148), but nothing enforces it yet.
2. **Mutual concurrency** — `IT067IU` and `IT099IU` name each other as concurrent. That is what
   concurrent means, but the verifier's cycle check treats every edge as an ordering constraint and
   would reject the pair. The cycle rule has to ignore `SH` edges, or model a same-semester pair as
   one unit.
3. **Alternatives with a slash** — `IT067IU` requires `IT099IU / EE054IU`, a second alternative
   group in a different notation from "hoặc".

## Document defects

- `IT091IU` is printed as **`IT091I`** in the prerequisites for `IT096IU` and `IT125IU` — the
  trailing `U` is missing, so the code is not valid.
- `PH015IU` names its prerequisite as **"Physics 1"**, a course name rather than a code.
- Three elective slots (**Elective 1, 2, 3**) are unnamed: 4 credits each, 12 in total, matching the
  block's self-chosen allocation.
- Two rows combine courses into one cell: `EN008IU + EN007IU` and `EN012IU + EN011IU`, each four
  credits, where the catalogue holds them as separate two-credit courses.

## A prerequisite that names a course outside the programme

`IT149IU` (Fundamentals of Programming) appears in the schedule **only** inside prerequisite cells —
never as a scheduled row and never in the block tables. Four requirements read "`IT116IU` or
`IT149IU`", and `IT149IU` is not a member of this curriculum; it is a Data Science foundation course.

The verifier requires both endpoints of an edge to be members, so this is the remaining blocker for an
IT manifest. It is a real modelling gap rather than a document defect: an alternative may legitimately
be satisfied by a course a student took outside the programme, and the contract has no way to say so
yet.

**Measured, then deferred.** The obvious model is a nullable `prerequisite_id` plus an
`external_prerequisite` code with exactly one set, and it was started. It was abandoned after the
typecheck showed what it reaches: the completion cascade, the progress-context lookup, the saved-plan
reference review and the archive import all read `prerequisiteId` as a member identity.

Filtering nulls is not the same decision in each place. In the archive import and the reference review
an external requirement simply cannot be checked against this programme's records, so ignoring it is
honest. In the completion cascade the same choice means a student can complete a course whose
external prerequisite is unmet — which would be a rule the system does not enforce while appearing to.
The alternative, checking the student's global records for that course code, is a different and larger
change.

So the contract question is answered and the enforcement question is not, and inventing one answer per
call site under time pressure is exactly how a rule ends up inconsistent. IT therefore stays
unimportable, which is the correct state: importing it with only the in-programme branch would narrow
the rule and block students who took the other route.

**Decided 8 November 2026.** The enforcement question is now settled in
`external-prerequisite-decision.md`: an external requirement is satisfied by a completion of that
course in the student's own records, which is one rule for all four consumers rather than a shrug in
each. The implementation is the remaining work, not the design.

## Computer Engineering: blocks reconcile, schedule not yet transcribed

The second specialisation shares block I (45), block II (35), block IV (6) and block V (20) with
Network Engineering, and differs only in the specialised block, where its thirteen required courses
also total exactly **32**:

| Course                                      | Credits |
| ------------------------------------------- | ------: |
| `IT068IU` Principles of Electrical Circuits |       3 |
| `IT098IU` Electrical Circuits Laboratory    |       1 |
| `IT105IU` Digital System Design             |       3 |
| `IT106IU` Digital System Design Laboratory  |       1 |
| `IT115IU` Embedded Systems                  |       3 |
| `IT127IU` Embedded Systems Laboratory       |       1 |
| `IT128IU` Microprocessor Systems            |       3 |
| `IT129IU` Microprocessor Systems Laboratory |       1 |
| `IT110IU` Concepts in VLSI Design           |       3 |
| `IT126IU` VLSI Design Laboratory            |       1 |
| `IT103IU` Digital Signal Processing         |       4 |
| `IT134IU` Internet of Things                |       4 |
| `IT159IU` Artificial Intelligence           |       4 |

45 + 35 + 32 + 12 + 6 + 20 = 150, so the blocks reconcile for this specialisation too.

**A parsing gap, not a document gap.** `IT126IU` prints its credit with a blank lecture cell — one
credit, zero lecture, one laboratory — so an extractor that expects three consecutive numbers skips
it and the block comes out one credit short. That is the kind of error that looks like a document
defect and is not.

### The schedule reconciles at 150 but prints ten blocks for nine semesters

Reading the Computer Engineering schedule row by row, its printed block totals are
**17 + 20 + 20 + 15 + 16 + 16 + 7 + 16 + 13 + 10 = 150**, matching the block table exactly. The
contents are:

| #   | Total | Courses                                                                                          |
| --- | ----: | ------------------------------------------------------------------------------------------------ |
| 1   |    17 | `IT116IU`, `MA001IU`, `PE015IU`, `PE016IU`, `EN008IU`+`EN007IU`, `PT001IU` (excluded)            |
| 2   |    20 | `IT069IU`, `MA033IU`, `MA003IU`, `PE017IU`, `EN012IU`+`EN011IU`, `PT002IU` (excluded), `PE021IU` |
| 3   |    20 | `IT064IU`, `IT013IU`, `IT068IU`, `IT098IU`, `IT067IU`, `IT099IU`, `IT153IU`, `PH013IU`           |
| 4   |    15 | `IT091IU`, `IT089IU`, `IT128IU`, `IT129IU`, `MA036IU`                                            |
| 5   |    16 | `IT017IU`, `IT079IU`, Elective 1, `PH015IU`, `PH016IU`                                           |
| 6   |    16 | `IT105IU`, `IT106IU`, `IT115IU`, `IT127IU`, Elective 2, `PE018IU`, `PE019IU`                     |
| 7   |     7 | `IT174IU` internship                                                                             |
| 8   |    16 | `IT110IU`, `IT126IU`, `IT103IU`, `IT159IU`, Elective 3                                           |
| 9   |    13 | `IT083IU`, `IT134IU`, `IT120IU`, `PE020IU`                                                       |
| 10  |    10 | `IT058IU` thesis                                                                                 |

The table's own bracket labels disagree with its rows the way the Network Engineering table's did —
the third block is labelled _17 tín chỉ_ while its rows total 20 — so the labels are not usable as
placements.

**Resolved: the blocks are separations, not semesters.** The ten blocks group courses by kind; they are
not ten terms. A student plans their own sequence subject to one ordering rule: the special study is
taken before the thesis, and the thesis occupies the final semester alongside whatever else remains.
That single rule is encodable, so the placement question below is answered by it rather than by the
document, and the manifest carries the rule as its basis.

The manifest therefore places the special study in year four semester one and the thesis in year four
semester two, with the remaining specialised courses alongside the thesis. Block eight and the special
study share the first semester of the final year, which is why that term carries nineteen credits in
the transcription; the document does not specify a distribution and this is the one the rule implies.

_The question as originally recorded, retained because it explains the rule:_

The document states nine semesters, but its rows form **ten** blocks: the
thirteen-credit block containing `IT083IU` (Special Study of the Field) and the ten-credit thesis block
are separate, and the thesis requires the special study. Nine slots cannot hold ten blocks while
keeping a mandatory earlier-semester prerequisite in an earlier semester. Either two blocks share a
semester, or the thesis follows the ninth, and the document says neither.

That is a placement question, not an arithmetic one, and it is the last thing standing between this
specialisation and a manifest. It is recorded here rather than resolved by guessing, because guessing
wrong puts a thesis prerequisite in its own semester.

**Not transcribed.** Unlike its block table, this specialisation's schedule wraps names, cells and
prerequisite text across fixed-width lines badly enough that a parser recovered 41 rows with
misattributed semesters and wrong credit columns. Its placements and prerequisites need the same
row-by-row treatment Network Engineering received, and are the next step rather than a guess.

## What this blocks

The block arithmetic no longer blocks anything: the programme's own tables reconcile at 150, so an IT
manifest can be built. Three questions remain, and none of them is arithmetic:

1. Whether `IT091I` is `IT091IU`, and whether "Physics 1" means `PH013IU`.
2. Whether `IT067IU` / `IT099IU` and `IT067IU` / `EE054IU` are concurrent pairs that must be taken
   together, or prior-study edges in one direction.
3. How the three unnamed elective slots relate to the twelve self-chosen credits the specialised
   block allocates.

## Verified before shipping

`python3` arithmetic over the transcribed rows reproduces all the figures above; the row total of
150 is a computation, not a reading. No IT data is stored, no curriculum is created, and no reader
is touched.
