import {
  OwnSemesterAllocationRunV1Schema,
  SemesterAllocationJobOutcomeSchema,
  SemesterAllocationRunV1Schema,
} from '@iu-study-planner/shared';

import {
  projectOwnSemesterAllocationRun,
  projectSemesterAllocationRun,
  verifyStoredSemesterAllocationJobOutcome,
  verifyStoredSemesterAllocationRun,
  verifySemesterHistoryRequest,
} from '../services/semesterStoredVerification';
import {
  buildStoredSemesterProfileFixture,
  measureStoredSemesterProfileSample,
} from '../services/semesterStoredVerificationProfile';

// The profiling path must not load the database or startup environment configuration.
jest.mock('../db', () => {
  throw new Error('Stored profiling unexpectedly imported the database');
});
jest.mock('../config', () => {
  throw new Error('Stored profiling unexpectedly imported startup configuration');
});

function freeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

describe('synthetic saved-semester profile evidence', () => {
  it('creates seven distinct coherent private records in newest-first order', () => {
    const fixture = buildStoredSemesterProfileFixture('reference');
    expect(fixture.scenario).toBe('reference');
    expect(fixture.records).toHaveLength(7);
    expect(new Set(fixture.records.map((record) => record.job.id)).size).toBe(7);
    expect(new Set(fixture.records.map((record) => record.run.id)).size).toBe(7);
    expect(new Set(fixture.records.map((record) => record.run.requestId)).size).toBe(7);
    for (const [index, record] of fixture.records.entries()) {
      const stored = verifyStoredSemesterAllocationRun(record.run);
      const outcome = verifyStoredSemesterAllocationJobOutcome(record.job, record.execution);
      expect(stored.result).toMatchObject({
        kind: 'SIMULATION',
        usage: 'INTERNAL_REFERENCE_ONLY',
        model: 'SEMESTER_CREDIT_BUDGET_V1',
        eligibilityValidated: false,
        allocationValidated: false,
        timetableValidated: false,
        persisted: false,
      });
      expect(record.run.participants).toHaveLength(12);
      expect(outcome).toMatchObject({ status: 'SUCCEEDED', runId: record.run.id });
      expect(SemesterAllocationJobOutcomeSchema.parse(outcome)).toEqual(outcome);
      if (index > 0) {
        const newer = fixture.records[index - 1].job;
        expect(
          newer.createdAt.getTime() > record.job.createdAt.getTime() ||
            (newer.createdAt.getTime() === record.job.createdAt.getTime() &&
              newer.id > record.job.id),
        ).toBe(true);
      }
    }
  });

  it('builds reproducible evidence with independent mutable participant containers', () => {
    const first = buildStoredSemesterProfileFixture('reference');
    const expected = buildStoredSemesterProfileFixture('reference');
    expect(first).toEqual(expected);
    first.records[0].run.participants.pop();
    expect(first.records[1].run.participants).toHaveLength(12);
    expect(buildStoredSemesterProfileFixture('reference')).toEqual(expected);
  });

  it('preserves unknown resource outcomes in valid saved reference records', () => {
    const fixture = buildStoredSemesterProfileFixture('missing-resources');
    for (const record of fixture.records) {
      const run = verifyStoredSemesterAllocationRun(record.run);
      expect(run.result.envelope.resources).toBeNull();
      expect(run.result.assignments).toEqual([]);
      expect(run.result.students.every((student) => student.reason === 'RESOURCE_UNKNOWN')).toBe(
        true,
      );
      expect(verifyStoredSemesterAllocationJobOutcome(record.job, record.execution).status).toBe(
        'SUCCEEDED',
      );
    }
  });
});

