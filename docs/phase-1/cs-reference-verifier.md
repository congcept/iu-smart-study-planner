# CS legacy reference verifier

Run `npm run verify:cs-reference --workspace=server` to read the checked-in
scraped-courses.json and print a normalized JSON report. An optional absolute source-file
argument is supported after `--`. The compiled server/dist/scripts/verifyCsReference.js also
resolves the repository source correctly from another working directory. No database connection,
source rewrite, seeding or API activation occurs.

The verifier is scoped to the current legacy CS HTML format. It rejects malformed slots/rows,
unknown attributes, invalid codes, unsafe/fractional numbers, inconsistent credit units, mismatched
parent placement, conflicting global names/credits, duplicate same-slot/group appearances and
invalid elective selection counts. Identical course identities in different groups/slots remain
separate placements with stable global source order. The blank Free elective is an explicit
requirement; it never becomes an empty-code Course.

The current report preserves 72 source rows, 71 coded placements, 56 global identities, 15 repeat
appearances, one three-credit requirement and three elective groups. The report labels provenance
LEGACY_HTML_REFERENCE, includes a SHA256 of exact raw bytes and keeps readiness false. Structural
validation exits zero; invalid/missing input exits one with a path-specific error and no report.
Structural success is not proof of an institutionally verified curriculum or seed readiness.

The portable saved manifest in cs-reference-manifest.json records the same source hash, counts,
requirements, exact group claims and reconciliation blockers. Legacy lectureHours/labHours contain
credit units, not verified contact hours. Catalog option credits are not graduation credits.
No GPA rules, prerequisites, cohort or IT/DS readiness are inferred.

Twenty pure regressions include the checked-in source, deeply frozen inputs, repeated placements,
blank requirements, schema/domain failures and selection inconsistencies. Default and compiled
CLI checks cover valid, malformed, empty and missing files. Complete gates pass with 457 server
and 310 client tests. Code and tests were implemented by separate agents; final source review was
performed inline after the subagent thread limit prevented another independent reviewer.

Next: add free-elective requirement storage, then an explicit idempotent legacy CS backfill that
resolves every code against existing global rows and preserves provenance. Continue signed-source
reconciliation and activate context readers together before exposing another major.
