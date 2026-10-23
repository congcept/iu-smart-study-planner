# CS 2025 catalog evidence and comparison

This is a read-only source-review tool, not a curriculum import or activation. It keeps the
legacy CS reference unchanged and does not choose a cohort for any account.

## Reviewed artifact

The [official CSE curriculum page](https://hcmiu.edu.vn/chuong-trinh-dao-tao/dao-tao-dai-hoc/khoa-cong-nghe-thong-tin/)
links the [CS 2025 PDF](https://hcmiu.edu.vn/wp-content/uploads/2026/04/CTDT-K2025-Nganh-Khoa-hoc-May-tinh-Signed_compressed.pdf).
Retrieved on 2026-10-18 after a public literal-cookie challenge retry, it contains
11,072,162 bytes and 576 physical PDF pages. SHA256:
`00dc4476c314b80324b53f85fc5ead94e7f89350b93dd2b96e76d642ca160c9b`.
The PDF itself is not committed.

The cover identifies Computer Science, program 7480101, cohort 2025. Its accompanying decision
number is blank. Page 37 visibly contains a dean signature and a printed vice-rector name;
no cryptographic signature or complete approval-authenticity verification was performed.
The word Signed in the filename and a matching hash do not establish those properties.

Locators here and in the manifest are one-based physical PDF pages. The reviewed scope covers
the complete Table 6 catalog (pages 7–11), reference Table 7 schedule (12–18), cover/credit totals
(1/6), selected course summaries (25/29/36), signature page (37) and change appendix (38–39).
It does not cover every syllabus or all 576 pages for policy completeness. Page 12 has no printed
page number; appendix physical page 39 is printed page 2.

## Portable catalog snapshot

[cs-2025-catalog-evidence.json](cs-2025-catalog-evidence.json) retains 57 distinct coded Table 6
identities with literal credits and page locators. The blank-code, three-credit Free Elective
(row 54, page 11) remains a separate requirement. The file intentionally does not define names,
placements, prerequisite graphs, substitutions, elective selection counts or a GPA fork.
Those need separate reconciliation rather than copying legacy attributes by course-code similarity.

The current legacy reference contains 56 identities and 71 coded placements. Exact comparison
finds 52 shared codes with matching credits. Five catalog codes are absent from the legacy
reference: IT131IU, IT175IU, MA033IU, MA036IU and PE008IU. Four legacy codes are absent from this
catalog: IT044IU, IT154IU, IT168IU and MA026IU. These are differences in source membership,
not authority to delete global courses, replace codes or rewrite history. Catalog-option credit
sums do not represent graduation requirements.

Pages 6/11 state 126 graduation credits excluding physical/military education; the existing
legacy reference uses 130. This is a stated source total, not a newly computed degree rule.
Page 18 lists a required ten-credit Thesis without the legacy HTML GPA branch in that table.
No conclusion about all external graduation regulations follows from this bounded review.

## Run the offline inspection

After saving the exact official PDF locally:

```bash
npm run inspect:cs2025-catalog --workspace=server -- /path/to/CS-2025.pdf
# Or, after a production build, from any working directory:
node /absolute/repository/server/dist/scripts/inspectCs2025Catalog.js /path/to/CS-2025.pdf
```

One PDF argument is required. The tool reads the committed manifest and legacy JSON relative
to its own source/compiled location, rejects a different byte length/hash, validates both catalog
structures, and prints deterministic code/credit differences plus source hashes and blockers.
Missing/malformed inputs exit one without a successful report. It does not fetch sources,
connect to a database, load application configuration, seed, update source files or assign users.

A successful report always has `sourceBodyHashMatched: true`, `signatureVerified: false` and
`readiness: false`. The runtime checks the artifact hash and the manually reviewed manifest's
structure; it does not re-extract PDF tables, independently prove their transcription, reconcile
academic policy or authenticate signatures. The manifest is deliberately specific to this
reviewed artifact; a replacement PDF requires a new source review and intentional code/data update.

## Reconciliation blockers

- Pages 12–15 contain OR alternatives, prerequisite codes absent from the catalog (including
  IT067IU), and PH015IU/PH016IU mutual SH relationships. Flattening these into completed-before
  edges under the user's mandatory-prerequisite policy would change source logic or create a cycle.
  MA033IU uses same-slot MA003IU in page 12 while page 25 names Calculus 1 instead.
- The catalog minimum 11 elective credits (pages 9/11), free-elective requirement and reference
  schedule labels (15–18) need reconciliation. Page 17 asks for a four-credit elective while
  page 18 includes three-credit PE008IU in that block. Preserve raw source statements.
- Catalog, schedule, course summaries and appendix disagree on some names, prerequisites,
  required/elective status, credits or placements. Examples include MA033IU's reversed language
  columns (8), IT175IU's different Vietnamese labels (10/17), IT120IU status (11/16/36),
  IT083IU/Thesis prerequisites (18/36), Operating Systems prerequisites (16/29), and appendix
  changes that disagree with the schedule (12–18 versus 38–39). No precedence is inferred.
- Cohort selection, approval authenticity and graduation/GPA policy remain unresolved. Do not
  activate this candidate, import a prerequisite graph or assign accounts from this evidence.

Resolve these source/policy questions before adding placements and a degree validator. IT/DS
verification and assignment remain separate. Existing grades, progress and curricula are untouched.

## Verification

Pure tests cover identity/credit differences, repeated legacy placements, deterministic ordering,
immutable inputs, malformed/duplicate rows, page/credit bounds, altered artifact identities,
missing free-elective/blocker evidence and incorrect/truncated PDF bytes. A local CLI check against
the actual reviewed PDF exercises both source and compiled entry points with identical output,
including a different working directory and invalid application configuration to verify isolation.
