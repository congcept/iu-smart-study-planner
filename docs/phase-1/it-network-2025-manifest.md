# IT Network Engineering 2025 manifest

The third program, and the first with an elective allocation the document never fills and a
prerequisite satisfied outside the programme.

Source: the signed 2025 Information Technology PDF, `4e62d229…7584`, block table pages 6–7, course
table 9–23 and schedule page 24. One specialisation only; Computer Engineering is a separate manifest
that does not exist yet.

## What it reconciles

| Block                    | Declared |       Courses listed |
| ------------------------ | -------: | -------------------: |
| I general education      |       45 |      45 (18 courses) |
| II major foundation      |       35 |              35 (10) |
| III specialised required |       32 |               32 (8) |
| III elective             |       12 | 3 unnamed slots of 4 |
| IV supporting            |        6 |                6 (2) |
| V internship and thesis  |       20 |               20 (3) |
| **Total**                |  **150** |              **150** |

43 courses, 43 placements, 35 prerequisite edges. Physical training is excluded from every block and
still scheduled in semesters I and II, which is what the document prints in parentheses.

## The two shapes this program needed

**Elective credits with no candidates.** The block says _"sinh viên chọn tối thiểu 12 tín chỉ trong
nhóm môn học tự chọn"_ — a minimum of twelve credits from the elective group — and names three
four-credit slots without a single course. They are recorded as `UNNAMED_ELECTIVE` requirements, so the
allocation is accounted for without inventing options. The HTML page lists candidates at its older
sixteen/eight split, and a list from a superseded split is not evidence for 2025.

**A prerequisite from outside the programme.** Four requirements read "`IT116IU` or `IT149IU`", and
`IT149IU` is a Data Science course; `IT067IU` takes `IT099IU` or `EE054IU`, and `EE054IU` is not offered
here either. Those five edges are `external: true`: they name no member, they are excluded from the
dependency graph, and they are met by a completion of that course in the student's own records.

## Alternates and concurrency

`IT116IU` and `IT149IU` share an `alternativeGroup` on each of the four requirements, so one satisfies
it rather than both. `IT067IU` and `IT099IU` name each other as concurrent, which the cycle check ignores
because concurrency cannot order courses — that fix landed before this manifest existed.

## What is not claimed

The schedule's own bracket labels disagree with its rows in six of nine semesters. The placements here
follow the rows, because the rows total exactly 150 and the labels do not. `IT091IU` is printed without
its trailing `U` in two prerequisite cells, and `PH015IU` names "Physics 1" rather than `PH013IU`; both
are read as the catalogue states them and the readings are recorded in
`it-2025-source-findings.md`.

No cohort is activated and no account is assigned. Importing attaches a structure; assignment stays a
separate administrator action.

## Verification

Four cases pin the committed file: it reconciles at 150 with its counts, the importer stores it without
assigning anyone, the five external edges carry no member id and keep their alternative groups, and
physical training appears in no block. The verifier reports no blockers, which is the first time a
program with an unallocated elective and an out-of-programme prerequisite has passed.
