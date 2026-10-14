import { performance } from 'node:perf_hooks';
import type { Prisma, SimulationSemesterAllocationJob } from '@prisma/client';
import {
  SemesterAllocationJobHistorySchema,
  SemesterAllocationResultV1Schema,
} from '@iu-study-planner/shared';
import {
  buildSemesterAllocationProfileFixture,
  profileDigest,
  type ProfileScenario,
} from './semesterAllocationProfile';
import { allocateSimulationSemester } from './simulationSemesterAllocation';
import {
  projectOwnSemesterAllocationRun,
  projectSemesterAllocationRun,
  verifySemesterHistoryRequest,
  verifyStoredSemesterAllocationJobOutcome,
  verifyStoredSemesterAllocationRun,
  type StoredExecution,
  type StoredRun,
} from './semesterStoredVerification';

type Record = { job: SimulationSemesterAllocationJob; execution: StoredExecution; run: StoredRun };
const uuid = (prefix: string, index: number) =>
  `${prefix}-0000-4000-8000-${String(index + 1).padStart(12, '0')}`;

/** Synthetic decoded records only. Allocator/pinned compatibility and cloning are outside reader timings. */
export function buildStoredSemesterProfileFixture(scenario: ProfileScenario) {
  const fixture = buildSemesterAllocationProfileFixture(scenario);
  const result = SemesterAllocationResultV1Schema.parse(
    allocateSimulationSemester(fixture.envelope, fixture.input, fixture.policy),
  );
  const encoded = JSON.stringify(result);
  const actor = uuid('99999999', 0);
  const records: Record[] = Array.from({ length: 7 }, (_, index) => {
    const jobId = uuid('eeeeeeee', index);
    const runId = uuid('dddddddd', index);
    const createdAt = new Date(Date.parse('2026-10-08T01:00:07.000Z') - index * 1000);
    const capturedAt = new Date(createdAt.getTime() + 100);
    const runCreatedAt = new Date(createdAt.getTime() + 200);
    // Clone only this pinned-validated JSON; each reader still verifies the entire copy.
    const decoded = JSON.parse(encoded) as typeof result;
    const job: SimulationSemesterAllocationJob = {
      id: jobId,
      ...fixture.envelope.scope,
      model: result.model,
      createdById: actor,
      requestId: uuid('ffffffff', index),
      createdAt,
    };
    const run: StoredRun = {
      id: runId,
      jobId,
      ...fixture.envelope.scope,
      requestId: uuid('77777777', index),
      createdById: actor,
      formatVersion: 1,
      capturedAt,
      createdAt: runCreatedAt,
      result: decoded as unknown as Prisma.JsonValue,
      participants: decoded.students.map((student, studentIndex) => ({
        id: uuid('88888888', index * 500 + studentIndex),
        runId,
        capturedStudentId: student.studentId,
        userId: student.studentId,
        result: student as unknown as Prisma.JsonValue,
      })),
    };
    const execution: StoredExecution = {
      jobId,
      status: 'SUCCEEDED',
      runId,
      failureCode: null,
      completedAt: new Date(createdAt.getTime() + 300),
      run,
    };
    return { job, execution, run };
  });
  return { scenario, records };
}
export type StoredSemesterProfileFixture = ReturnType<typeof buildStoredSemesterProfileFixture>;

/** Actual history pair and public page validation; SQL selection/authorization are not simulated. */
function historyPage(fixture: StoredSemesterProfileFixture, continuation: boolean) {
  const first = fixture.records[0];
  if (continuation)
    verifySemesterHistoryRequest({
      ...first.job,
      execution: first.execution,
      run: { id: first.run.id },
    });
  const rows = continuation ? fixture.records.slice(1) : fixture.records.slice(0, 6);
  const verified = rows.map((row) =>
    verifySemesterHistoryRequest({ ...row.job, execution: row.execution, run: { id: row.run.id } }),
  );
  const requests = verified.slice(0, 5);
  return SemesterAllocationJobHistorySchema.parse({
    kind: 'SIMULATION',
    usage: 'REFERENCE_ONLY',
    model: first.job.model,
    scope: {
      curriculumId: first.job.curriculumId,
      semester: first.job.semester,
      year: first.job.year,
    },
    order: 'QUEUED_NEWEST_FIRST',
    pageSize: 5,
    after: continuation ? first.job.id : null,
    requests,
    nextAfter: requests.at(-1)!.job.id,
  });
}

export function measureStoredSemesterProfileSample(fixture: StoredSemesterProfileFixture) {
  if (fixture.records.length !== 7)
    throw new Error('Stored profiling requires seven complete synthetic records');
  const first = fixture.records[0];
  const owner = first.run.participants[0]?.capturedStudentId;
  if (!owner) throw new Error('Stored profiling requires a synthetic participant');
  const before = profileDigest(fixture);
  const timings: {
    singleRunMs: number;
    adminProjectionMs: number;
    ownProjectionMs: number;
    jobOutcomeMs: number;
    initialHistoryMs: number;
    continuationHistoryMs: number;
  } = {
    singleRunMs: 0,
    adminProjectionMs: 0,
    ownProjectionMs: 0,
    jobOutcomeMs: 0,
    initialHistoryMs: 0,
    continuationHistoryMs: 0,
  };
  const fingerprints: { [key in keyof typeof timings]: string } = {
    singleRunMs: '',
    adminProjectionMs: '',
    ownProjectionMs: '',
    jobOutcomeMs: '',
    initialHistoryMs: '',
    continuationHistoryMs: '',
  };
  function measure(key: keyof typeof timings, operation: () => unknown) {
    const start = performance.now();
    const result = operation();
    timings[key] = performance.now() - start;
    fingerprints[key] = profileDigest(result);
  }
  measure('singleRunMs', () => verifyStoredSemesterAllocationRun(first.run));
  measure('adminProjectionMs', () =>
    projectSemesterAllocationRun(verifyStoredSemesterAllocationRun(first.run)),
  );
  measure('ownProjectionMs', () =>
    projectOwnSemesterAllocationRun(verifyStoredSemesterAllocationRun(first.run), owner),
  );
  measure('jobOutcomeMs', () =>
    verifyStoredSemesterAllocationJobOutcome(first.job, first.execution),
  );
  measure('initialHistoryMs', () => historyPage(fixture, false));
  measure('continuationHistoryMs', () => historyPage(fixture, true));
  if (profileDigest(fixture) !== before)
    throw new Error('Stored profiling changed its synthetic evidence');
  return { timings, fingerprints };
}
