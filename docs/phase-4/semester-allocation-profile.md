# Reproducible semester simulation profiling

The profiling command evaluates fixed synthetic workloads using compiled production output.
It does not connect to PostgreSQL, inspect accounts, load environment policies or official
curricula, write simulation records, or change the pinned allocation model. Each fixture
captures the default allocation weights explicitly and uses generated synthetic UUIDs.

## Run

From the repository root:

```bash
rtk npm run build:server
rtk npm run --silent semester-allocation:profile --workspace=server
```

The command emits a JSON report. To collect raw JSON without npm/RTK output filtering, invoke
`node server/dist/scripts/profileSemesterAllocation.js` directly after building; use the
normal `rtk proxy` prefix in this development environment. Supported arguments:

```text
--scenario all|reference|max-students|max-rounds|max-catalog|scarce|missing-resources
--samples 1..10       default 3 measured samples
--warmup 0..3        default 1 excluded warmup
--timeout-ms 1000..120000   default 60000 for the entire scenario child
```

Unknown, duplicate, missing, signed, decimal and out-of-range options reject. Defaults run
all scenarios sequentially, each in its own child process. The timeout covers fixture
construction, warmups, measured repetitions and reversed-input verification; it is a local
operator guard, not a database transaction or individual-allocation latency guarantee.
Failed/timed-out scenarios are recorded and make the command exit nonzero. SIGINT/SIGTERM
and normal supervisor exit terminate the active child. A forcibly SIGKILLed supervisor
cannot run JavaScript cleanup; this tool does not promise cleanup for that OS case.

## Scenario matrix

| Scenario          | Students |         Catalog | Choices per student | Total choices | Credits / target | Sections × seats |
| ----------------- | -------: | --------------: | ------------------: | ------------: | ---------------- | ---------------- |
| reference         |       12 |               8 |                   4 |            48 | 3 / 9            | 8 × 12           |
| max-students      |      500 |       20 shared |                  20 |        10,000 | 0 / 30           | 20 × 500         |
| max-rounds        |      100 |      100 shared |                 100 |        10,000 | 0 / 30           | 100 × 100        |
| max-catalog       |      500 | 10,000 disjoint |                  20 |        10,000 | 0 / 30           | 10,000 × 1       |
| scarce            |      500 |       20 shared |                  20 |        10,000 | 3 / 18           | 4 × 10           |
| missing-resources |       12 |               8 |                   4 |            48 | 3 / 9            | unknown          |

Zero-credit workloads use positive targets so they exercise actual allocation and twenty
or one hundred rounds, rather than exiting immediately at target zero. Disjoint choices
exercise every catalog course and the maximum section ledger. These are selected supported
shapes, not an exhaustive worst-case search or an official semester policy.

## What is measured and verified

Allocation timing includes input validation, greedy allocation, output validation and its
internal deterministic replay. Result serialization is timed separately. Additional replay
timing includes JSON parsing, another strict internal result replay and aggregate-summary
calculation. It does **not** measure the distinct persisted `SemesterAllocationResultV1Schema`,
database transactions, capture/worker execution, or a multi-record history page.

Every measured result must agree with independently expected assignment/round/stop counts.
Linear checks independently reconcile supplied choices, unique student/course and round
pairs, course credits/demand, full roster/catalog, student budgets and shared seat/section
totals. Strict replay remains in addition to these checks. Input digests detect mutation;
result digests must match across warmups, measured repetitions and a reversed-input run.
Digest and independent checks are outside the reported allocation/replay intervals.

The report contains raw milliseconds, minimum/median/maximum and sample counts, serialized
result byte size, aggregate outcomes and SHA-256 digests. It does not expose student/course
identities or pretend that supplied choices establish eligibility. Node/platform/architecture
and CPU metadata identify the measurement environment. Heap-used/RSS before and after are
samples, not peak memory. Each child uses a 512 MiB V8 old-space limit; this is not a total
heap, RSS or process memory cap.

## Evidence and remaining work

Recorded run: [raw JSON](semester-allocation-profile-2026-10-13.json), October 13, 2026,
Node v25.2.1 / macOS arm64 / Apple M2 / 8 logical CPUs. Three measured samples follow one
excluded warmup in each separate child. No quality tests ran concurrently with measurements.

| Scenario          | Allocation median (ms) | Allocation min–max (ms) | Additional replay median (ms) | Assignments / rounds |
| ----------------- | ---------------------: | ----------------------: | ----------------------------: | -------------------- |
| reference         |                   1.40 |               0.81–1.51 |                          0.57 | 36 / 3               |
| max-students      |                3641.22 |         3451.57–3901.31 |                       1740.53 | 10,000 / 20          |
| max-rounds        |                3380.54 |         3356.67–3507.85 |                       1681.27 | 10,000 / 100         |
| max-catalog       |                4842.81 |         4681.62–4857.76 |                       2502.32 | 10,000 / 20          |
| scarce            |                  71.72 |             71.27–72.49 |                         36.57 | 40 / 1               |
| missing-resources |                   0.79 |               0.31–1.07 |                          0.40 | 0 / 0                |

All six children completed within the configured per-scenario deadline. Repetitions and
reversed inputs produced matching digests; independent expectations and accounting passed.
The largest serialized internal result is 6,052,373 bytes. A separate actual 1-second deadline
run reports TIMED_OUT and exits nonzero; actual SIGINT/SIGTERM checks leave no child running.

The dated accompanying JSON and AGENTS checkpoint record the actual local run and quality
gates. Timings are observations on that machine with three samples; there is no timing
threshold in CI and no claim that every supported workload fits a worker transaction.
Mean supplied utility is descriptive, not a comparison with a heuristic baseline or proof
of fairness/optimality. Official eligibility, timetable, staff/lab and curriculum gates remain
open. Next evaluation should measure complete persisted replay/capture/worker/history paths
at supported bounds before changing worker limits or expanding the model.
