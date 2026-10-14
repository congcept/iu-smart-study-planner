# Persisted semester verification CPU profiling

This companion to [allocator profiling](semester-allocation-profile.md) measures the actual
saved V1 verifier and public projection functions with synthetic decoded records. These
functions now live in a database-independent module, re-exported by their original service
modules. Their validation/projection bodies, authorization call sites and database queries
are preserved. The profiling path imports neither database initialization nor startup
configuration.

## Run

From the repository root, build shared and server output, then run:

```bash
rtk npm run build:server
rtk npm run --silent semester-allocation:profile-stored --workspace=server
```

For raw JSON, invoke `node server/dist/scripts/profileStoredSemesterVerification.js` after
building, with the normal `rtk proxy` prefix in this development environment.

```text
--scenario all|reference|max-students|max-rounds|max-catalog|scarce|missing-resources
--samples 1..10          default 1
--warmup 0..3           default 0
--timeout-ms 1000..120000  default 120000 for each entire scenario child
```

The selected scenario matrix matches the allocator tool. Each scenario runs in its own
supervised child, with a 512 MiB V8 old-space limit. This does not cap total process memory.
Timeout covers fixture generation, copying, all samples and digest checks. Accepted options
are bounds, not a promise that every repetition count finishes within the deadline.
Timeout/failure reports exit nonzero. SIGINT/SIGTERM and normal supervisor exit terminate
the current child; a forcibly SIGKILLed parent cannot perform JavaScript cleanup.

Defaults intentionally collect one observational sample, without an excluded warmup. A
single sample is not a statistical performance estimate; min/median/max coincide.

## Timed stages

Each sample performs seventeen complete saved-result verifications:

| Report field            | Included work                                                                                | Complete replays |
| ----------------------- | -------------------------------------------------------------------------------------------- | ---------------: |
| `singleRunMs`           | Saved run, metadata, participant/result consistency                                          |                1 |
| `adminProjectionMs`     | Saved run verification, then private-free admin projection                                   |                1 |
| `ownProjectionMs`       | Saved run verification, then selected participant projection                                 |                1 |
| `jobOutcomeMs`          | Actual successful job outcome validation, including its linked run                           |                1 |
| `initialHistoryMs`      | Six request/outcome pair verifications including lookahead, then strict five-row public page |                6 |
| `continuationHistoryMs` | Cursor verification plus six request/outcome pairs, then strict five-row public page         |                7 |

The projection intervals include full verification; they are not projection-only costs.
History uses the same request/outcome pair helper as the database-backed reader. It exercises
successful, fully populated records; pending/failed history performance is not measured.

Fixture construction, pinned V1 compatibility checks, JSON cloning and digest calculation
are outside each reported interval. Seven independent decoded JSON result containers are
retained per child. This memory arrangement is synthetic and does not represent PostgreSQL
or Prisma materialization. Before/after heap/RSS are samples, not measured peaks.
Inputs must remain unchanged and all repeated output fingerprints must agree. Raw reports
contain aggregate dimensions, byte sizes and hashes, not account/course identities.

## Recorded observation — October 15, 2026

[Raw JSON](semester-stored-verification-profile-2026-10-15.json) records Node v25.2.1,
macOS arm64, Apple M2, 8 logical CPUs. All six children completed with one sample each
and no excluded warmup. Quality gates in this chat completed before measurement; unmanaged
background activity is not controlled. These are local observations, not timing thresholds.

| Scenario          | Single run (ms) | Admin including verification (ms) | Own including verification (ms) | Job outcome (ms) | Initial history (ms) | Continued history (ms) |
| ----------------- | --------------: | --------------------------------: | ------------------------------: | ---------------: | -------------------: | ---------------------: |
| reference         |            1.93 |                              1.02 |                            1.14 |             0.98 |                11.35 |                   5.05 |
| max-students      |         1698.29 |                           1728.06 |                         1724.55 |          1698.29 |             10581.64 |               12143.40 |
| max-rounds        |         1719.65 |                           1699.11 |                         1764.11 |          1719.23 |             10359.38 |               12335.32 |
| max-catalog       |         2492.64 |                           2398.88 |                         2300.36 |          2327.38 |             14467.54 |               17746.80 |
| scarce            |           48.93 |                             39.81 |                           56.57 |            43.67 |               266.64 |                 285.73 |
| missing-resources |            1.41 |                              0.79 |                            1.23 |             0.71 |                10.08 |                   3.75 |

Actual compiled 1-second deadline and SIGINT/SIGTERM checks passed, with expected
nonzero exit statuses and no surviving child. Eighteen new pure tests cover saved-record
consistency, privacy, corruption, six-row lookahead, continued history and immutable inputs.
Profile-only production build/types/lint and 2,769 PostgreSQL / 1,910 client tests pass; a
fresh combined candidate against the later UI merge also passes all quality gates.

## Limits and next evaluation

These are CPU observations of actual verification functions, not HTTP or database latency,
worker/capture timing, authorization, lock/retry duration or a mathematical lower bound for
those paths. No database operations or academic writes occur. No model/schema, transaction
budget, eligibility policy or curriculum activation is changed. Full database-backed capture,
worker and history measurements remain necessary before changing supported bounds or
transaction limits. Prerequisites, official curriculum, calendar, staff/lab and deployment
gates remain open.
