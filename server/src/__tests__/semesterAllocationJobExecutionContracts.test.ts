import { randomUUID } from 'node:crypto';
import {
  ExecuteSemesterAllocationJobSchema,
  SemesterAllocationJobExecutionSchema,
} from '@iu-study-planner/shared';

describe('protected semester execution contracts', () => {
  const input = () => ({
    curriculumId: randomUUID(),
    semester: 'FALL',
    year: 2026,
    expectedActorId: randomUUID(),
  });
  const pending = () => ({
    jobId: randomUUID(),
    kind: 'SIMULATION',
    usage: 'REFERENCE_ONLY',
    model: 'SEMESTER_CREDIT_BUDGET_V1',
    scope: { curriculumId: randomUUID(), semester: 'FALL', year: 2026 },
    queuedAt: '2026-10-07T00:00:00.000Z',
    executionModel: 'ATOMIC_SINGLE_JOB',
    status: 'PENDING',
    runId: null,
    completedAt: null,
    failureCode: null,
  });
  it('accepts only the scenario and expected actor without a replacement execution key', () => {
    const value = input();
    expect(ExecuteSemesterAllocationJobSchema.parse(value)).toEqual(value);
  });
  it('normalizes actor and scenario UUIDs', () => {
    const value = input();
    expect(
      ExecuteSemesterAllocationJobSchema.parse({
        ...value,
        curriculumId: value.curriculumId.toUpperCase(),
        expectedActorId: value.expectedActorId.toUpperCase(),
      }),
    ).toEqual(value);
  });
  it.each([
    'requestId',
    'jobId',
    'model',
    'result',
    'studentIds',
    'targetCredits',
    'policy',
    'runId',
    'createdById',
    'userId',
  ])('rejects replacement/private input %s', (key) => {
    expect(
      ExecuteSemesterAllocationJobSchema.safeParse({ ...input(), [key]: randomUUID() }).success,
    ).toBe(false);
  });
  it.each(['curriculumId', 'semester', 'year', 'expectedActorId'])('requires %s', (key) => {
    const value: Record<string, unknown> = input();
    delete value[key];
    expect(ExecuteSemesterAllocationJobSchema.safeParse(value).success).toBe(false);
  });
  it.each([
    { year: 1999 },
    { year: 2101 },
    { year: 2026.1 },
    { semester: 'WINTER' },
    { expectedActorId: 'student' },
    { curriculumId: 'CS' },
  ])('rejects malformed scenario/actor %j', (change) => {
    expect(ExecuteSemesterAllocationJobSchema.safeParse({ ...input(), ...change }).success).toBe(
      false,
    );
  });
  it('accepts skipped PENDING without claiming execution completion', () => {
    const result = { processed: false, outcome: pending() };
    expect(SemesterAllocationJobExecutionSchema.parse(result)).toEqual(result);
  });
  it('rejects processed PENDING', () => {
    expect(
      SemesterAllocationJobExecutionSchema.safeParse({ processed: true, outcome: pending() })
        .success,
    ).toBe(false);
  });
  it.each([true, false])(
    'accepts processed=%s successful capture or terminal recovery',
    (processed) => {
      const result = {
        processed,
        outcome: {
          ...pending(),
          status: 'SUCCEEDED',
          runId: randomUUID(),
          completedAt: '2026-10-07T00:01:00.000Z',
        },
      };
      expect(SemesterAllocationJobExecutionSchema.parse(result)).toEqual(result);
    },
  );
  it.each([true, false])(
    'accepts processed=%s sanitized failure or terminal recovery',
    (processed) => {
      const result = {
        processed,
        outcome: {
          ...pending(),
          status: 'FAILED',
          failureCode: 'AUTHOR_UNAVAILABLE',
          completedAt: '2026-10-07T00:01:00.000Z',
        },
      };
      expect(SemesterAllocationJobExecutionSchema.parse(result)).toEqual(result);
    },
  );
  it.each([
    { processed: 'false' },
    { processed: 1 },
    { outcome: undefined },
    { processed: undefined },
    { students: [] },
    { requestId: randomUUID() },
  ])('rejects malformed/private execution wrapper %j', (changed) => {
    expect(
      SemesterAllocationJobExecutionSchema.safeParse({
        processed: false,
        outcome: pending(),
        ...changed,
      }).success,
    ).toBe(false);
  });
});
