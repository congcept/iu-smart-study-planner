# IT Computer Engineering 2025 manifest

The fourth program structure and the second specialisation of one programme. It shares four of its five
blocks with Network Engineering and differs only in the specialised block.

Source: the signed 2025 Information Technology PDF, `4e62d229…7584`, block table pages 6–7, course table
pages 25–34 (Bảng 8) and schedule pages 35–41 (Bảng 10).

## What it reconciles

| Block                    | Declared |       Courses listed |
| ------------------------ | -------: | -------------------: |
| I general education      |       45 |      45 (18 courses) |
| II major foundation      |       35 |              35 (10) |
| III specialised required |       32 |              32 (13) |
| III elective             |       12 | 3 unnamed slots of 4 |
| IV supporting            |        6 |                6 (2) |
| V internship and thesis  |       20 |               20 (3) |
| **Total**                |  **150** |              **150** |

48 courses, 48 placements, 39 prerequisite edges. The specialised block is the only difference from
Network Engineering: electrical circuits, digital system design, embedded systems, micro-processing,
VLSI, signal processing, Internet of Things and artificial intelligence, each lecture paired with its
laboratory as a concurrent edge.

## The rule that resolved the placement question

The schedule prints **ten blocks** while the document says the programme takes **nine semesters**. Ten
blocks cannot be placed into nine terms without either merging two or contradicting the overview, and
the thesis requires the special study that sits in the block before it.

The blocks are separations by kind, not terms. A student sequences their own plan subject to one rule:
**the special study precedes the thesis, and the thesis occupies the final semester alongside whatever
remains.** That rule is what the manifest encodes, and it is the reason the transcriptions here are
defensible rather than arbitrary:

- special study `IT083IU` → year 4 semester 1
- thesis `IT058IU` → year 4 semester 2
- the remaining specialised courses → alongside the thesis

Block eight and the special study share year 4 semester 1, which is why that term carries nineteen
credits. The document specifies no distribution, and this is the one the rule implies.

## The outside requirement

Four requirements read `IT116IU` or `IT149IU`, and `IT149IU` is a Data Science course. Those four edges
name no member, are excluded from the dependency graph, and are satisfied by a completion of that course
in the student's own records — the same rule Network Engineering uses for the same code.

## Readings recorded rather than guessed

- `IT126IU` prints one credit with a **blank lecture cell**, so a reader expecting three numbers skips
  it and the block comes out a credit short. That looked like a document defect and is not.
- `IT091I` appears without its trailing `U` in the Micro-processing prerequisite; read as `IT091IU`.
- The electrical-circuits lecture row prints a concurrent edge naming itself. The pair is recorded once,
  from the laboratory row, because a self-edge is not a constraint.
- The bracket totals disagree with the rows in the same way both other documents' do: block three is
  labelled `17 tín chỉ` and totals 20.

## Verification

Four cases pin the committed file: it reconciles at 150, it imports without assigning anyone, the
special study lands in an earlier slot than the thesis it unlocks, and the four external edges name one
course. The verifier reports no blockers.
