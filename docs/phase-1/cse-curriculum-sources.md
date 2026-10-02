# CSE curriculum source verification

Verified on 2026-10-02. This is a source/extraction gate; IT and DS are not yet seeded or selectable. Preserve the current CS dataset while server-backed progress is completed.

## Authoritative sources

The [IU undergraduate CSE page](https://hcmiu.edu.vn/chuong-trinh-dao-tao/dao-tao-dai-hoc/khoa-cong-nghe-thong-tin/) links signed curricula and approval decisions for both 2024 and 2025 cohorts. Its lower HTML course tables are useful for comparison but do not identify a cohort and differ materially from the signed 2025 documents. Do not combine their placements with a newer cohort's credit totals or prerequisite rules.

| Program | Signed 2025 curriculum                                                                                                             | Signed 2024 curriculum                                                                                                                                 |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| CS      | [Computer Science 2025](https://hcmiu.edu.vn/wp-content/uploads/2026/04/CTDT-K2025-Nganh-Khoa-hoc-May-tinh-Signed_compressed.pdf)  | [Computer Science 2024](https://hcmiu.edu.vn/wp-content/uploads/2025/05/Ho-so-CTDT-Khoa-2024_Nganh-Khoa-hoc-May-tinh_Trang-57-Signed-5_compressed.pdf) |
| IT      | [Information Technology 2025](https://hcmiu.edu.vn/wp-content/uploads/2026/04/CTDT-Khoa-2025_Nganh-Cong-Nghe-Thong-Tin-Signed.pdf) | [Information Technology 2024](https://hcmiu.edu.vn/wp-content/uploads/2025/05/Ho-so-CTDT-Khoa-2024_Nganh-Cong-Nghe-Thong-Tin_Trang-125-Signed-5.pdf)   |
| DS      | [Data Science 2025](https://hcmiu.edu.vn/wp-content/uploads/2026/04/CTDT-khoa-2025-Nganh-Khoa-hoc-Du-lieu-Signed.pdf)              | [Data Science 2024](https://hcmiu.edu.vn/wp-content/uploads/2025/05/Ho-so-CTDT-Khoa-2024_Nganh-Khoa-hoc-Du-lieu_Trang-45-Signed-4_compressed.pdf)      |

All six links were identified in the supplied official page. The IT and DS 2025 PDF bodies were downloaded and inspected; CS and 2024 PDF bodies remain to be reviewed. IT 2025 contains 704 PDF pages including syllabi; its course lists start on pages 8-23, Network Engineering schedule on page 24, and Computer Engineering schedule on page 32. DS 2025 contains 555 PDF pages including syllabi; its course list is on pages 6-10 and schedule/elective rules on pages 11-14. These locators are physical PDF page numbers. Rendered schedule pages confirmed the table column alignment.

## HTML parser verification

The supplied page returned an initial JavaScript cookie challenge. Retrying with the cookie supplied by that response returned the full page (about 266 KB). A scraper must detect a challenge response and fail clearly rather than recording an empty curriculum.

There are seven HTML tables, zero-based below. All course rows have five cells: code, English name, total credits, lecture credits, practice/lab credits. Course codes match the existing CS regex. Year headers use an en dash but include whitespace between the year number and ordinal suffix (`1 st Year` after text normalization), which the current scraper's `1st` regex does not accept. Elective headers include group numbers, which the current generic elective-group regex also misses.

| Table | Meaning                                                 | Course occurrences | Unique codes |
| ----- | ------------------------------------------------------- | -----------------: | -----------: |
| 0     | IT Network Engineering schedule                         |                 45 |           45 |
| 1     | IT Network Engineering elective pool, select 16 credits |                 25 |           25 |
| 2     | IT Computer Engineering schedule                        |                 51 |           51 |
| 3     | IT Computer Engineering elective pool, select 8 credits |                 18 |           18 |
| 4     | CS schedule and elective options                        |                 71 |           56 |
| 5     | DS schedule and elective options                        |                 74 |           49 |
| 6     | Unrelated blank layout table                            |                  0 |            0 |

The table-4 CS code set matches the current nonempty course codes in `scraped-courses.json`, and shared credit values agree. That file also contains a blank-code free-elective placeholder; preserve it as a requirement, never create a global `Course` with an empty code. The current seeded catalog has 56 courses.

The throwaway HTML extraction preserved occurrences, group claims, select counts, GPA branches and placeholders in `/tmp/iu-cse-draft-curricula.json`. Every coded schedule row has five cells, positive integer credits and year/semester within current bounds. These drafts intentionally fail readiness for seeding: prerequisites are unknown, repeated options are retained, and graduation totals cannot be computed by summing all choices. They are temporary research outputs, not application data.

## Attribute mapping using current CS as reference

| Existing CS attribute                          | Safe IT/DS extraction                                                                                                                                                                                                                                    |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id` / DB `Course.code`                        | Literal validated course code; retain source spelling and report unresolved/blank codes.                                                                                                                                                                 |
| `name`, `credits`                              | English name and total credit column. Confirm conflicts against the selected cohort's signed curriculum before global upsert.                                                                                                                            |
| `lectureHours`, `labHours`                     | Existing names actually contain credit units (e.g. 4 = 3 lecture + 1 lab), not contact hours. Preserve compatibility but do not label them as verified hours. PDF syllabi separately provide real workload hours.                                        |
| `year`, `semester`                             | HTML header or PDF semester schedule, attached to `CurriculumCourse`, not global `Course`. Retain summer separately; do not flatten IT's two specializations into one schedule.                                                                          |
| `isElective`, `electiveGroup`, `selectCount`   | Requirement/group membership from surrounding headers. Preserve each placement and membership until choice requirements are modeled. Credit-based groups cannot be represented accurately by a course-count field alone.                                 |
| Prerequisites                                  | HTML has none. Extract signed PDF schedule columns TQ (prerequisite), HT (prior course), SH (concurrent course), retaining source labels. User policy makes every listed relationship mandatory; do not fabricate rules from course names or year order. |
| `difficultyLevel`, category, offered semesters | Existing seed values are heuristics. Keep heuristic provenance; a suggested placement is not proof the university offers a course exclusively in that term.                                                                                              |

Do not reuse the existing scraper unchanged. It scans every table together, resets semester/group context for each table, drops detached elective pools because they have no year header, and collapses multiple placements by course code. This would mix three programs, discard IT options and lose DS selection requirements.

## Reconciliation required before IT/DS seeding

- **Cohort and totals:** the HTML says IT 150, CS 130 and DS 129 credits. Signed DS 2025 page 5 says **124**, excluding physical/military training. Signed IT 2025 pages 5-7 say **150** in both specializations, with **12 elective credits** each, unlike the HTML 16/8 pools. Choose a coherent cohort and validate required credits plus selected elective requirements, excluding physical training; never sum the full elective catalog.
- **DS course identity and credits:** HTML uses `IT097IU` for Principles of Database Management; signed DS 2025 uses `IT079IU`. HTML assigns `IT094IU` three credits; signed DS 2025 pages 10/14 assign four. Signed 2025 also uses `MA033IU` / `MA036IU` for Linear Algebra / Probability and Statistics rather than HTML `IT154IU` / `MA026IU`.
- **Repeated groups:** DS HTML uses group 01 in Y3S2 (select two) and Y4S1 (select one), then a group 02 for the lower-GPA branch. A global deduplication or one select count per code destroys this structure. CS likewise has courses shared across several groups. The current roadmap's one `CurriculumCourse` row per curriculum/course needs an explicit representation for additional group memberships/placements before these sources can round-trip.
- **Branch rules:** DS HTML contains a GPA fork; signed DS 2025's schedule lists Thesis as required and does not reproduce that HTML fork on pages 11-14. Do not copy the current CS 41/43-course targets or GPA behavior into DS/IT.
- **Prerequisite context:** current CS seed requires `IT116IU` before `IT069IU`; signed DS 2025 page 11 requires `IT149IU` before `IT069IU`. Blindly unioning these edges in the global prerequisite table would block students in either major. Keep global courses (D1) while retaining curriculum/cohort context for differing requirements.
- **Source inconsistencies:** signed DS 2025 page 11 prints `T149IU` in a Linear Algebra prerequisite; page 12 still references `MA026IU` in some prerequisites despite the 2025 catalog using `MA036IU`. Signed IT page 24 combines `EN008IU + EN007IU` into one four-credit schedule cell and shows a stated semester total differing from the individual rows. Preserve these as review findings; do not silently fix codes or split credits without matching the catalog and syllabus.

Next curriculum slice: implement a reusable verifier and saved source manifest, resolve the selected cohort's inconsistencies, then add additive global-course/per-curriculum placement migrations. A major selector should ship only when switching majors renders a validated isolated dataset and preserves each student's progress.
