# Curriculum manifest import

This writes a verified manifest into a curriculum. It is the first thing that turns the source work
into data, and it refuses to do so unless the verifier is satisfied.

```bash
cd server && npm run import:curriculum-manifest -- --check ../docs/phase-1/ds-2025-manifest-proposed-readings.json
cd server && npm run import:curriculum-manifest -- --apply ../docs/phase-1/ds-2025-manifest-proposed-readings.json
```

`--check` verifies and reports what _would_ be written; `--apply` writes it. Both refuse an
unverified manifest, and the write refuses to run in production.

## What it writes

One transaction creates or updates the curriculum, records the cohort that governs it, upserts the
courses globally by code, then replaces that curriculum's memberships, placements, requirements and
prerequisite edges wholesale. Replacing rather than patching means a rerun converges on the
manifest, so a corrected transcription leaves no stale placement behind instead of accumulating
duplicates.

The prerequisite rows now carry the document's own label — `TQ`, `HT` or `SH` — and an optional
`alternativeGroup`. Both are additive nullable columns with check constraints. Preserving the label
matters because the three mean different things even though every edge is mandatory, and an
alternative group is the only honest way to record "IT116IU or IT149IU".

## What it refuses

| Refusal                                            | Why                                                                           |
| -------------------------------------------------- | ----------------------------------------------------------------------------- |
| A manifest that fails verification                 | No partial import exists; the blockers come back in the error                 |
| A course whose credits disagree with the catalogue | A shared course is global, so a conflict is a contradiction, not an overwrite |
| Running in production                              | The same guard the demonstration scenario uses                                |

## What it does not do

**It assigns nobody.** `users.curriculum_id` is untouched, so importing a cohort's structure cannot
silently move a student onto it. Assignment stays a separate, deliberate administrator action.

It also validates nothing: no graduation rule, no elective rule, no calendar. The curriculum row it
creates still carries `totalCredits` from the document and no readiness claim.

## Verified end to end

Seven real-PostgreSQL cases: an unverified manifest is refused before any write; `--check` reports
without writing; the apply writes 50 memberships, 50 placements, 1 requirement and 32 prerequisite
edges for Data Science at 124 credits, with its `K2025` cohort; the source labels survive (`HT` and
`TQ` both present) and the fifteen pool options keep their seven-credit declaration with no course
count; no account is assigned; a rerun converges rather than accumulating; and a manifest whose
credits contradict the catalogue is refused with `409`.

The command was also run against a disposable database: `--check` then `--apply` produced
`DS | 124 | 50 memberships | 1 cohort`, and the row was removed afterwards so the database stayed
neutral for later suites.

## Applied to the development database

Data Science `K2025` is now imported into the local development database, which is what exercises the
whole chain outside tests: signed PDF, transcription, verifier, importer, database, public reader.

| Program        | Credits |     Cohorts | Members | Assigned |
| -------------- | ------: | ----------: | ------: | -------: |
| `CS-REFERENCE` | unknown |           0 |      56 |        0 |
| `DS`           |     124 | 1 (`K2025`) |      50 |        0 |

Read back through `GET /api/curricula/:id` rather than by querying tables: 50 courses, 32
prerequisite edges (31 `HT`, 1 `TQ`), one four-credit free-elective requirement at year 3 semester 2,
and fifteen pool options each declaring seven credits with no course count. The catalogue grew from
56 to 74 courses, because eighteen Data Science identities were not previously seeded.

**Nobody is assigned**, so the demonstration still starts exactly as documented. To reverse it:

```sql
DELETE FROM curriculums WHERE code = 'DS';
```

That removes the cohort link, memberships, placements, requirements and prerequisite edges by
cascade; the global courses remain, which is correct, because courses are global.