describe('actual saved-semester public projections', () => {
  it('omits identities, utility inputs and retry keys from administrator evidence', () => {
    const { run: row, job } = buildStoredSemesterProfileFixture('reference').records[0];
    const run = verifyStoredSemesterAllocationRun(row);
    const projected = projectSemesterAllocationRun(run);
    expect(SemesterAllocationRunV1Schema.parse(projected)).toEqual(projected);
    expect(projected.result).toMatchObject({
      studentCount: 12,
      assignedStudentCount: 12,
      assignedCourseCount: 36,
      totalTargetCredits: 108,
      totalAssignedCredits: 108,
      totalRemainingCredits: 0,
      eligibilityValidated: false,
      allocationValidated: false,
      timetableValidated: false,
      academicPlansChanged: false,
    });
    const serialized = JSON.stringify(projected);
    for (const participant of row.participants) {
      expect(serialized).not.toContain(participant.capturedStudentId);
      expect(serialized).not.toContain(participant.id);
    }
    expect(serialized).not.toContain(row.requestId);
    expect(serialized).not.toContain(job.requestId);
    expect(serialized).not.toContain('"studentUtility":');
    expect(serialized).not.toContain('"candidates":');
  });

  it('projects only the selected participant outcome, without captured student identities', () => {
    const row = buildStoredSemesterProfileFixture('reference').records[0].run;
    const run = verifyStoredSemesterAllocationRun(row);
    const student = run.result.students[0];
    const own = projectOwnSemesterAllocationRun(run, student.studentId.toUpperCase());
    expect(OwnSemesterAllocationRunV1Schema.parse(own)).toEqual(own);
    expect(own.result).toEqual({
      targetCredits: student.targetCredits,
      courseIds: student.courseIds,
      assignedCredits: student.assignedCredits,
      remainingCredits: student.remainingCredits,
      reason: student.reason,
    });
    expect(own).toMatchObject({
      eligibilityValidated: false,
      allocationValidated: false,
      timetableValidated: false,
      academicPlansChanged: false,
    });
    for (const participant of row.participants)
      expect(JSON.stringify(own)).not.toContain(participant.capturedStudentId);
    expect(() =>
      projectOwnSemesterAllocationRun(run, 'bbbbbbbb-0000-4000-8000-999999999999'),
    ).toThrow();
  });
});

describe('saved-semester verifier corruption detection', () => {
  it('requires the exact top-level history run relation as well as valid execution evidence', () => {
    const record = buildStoredSemesterProfileFixture('reference').records[0];
    const row = { ...record.job, execution: record.execution, run: { id: record.run.id } };
    expect(verifySemesterHistoryRequest(row).outcome.status).toBe('SUCCEEDED');
    expect(() => verifySemesterHistoryRequest({ ...row, run: null })).toThrow();
    expect(() =>
      verifySemesterHistoryRequest({
        ...row,
        run: { id: 'aaaaaaaa-0000-4000-8000-999999999999' },
      }),
    ).toThrow();
  });

  it('rejects an orphan linked run hidden behind a still-pending history request', () => {
    const record = buildStoredSemesterProfileFixture('reference').records[0];
    const pending = { ...record.job, execution: null, run: null };
    expect(verifySemesterHistoryRequest(pending).outcome.status).toBe('PENDING');
    expect(() =>
      verifySemesterHistoryRequest({ ...pending, run: { id: record.run.id } }),
    ).toThrow();
  });

  it('rejects an omitted private participant even when the public aggregates are intact', () => {
    const record = buildStoredSemesterProfileFixture('reference').records[0];
    record.run.participants.pop();
    expect(() => verifyStoredSemesterAllocationRun(record.run)).toThrow();
    expect(() => verifyStoredSemesterAllocationJobOutcome(record.job, record.execution)).toThrow();
  });

  it('rejects a forged private participant result for an unselected student', () => {
    const record = buildStoredSemesterProfileFixture('reference').records[0];
    const participant = record.run.participants.at(-1)!;
    participant.result = { remainingCredits: 0 };
    expect(() => verifyStoredSemesterAllocationRun(record.run)).toThrow();
    expect(() => verifyStoredSemesterAllocationJobOutcome(record.job, record.execution)).toThrow();
  });

  it('rejects an access relation reattached to another captured student', () => {
    const record = buildStoredSemesterProfileFixture('reference').records[0];
    record.run.participants[0].userId = record.run.participants[1].capturedStudentId;
    expect(() => verifyStoredSemesterAllocationRun(record.run)).toThrow();
  });

  it('retains valid historical evidence after a participant access relation is deleted', () => {
    const record = buildStoredSemesterProfileFixture('reference').records[0];
    record.run.participants[0].userId = null;
    expect(() => verifyStoredSemesterAllocationRun(record.run)).not.toThrow();
    expect(verifyStoredSemesterAllocationJobOutcome(record.job, record.execution).status).toBe(
      'SUCCEEDED',
    );
  });

  it('rejects a success linked to another job even when the run fully replays', () => {
    const records = buildStoredSemesterProfileFixture('reference').records;
    records[0].run.jobId = records[1].job.id;
    expect(() => verifyStoredSemesterAllocationRun(records[0].run)).not.toThrow();
    expect(() =>
      verifyStoredSemesterAllocationJobOutcome(records[0].job, records[0].execution),
    ).toThrow();
  });

  it('rejects a successful run outside its queued semester scope', () => {
    const record = buildStoredSemesterProfileFixture('reference').records[0];
    record.job.year++;
    expect(() => verifyStoredSemesterAllocationRun(record.run)).not.toThrow();
    expect(() => verifyStoredSemesterAllocationJobOutcome(record.job, record.execution)).toThrow();
  });

  it('rejects a successful run captured before its request was queued', () => {
    const record = buildStoredSemesterProfileFixture('reference').records[0];
    record.job.createdAt = new Date(record.run.capturedAt.getTime() + 1);
    expect(() => verifyStoredSemesterAllocationJobOutcome(record.job, record.execution)).toThrow();
  });
});

