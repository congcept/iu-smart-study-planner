# IT and DS 2025 source evidence

**Checked:** 7 November 2026. This is a source/extraction note, not an activation. No IT or DS
curriculum is seeded, assigned or selectable, and no reader falls back to these sources yet.

## Sources retrieved

The CSE page serves a JavaScript cookie challenge instead of the PDF on the first request. The
challenge body sets `D1N=<hash>` and reloads; replaying the request with that cookie returns the
real document. A scraper must detect the 177-byte HTML body and stop, not record an empty
curriculum.

| Program | Document                                              |      Bytes | SHA-256                                                            |
| ------- | ----------------------------------------------------- | ---------: | ------------------------------------------------------------------ |
| IT      | `CTDT-Khoa-2025_Nganh-Cong-Nghe-Thong-Tin-Signed.pdf` | 12,407,685 | `4e62d2293da6fc6310aeb4ffa3f72c2826de901ae8ade6e32beb7dac01b97584` |
| DS      | `CTDT-khoa-2025-Nganh-Khoa-hoc-Du-lieu-Signed.pdf`    |  5,357,407 | `e911cb8a6efb80b7636127fcc030f86895c638b30f742ee73692525ce502ddc7` |

URLs are recorded in `docs/phase-1/cse-curriculum-sources.md`. Both carry a 04 September 2025
decision stamp. The DS document is 20 pages in this copy (curriculum only); the IT document is 704
pages and includes syllabi.

Neither PDF is committed. The hashes above are the evidence that the extraction below refers to
these exact documents.

## What the DS document states

| Item                | Value                                                                                      |
| ------------------- | ------------------------------------------------------------------------------------------ |
| Total credits       | **124** (excluding physical education and defence education)                               |
| General education   | 38 required                                                                                |
| Major foundation    | 27 required                                                                                |
| Specialised         | 43 = 32 required + **11 self-chosen** in the structure table, **7** in the change appendix |
| Internship / thesis | 16 required                                                                                |
| Physical training   | PT001IU, PT002IU, 3 credits each, excluded from the total                                  |

Resolved by the document itself (Appendix 1, "2025 vs 2024"):

- Total reduced **129 → 124**.
- DS elective group reduced **11 → 7 credits**.
- `IT154IU` Linear Algebra (3) replaced by **`MA033IU`** (3).
- `MA026IU` Probability, Statistics and Random Process (3) replaced by **`MA036IU`** (3).
- Statistical Learning (4) reduced to 3 and renamed **Algorithmic Statistics `IT176IU`**.

Course identities are `IT079IU` for Principles of Database Management (not `IT097IU`), and
`IT094IU` is **4 credits** (3 lecture + 1 lab). First programming course is **`IT149IU`
Fundamentals of Programming**, not CS's `IT116IU`/`IT064IU`.

The DS schedule is nine entries (I–VIII plus Summer) and states prerequisites in three kinds:
**TQ** (tiên quyết, prerequisite), **HT** (học trước, must be taken before) and **SH** (song hành,
concurrent). Thesis `IT058IU` requires `IT083IU` as TQ, and carries credit-count conditions
(79 credits for `IT083IU`, 103 for Thesis) that are eligibility gates, not course prerequisites.

**There is no GPA fork in the signed DS document.** Thesis is required and there is no
lower-average alternative branch. The GPA fork in the HTML page is not reproduced here, and the CS
reference targets must not be copied into DS.

### Internal inconsistencies in the DS document

These are recorded, not repaired:

| Location             | Statement                          | Conflict                                    |
| -------------------- | ---------------------------------- | ------------------------------------------- |
| Table 5 (structure)  | DS electives 11 credits            | Appendix 1 and Table 7 both say 7           |
| Table 8, `IT151IU`   | prior course `MA026IU`             | `MA026IU` was replaced by `MA036IU` in 2025 |
| Table 8, `MA033IU`   | prior courses `MA001IU`, `T149IU`  | `T149IU` is a typo for `IT149IU`            |
| Table 9, semester II | lists `IT154IU` for Linear Algebra | replaced by `MA033IU`                       |

The consistent reading is the change appendix, which is the document's own statement of what
changed. Any importer must therefore treat the structure table as descriptive and the appendix as
authoritative where they disagree.

## What the IT document states

IT has **two specialisations**, each a 150-credit program:

| Block               | Network Engineering              | Computer Engineering             |
| ------------------- | -------------------------------- | -------------------------------- |
| General education   | 45 required                      | 45 required                      |
| Major foundation    | 35 required                      | 35 required                      |
| Specialised         | 32 required + **12 self-chosen** | 32 required + **12 self-chosen** |
| Supporting          | 6 required                       | 6 required                       |
| Internship / thesis | 20                               | 20                               |
| **Total**           | **150**                          | **150**                          |

The HTML page's elective pools of 16 and 8 credits are **not** the signed rule; both specialisations
state 12 self-chosen credits. The general framework table (Bảng 6) is identical to DS and to the
common Toán–Tin group, which is why courses such as `MA001IU`, `MA033IU`, `MA036IU`, `IT069IU`,
`IT079IU` and the four English courses appear in all three programs.

Course-table extraction (Bảng 7 and Bảng 8, pages 9–23):

| Table                | Rows | Unique codes | Summed credits |
| -------------------- | ---: | -----------: | -------------: |
| Network Engineering  |   65 |           65 |            233 |
| Computer Engineering |   74 |           74 |            252 |

No shared course between the two tables carries a different credit value. The sums exceed 150
because each table lists every option in its elective pool, not the 12 credits a student takes.

Not yet extracted: the per-semester schedules (Bảng 9, Bảng 10), which carry the prerequisite
columns and the actual elective slots. Those are the next step and are required before any import.

## Blocking model question

Every elective pool in these documents is stated in **credits** — "select 12 credits", "select a
minimum of 7 credits". The schema stores `CurriculumPlacement.electiveSelectCount`, which counts
**courses**.

The two are only interchangeable when every option in the pool has the same credit value. In the DS
pool that is false: `IT120IU` and `IT153IU` carry 3 credits while the other thirteen options carry 4. A 7-credit requirement therefore cannot be expressed as a course count without silently changing
what the document requires.

**Decided 7 November 2026:** add a nullable `electiveSelectCredits` to `CurriculumPlacement` in an
additive migration. Placements keep `electiveSelectCount`; a pool stated in credits populates the
credit field instead, and readers sum member credits rather than counting rows. The count field stays
for sources that state a course count, so the CS reference import is unaffected.

## Standing gates

- The signed PDFs are the authority where they disagree with the HTML page. The HTML page is a
  comparison aid only.
- Physical training is excluded from credit totals and from the grade average.
- No cohort is activated by an import. Readiness stays false until prerequisites, elective rules and
  totals are reconciled and reviewed.
- Programme identity stays global; placement, prerequisites and elective rules stay per program.
  IT therefore becomes two program contexts sharing one course catalogue, not one program with a
  specialization flag.
