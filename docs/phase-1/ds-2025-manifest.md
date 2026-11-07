# DS 2025 curriculum manifest

A row-by-row transcription of the signed Data Science 2025 curriculum, checked by arithmetic rather
than trusted. Source: the PDF recorded in `ds-2025-manifest.json` (`source.sha256`
`e911cb8a…ddc7`), course table on pages 7–11 and schedule on pages 11–14.

## What it contains

| Measure             | Value                                                                                          |
| ------------------- | ---------------------------------------------------------------------------------------------- |
| Courses             | 50                                                                                             |
| Placements          | 50 (35 scheduled, 15 pool options)                                                             |
| Blocks              | 4 — general 38, foundation 27, specialised 32 required + 11 elective, internship and thesis 16 |
| Elective allocation | 11 = 7-credit pool + 4-credit free-elective requirement                                        |
| Prerequisite edges  | 32, labelled `TQ`, `HT` or `SH` as the document prints them                                    |
| Excluded            | PT001IU and PT002IU, 3 credits each                                                            |

The block sums reproduce the document's own totals: 38, 27, 32 and 16, giving **124** with the
elective allocation.

## Two files, on purpose

`ds-2025-manifest.json` is **faithful**. It contains `T149IU` in the prerequisite list for `MA033IU`
and `MA026IU` for `IT151IU`, exactly as the document prints them. The verifier rejects it: `T149IU`
is not a valid IU course code, so the manifest fails the shape check at `prerequisites.2.prerequisite`.

`ds-2025-manifest-proposed-readings.json` is the same transcription with **two substitutions**:

| Printed   | Read as   | Basis                                                                                                                           |
| --------- | --------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `T149IU`  | `IT149IU` | A typographical slip for the programming course; `MA033IU`'s other prior course is `MA001IU`, and the catalogue has no `T149IU` |
| `MA026IU` | `MA036IU` | The document's own change appendix records that `MA026IU` was replaced by `MA036IU` for 2025                                    |

With those two readings the manifest is self-consistent: **124 declared, 124 from blocks, 113
required, 11 elective**, and the verifier reports no blockers.

The substitutions are not repairs made silently. Both files are committed, the difference is exactly
two prerequisite codes, and the faithful file stays in the repository so the defect remains visible.

## What this proves and what it does not

It proves the transcription is arithmetically sound and internally consistent under one stated
reading. It does **not** prove the reading is the school's intent. `IT154IU` was likewise replaced by
`MA033IU` in 2025, and the document's own Table 9 still shows `IT154IU`; that table is not
transcribed here because it is a curriculum-outcome matrix, not a schedule.

Three questions remain for the school, and no manifest should be imported until they are answered:

1. Is `T149IU` in `MA033IU`'s prior-course list a slip for `IT149IU`?
2. Is `IT151IU`'s prior course `MA036IU` (2025) or `MA026IU` (the pre-2025 code the schedule still prints)?
3. Is Table 9's `IT154IU` a stale label for `MA033IU`, or does an equivalent-course arrangement apply?

## A note on elective placements

The pool is transcribed with no academic year or semester, because the document lists the 15 options
without one. The schedule shows where the elective _slots_ sit — 4 credits in semester V and 3 in
semester VI — but those slots name no course. Modelling them as placements would invent a calendar
position for a course the student has not chosen, so the pool is placed at neither, and the
free-elective requirement keeps its semester VI position.

## Verification

Four cases in `dsManifest.test.ts` keep the two files honest: the faithful one is rejected with the
exact issue and path, the proposed-readings one is accepted with its credits and counts, the 11
credits split as 7 plus 4, and physical training appears in neither block's required courses.

The commitment is deliberate: if either file drifts, the suite fails rather than an import silently
changing shape.
