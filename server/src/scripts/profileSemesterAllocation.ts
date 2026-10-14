import { fork } from 'node:child_process';
import { cpus } from 'node:os';
import { performance } from 'node:perf_hooks';
import {
  PROFILE_SCENARIOS,
  assertProfileExpectations,
  buildSemesterAllocationProfileFixture,
  parseSemesterAllocationProfileOptions,
  profileDigest,
  summarizeProfileSamples,
  summarizeSemesterAllocationProfileResult,
  type ProfileScenario,
} from '../services/semesterAllocationProfile';
import { allocateSimulationSemester } from '../services/simulationSemesterAllocation';

type Options = ReturnType<typeof parseSemesterAllocationProfileOptions>;

function measureScenario(scenario: ProfileScenario, options: Options) {
  const fixture = buildSemesterAllocationProfileFixture(scenario);
  const inputDigest = profileDigest(fixture);
  const allocationMs: number[] = [];
  const serializationMs: number[] = [];
  const replayMs: number[] = [];
  const memoryBefore = process.memoryUsage();
  let digest: string | undefined;
  let outcome: ReturnType<typeof summarizeSemesterAllocationProfileResult> | undefined;
  let jsonBytes = 0;
  for (let sample = -options.warmup; sample < options.samples; sample++) {
    const start = performance.now();
    const result = allocateSimulationSemester(fixture.envelope, fixture.input, fixture.policy);
    const allocated = performance.now();
    const json = JSON.stringify(result);
    const serialized = performance.now();
    const summary = summarizeSemesterAllocationProfileResult(JSON.parse(json) as unknown);
    const replayed = performance.now();
    assertProfileExpectations(scenario, result);
    const nextDigest = profileDigest(result);
    if ((digest !== undefined && digest !== nextDigest) || profileDigest(fixture) !== inputDigest)
      throw new Error('Profile result changed between samples or mutated its inputs');
    digest = nextDigest;
    outcome = summary;
    jsonBytes = Buffer.byteLength(json, 'utf8');
    if (sample >= 0) {
      allocationMs.push(allocated - start);
      serializationMs.push(serialized - allocated);
      replayMs.push(replayed - serialized);
    }
  }
  const reversed = {
    courses: [...fixture.input.courses].reverse(),
    students: [...fixture.input.students].reverse().map((student) => ({
      ...student,
      candidates: [...student.candidates].reverse(),
    })),
  };
  const reordered = allocateSimulationSemester(fixture.envelope, reversed, fixture.policy);
  if (profileDigest(reordered) !== digest) throw new Error('Profile output depends on input order');
  const memoryAfter = process.memoryUsage();
  return {
    scenario,
    inputDigest,
    resultDigest: digest,
    resultJsonBytes: jsonBytes,
    outcome,
    deterministicSamplesAndReversedInput: true,
    timings: {
      allocationIncludingInputOutputValidationMs: summarizeProfileSamples(allocationMs),
      resultSerializationMs: summarizeProfileSamples(serializationMs),
      jsonParseAndAdditionalInternalReplayMs: summarizeProfileSamples(replayMs),
    },
    samples: { allocationMs, serializationMs, replayMs },
    sampledMemoryBytes: {
      before: { heapUsed: memoryBefore.heapUsed, rss: memoryBefore.rss },
      after: { heapUsed: memoryAfter.heapUsed, rss: memoryAfter.rss },
      peakMeasured: false,
    },
  };
}

export async function runProfileChild(
  scriptPath: string,
  scenario: ProfileScenario,
  options: Options,
) {
  const started = performance.now();
  return new Promise<unknown>((resolve) => {
    const child = fork(
      scriptPath,
      [
        '--scenario',
        scenario,
        '--samples',
        String(options.samples),
        '--warmup',
        String(options.warmup),
      ],
      {
        execArgv: ['--max-old-space-size=512'],
        stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      },
    );
    let report: unknown;
    let timedOut = false;
    const killChild = () => {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    };
    const interrupt = () => {
      killChild();
      process.exit(130);
    };
    const terminate = () => {
      killChild();
      process.exit(143);
    };
    process.once('SIGINT', interrupt);
    process.once('SIGTERM', terminate);
    process.once('exit', killChild);
    const timer = setTimeout(() => {
      timedOut = true;
      killChild();
    }, options.timeoutMs);
    const cleanup = () => {
      clearTimeout(timer);
      process.removeListener('SIGINT', interrupt);
      process.removeListener('SIGTERM', terminate);
      process.removeListener('exit', killChild);
    };
    child.on('message', (message: unknown) => {
      report = message;
    });
    child.once('error', () => {
      cleanup();
      resolve({
        scenario,
        status: 'FAILED',
        reason: 'Child process could not start',
        wallMs: performance.now() - started,
      });
    });
    child.once('exit', (code) => {
      cleanup();
      resolve({
        scenario,
        status: timedOut ? 'TIMED_OUT' : code === 0 && report ? 'COMPLETED' : 'FAILED',
        wallMs: performance.now() - started,
        ...(code === 0 && report && !timedOut ? { report } : {}),
      });
    });
  });
}

async function main() {
  const options = parseSemesterAllocationProfileOptions(process.argv.slice(2));
  if (process.send) {
    if (options.scenario === 'all') throw new Error('A profile child requires one scenario');
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
        kind: 'SYNTHETIC_SEMESTER_PROFILE',
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
        model: 'SEMESTER_CREDIT_BUDGET_V1',
        scope: 'PURE_ALLOCATOR_AND_ADDITIONAL_INTERNAL_REPLAY_ONLY',
        databaseMeasured: false,
        workerOrHistoryLatencyMeasured: false,
        baselineEfficacyCompared: false,
        timingGuaranteeEstablished: false,
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

if (require.main === module) {
  void main().catch(() => {
    console.error(
      'Semester profile failed. Check scenario/options or fixture validation; no database operation was attempted.',
    );
    process.exitCode = 1;
  });
}
