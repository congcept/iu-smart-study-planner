# Additive curriculum foundation

This is the first storage migration for curriculum context. It creates empty context tables
and a nullable user assignment; it does not switch existing readers or seed another major.

- Curriculum stores program metadata and optional provenance/verified total. Unknown totals
  remain null rather than inventing a common legacy graduation total.
- CurriculumCourse is unique per curriculum/global Course identity.
- CurriculumPlacement stores every occurrence, including repeated elective groups and source
  order. One membership cannot preserve the current 71 coded CS appearances of 56 unique codes.
- CurriculumPrerequisite uses two composite membership foreign keys so both courses belong to
  the specified curriculum. Legacy strict/corequisite flags are retained as provenance; all
  relationships remain mandatory under the confirmed policy when contextual readers activate.
- User.curriculumId defaults to null and clears when its curriculum is removed. Context rows
  cascade toward membership/placement/edges while global courses and student evidence survive.

SQL CHECK constraints enforce nonnegative nullable totals/source order, positive nullable year
and selection count, and semester 1–3. Legacy Course placement columns, global prerequisites,
indexes, student records, grades, votes and study plans are preserved. Apply with Prisma
migrate deploy, then regenerate Prisma before reloading a server using the new client.

The populated local migration preserved fingerprints of all nine existing data tables. The
complete migration history passed in a fresh disposable database. Ten real PostgreSQL cases
cover memberships, duplicate placements, both endpoint contexts, separate prerequisite sets,
assignment clearing, cascade direction and SQL domains. Complete gates pass with 437 server
and 310 client tests; independent source review found no blocking issue.

## Backfill gate

Use checked-in source occurrences rather than copying legacy DB placement fields: seed.ts
keeps the first year/semester but overwrites elective metadata on later appearances. The blank
Free elective is a three-credit requirement, never an empty-code Course. Its representation,
idempotent CS backfill, source readiness, contextual readers, priors and major selector remain
separate increments. Current CS is a legacy reference with inferred prerequisites, not a
verified signed 2025 curriculum. Preserve its reported 130/131 path-total discrepancy.
