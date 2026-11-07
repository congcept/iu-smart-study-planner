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

## What this blocks

A manifest cannot be produced without deciding, on the school's authority:

1. Whether block I is **45** credits (Bảng 4) or **40** (Bảng 6 with physical training removed).
2. Whether `IT091I` is `IT091IU`, and whether "Physics 1" means `PH013IU`.
3. Whether `IT067IU` / `IT099IU` and `IT067IU` / `EE054IU` are concurrent pairs that must be taken
   together, or prior-study edges in one direction.

The first alone prevents an IT manifest from passing the verifier, because the block arithmetic is
the check that makes the transcription trustworthy.

## Verified before shipping

`python3` arithmetic over the transcribed rows reproduces all the figures above; the row total of
150 is a computation, not a reading. No IT data is stored, no curriculum is created, and no reader
is touched.
