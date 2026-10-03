# Atomic legacy CS reference backfill

The explicit backfill stores the existing CS HTML reference in the additive curriculum
tables. It is an internal preparation step; active app readers still use the legacy
catalog and JSON grouping. It does not assign students or enable a major selector.

Inspect before applying:

```bash
npm run inspect:cs-backfill --workspace=server
npm run backfill:cs-reference --workspace=server -- --apply
```

Both commands accept an optional source file. The writing command rejects calls without
`--apply`; its default file works from source or compiled output independently of the
working directory. Existing global courses must match source codes, exact names and credits.

The Serializable transaction creates `CS-REFERENCE` with unknown total credits, links existing
global course IDs, and preserves every occurrence, elective group/count, uncoded requirement
and legacy prerequisite flag. The confirmed application GPA fork is recorded; it is not a
signed-cohort eligibility claim. Source bytes and the consistent legacy prerequisite snapshot
are hashed in provenance labels. Lecture/lab credit units remain in the unchanged JSON and
verification output; the placement schema has no fields for those units.

Identical reruns preserve IDs and timestamps and insert nothing. Missing matching context rows
can be repaired atomically; differing metadata, source hashes, placements, requirements,
edges or extra rows abort without overwrite or deletion. Concurrent identical runs retry
serialization/uniqueness races at most three times. Global catalog fields, grade attempts,
ratings, progress and account assignments are never written.

Local compiled-CLI verification preserved all nine legacy-table fingerprints, inserted
56 memberships, 71 placements, one three-credit free-elective requirement and 21 existing
prerequisite edges, and changed nothing on the second run. Sixteen PostgreSQL cases cover
preservation, rollback, conflict rejection, missing-row repair and concurrency. Shared-first
build, typecheck, zero-warning lint and all 494 server / 310 client tests pass for the isolated
snapshot. Review was performed inline after the earlier subagent thread limit.

This preserves legacy evidence rather than verifying institutional prerequisites or source
cohort. `readyForActivation` stays false; the 130/131 modeled path totals remain unresolved.
Next implement isolated context reads and rating priors, then completion/import/cascade and
planner/recommendation context handling. Reconcile signed IT/DS sources before seeding or
exposing a selector. Do not union prerequisites across curricula.