describe('observational saved-semester measurement', () => {
  it('uses the actual private history verifier for six initial rows and a cursor plus six rows', () => {
    const fixture = buildStoredSemesterProfileFixture('reference');
    const verifiers = jest.requireActual<typeof import('../services/semesterStoredVerification')>(
      '../services/semesterStoredVerification',
    );
    const history = jest.spyOn(verifiers, 'verifySemesterHistoryRequest');
    try {
      measureStoredSemesterProfileSample(fixture);
      expect(history.mock.calls.map(([row]) => row.id)).toEqual([
        ...fixture.records.slice(0, 6).map((record) => record.job.id),
        ...fixture.records.map((record) => record.job.id),
      ]);
    } finally {
      history.mockRestore();
    }
  });

  it('measures six real reader stages without mutating frozen captured evidence', () => {
    const fixture = freeze(buildStoredSemesterProfileFixture('reference'));
    const before = JSON.stringify(fixture);
    const first = measureStoredSemesterProfileSample(fixture);
    const second = measureStoredSemesterProfileSample(fixture);
    expect(Object.keys(first.timings).sort()).toEqual(
      [
        'singleRunMs',
        'adminProjectionMs',
        'ownProjectionMs',
        'jobOutcomeMs',
        'initialHistoryMs',
        'continuationHistoryMs',
      ].sort(),
    );
    for (const value of Object.values(first.timings)) {
      expect(Number.isFinite(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
    }
    expect(first.fingerprints).toEqual(second.fingerprints);
    expect(Object.keys(first.fingerprints).sort()).toEqual(Object.keys(first.timings).sort());
    for (const value of Object.values(first.fingerprints)) expect(value).toMatch(/^[a-f0-9]{64}$/);
    const serialized = JSON.stringify(first);
    for (const record of fixture.records) {
      expect(serialized).not.toContain(record.job.id);
      expect(serialized).not.toContain(record.run.id);
      expect(serialized).not.toContain(record.job.requestId);
      expect(serialized).not.toContain(record.run.requestId);
      for (const participant of record.run.participants)
        expect(serialized).not.toContain(participant.capturedStudentId);
    }
    expect(JSON.stringify(fixture)).toBe(before);
  });

  it('does not hide corrupt lookahead evidence from the bounded history measurement', () => {
    const fixture = buildStoredSemesterProfileFixture('reference');
    fixture.records[5].run.participants.pop();
    expect(() => measureStoredSemesterProfileSample(fixture)).toThrow();
  });

  it('does not hide corrupt continuation evidence from the final seven-record measurement', () => {
    const fixture = buildStoredSemesterProfileFixture('reference');
    fixture.records[6].run.participants.pop();
    expect(() => measureStoredSemesterProfileSample(fixture)).toThrow();
  });
});
