import { randomUUID } from 'node:crypto';
import { SemesterAllocationJobOutcomeSchema } from '@iu-study-planner/shared';

describe('semester job outcome privacy and state contracts', () => {
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
  it('accepts private-free pending intent without claiming a captured result', () => {
    expect(SemesterAllocationJobOutcomeSchema.parse(pending())).toEqual(pendingShape());
  });
  function pendingShape() {
    return {
      ...pending(),
      jobId: expect.any(String),
      scope: { ...pending().scope, curriculumId: expect.any(String) },
    };
  }
  it('accepts only a run-linked successful terminal state', () => {
    const input = {
      ...pending(),
      status: 'SUCCEEDED',
      runId: randomUUID(),
      completedAt: '2026-10-07T00:01:00.000Z',
    };
    expect(SemesterAllocationJobOutcomeSchema.parse(input)).toEqual(input);
  });
  it.each(['AUTHOR_UNAVAILABLE', 'PREVIEW_UNAVAILABLE'])(
    'accepts the bounded failure %s without a run',
    (failureCode) => {
      expect(
        SemesterAllocationJobOutcomeSchema.safeParse({
          ...pending(),
          status: 'FAILED',
          completedAt: '2026-10-07T00:01:00.000Z',
          failureCode,
        }).success,
      ).toBe(true);
    },
  );
  it.each([
    { runId: randomUUID() },
    { completedAt: '2026-10-07T00:01:00.000Z' },
    { failureCode: 'PREVIEW_UNAVAILABLE' },
    { status: 'SUCCEEDED', completedAt: '2026-10-07T00:01:00.000Z' },
    { status: 'SUCCEEDED', runId: randomUUID() },
    {
      status: 'SUCCEEDED',
      runId: randomUUID(),
      completedAt: '2026-10-07T00:01:00.000Z',
      failureCode: 'AUTHOR_UNAVAILABLE',
    },
    { status: 'FAILED', completedAt: '2026-10-07T00:01:00.000Z' },
    { status: 'FAILED', failureCode: 'AUTHOR_UNAVAILABLE' },
    {
      status: 'FAILED',
      runId: randomUUID(),
      completedAt: '2026-10-07T00:01:00.000Z',
      failureCode: 'AUTHOR_UNAVAILABLE',
    },
    { status: 'RUNNING' },
    { model: 'ONE_COURSE_V1' },
    { model: 'SEMESTER_CREDIT_BUDGET_V2' },
    { usage: 'REGISTRATION' },
    { kind: 'OFFICIAL' },
    { executionModel: 'BACKGROUND_DRAIN' },
  ])('rejects contradictory or unsupported public state %j', (changed) => {
    expect(SemesterAllocationJobOutcomeSchema.safeParse({ ...pending(), ...changed }).success).toBe(
      false,
    );
  });
  it.each([
    'students',
    'authorId',
    'requestId',
    'studentIds',
    'result',
    'choices',
    'utility',
    'policy',
    'inputsCaptured',
    'academicPlansChanged',
  ])('rejects extra private or unsupported claim %s', (key) => {
    expect(
      SemesterAllocationJobOutcomeSchema.safeParse({ ...pending(), [key]: true }).success,
    ).toBe(false);
  });
  it('rejects completion before queue time even below millisecond precision', () => {
    expect(
      SemesterAllocationJobOutcomeSchema.safeParse({
        ...pending(),
        queuedAt: '2026-10-07T00:00:00.0002Z',
        status: 'FAILED',
        failureCode: 'AUTHOR_UNAVAILABLE',
        completedAt: '2026-10-07T00:00:00.0001Z',
      }).success,
    ).toBe(false);
  });
  it('accepts equal instants with different fraction lengths', () => {
    expect(
      SemesterAllocationJobOutcomeSchema.safeParse({
        ...pending(),
        queuedAt: '2026-10-07T00:00:00.1Z',
        status: 'FAILED',
        failureCode: 'AUTHOR_UNAVAILABLE',
        completedAt: '2026-10-07T00:00:00.100Z',
      }).success,
    ).toBe(true);
  });
  it('normalizes public UUIDs and rejects extra scope/identity overrides', () => {
    const input = pending();
    const parsed = SemesterAllocationJobOutcomeSchema.parse({
      ...input,
      jobId: input.jobId.toUpperCase(),
      scope: { ...input.scope, curriculumId: input.scope.curriculumId.toUpperCase() },
    });
    expect(parsed).toEqual(input);
    expect(
      SemesterAllocationJobOutcomeSchema.safeParse({
        ...input,
        scope: { ...input.scope, userId: randomUUID() },
      }).success,
    ).toBe(false);
    expect(
      SemesterAllocationJobOutcomeSchema.safeParse({ ...input, jobId: `${input.jobId}\n` }).success,
    ).toBe(false);
  });
});
