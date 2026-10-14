import { cpus } from 'node:os';
import {
  PROFILE_SCENARIOS,
  parseSemesterAllocationProfileOptions,
  profileDigest,
  summarizeProfileSamples,
  type ProfileScenario,
} from '../services/semesterAllocationProfile';
import {
  buildStoredSemesterProfileFixture,
  measureStoredSemesterProfileSample,
} from '../services/semesterStoredVerificationProfile';
import { runProfileChild } from './profileSemesterAllocation';

type Options = ReturnType<typeof parseSemesterAllocationProfileOptions>;
type Phase = keyof ReturnType<typeof measureStoredSemesterProfileSample>['timings'];
function measureScenario(scenario: ProfileScenario, options: Options) {
  const fixture = buildStoredSemesterProfileFixture(scenario);
  const inputDigest = profileDigest(fixture);
  const samples: Record<Phase, number[]> = {
    singleRunMs: [],
    adminProjectionMs: [],
    ownProjectionMs: [],
    jobOutcomeMs: [],
    initialHistoryMs: [],
    continuationHistoryMs: [],
  };
  let fingerprints:
    | ReturnType<typeof measureStoredSemesterProfileSample>['fingerprints']
    | undefined;
  const before = process.memoryUsage();
  for (let sample = -options.warmup; sample < options.samples; sample++) {
    const measured = measureStoredSemesterProfileSample(fixture);
    if (fingerprints && JSON.stringify(fingerprints) !== JSON.stringify(measured.fingerprints))
      throw new Error('Stored verification fingerprints changed between samples');
    fingerprints = measured.fingerprints;
    if (sample >= 0)
      for (const key of Object.keys(samples) as Array<keyof typeof samples>)
        samples[key].push(measured.timings[key]);
  }
  const after = process.memoryUsage();
  if (profileDigest(fixture) !== inputDigest)
    throw new Error('Stored profiling mutated fixture inputs');
  return {
    scenario,
    inputDigest,
    fingerprints,
    decodedResultCount: 7,
    participantCountPerResult: fixture.records[0].run.participants.length,
    modeledResultJsonBytes: Buffer.byteLength(
      JSON.stringify(fixture.records[0].run.result),
      'utf8',
    ),
    timings: Object.fromEntries(
      Object.entries(samples).map(([key, values]) => [key, summarizeProfileSamples(values)]),
    ),
    samples,
    sampledMemoryBytes: {
      before: { heapUsed: before.heapUsed, rss: before.rss },
      after: { heapUsed: after.heapUsed, rss: after.rss },
      peakMeasured: false,
    },
  };
}
async function main() {
  const argv = process.argv.slice(2);
  const options = parseSemesterAllocationProfileOptions(argv);
  // One pass already performs seventeen full replays; defaults are an observational smoke run.
  if (!argv.includes('--samples')) options.samples = 1;
  if (!argv.includes('--warmup')) options.warmup = 0;
  // Full-page replay repetitions need a larger operator deadline than pure allocation samples.
  if (!argv.includes('--timeout-ms')) options.timeoutMs = 120000;
  if (process.send) {
    if (options.scenario === 'all') throw new Error('A stored profile child requires one scenario');
    process.send(measureScenario(options.scenario, options), (error: Error | null) => {
      if (error) process.exitCode = 1;
      process.disconnect();
    });
    return;
  }
  const scenarios = options.scenario === 'all' ? PROFILE_SCENARIOS : [options.scenario];
  const results: unknown[] = [];
  for (const scenario of scenarios)
    results.push(await runProfileChild(__filename, scenario, options));
  console.log(
    JSON.stringify(
      {
        kind: 'SYNTHETIC_STORED_SEMESTER_VERIFICATION_PROFILE',
        reportVersion: 1,
        recordedAt: new Date().toISOString(),
        runtime: {
          node: process.version,
          platform: process.platform,
          arch: process.arch,
          cpuModel: cpus()[0]?.model ?? 'unknown',
          logicalCpus: cpus().length,
        },
        options,
        childOldSpaceLimitMiB: 512,
        totalProcessMemoryCapped: false,
        scope: 'ACTUAL_PERSISTED_V1_VERIFICATION_AND_PROJECTION_CPU_ONLY',
        decodedFixtureMemoryRepresentsDatabaseMaterialization: false,
        databaseOperationsAttempted: false,
        authorizationOrSqlMeasured: false,
        captureOrWorkerMeasured: false,
        endpointLatencyGuaranteeEstablished: false,
        results,
      },
      null,
      2,
    ),
  );
  if (
    results.some(
      (entry) =>
        typeof entry !== 'object' ||
        entry === null ||
        !('status' in entry) ||
        entry.status !== 'COMPLETED',
    )
  )
    process.exitCode = 1;
}
if (require.main === module)
  void main().catch(() => {
    console.error(
      'Stored semester verification profile failed; no database operation was attempted.',
    );
    process.exitCode = 1;
  });
