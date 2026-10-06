import {
  AllocationJobExecutionSchema,
  ExecuteAllocationJobSchema,
  type AllocationJobOutcomeDTO,
} from '@iu-study-planner/shared';

const actorId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const curriculumId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const jobId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const runId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const scope = { curriculumId, semester: 'FALL' as const, year: 2026 };
const input = () => ({ ...scope, expectedActorId: actorId });
const outcome = (status: 'PENDING' | 'SUCCEEDED' | 'FAILED'): AllocationJobOutcomeDTO => ({
  jobId,
  kind: 'SIMULATION',
  usage: 'REFERENCE_ONLY',
  executionModel: 'ATOMIC_SINGLE_JOB',
  scope,
  queuedAt: '2026-10-05T08:00:00.000Z',
  status,
  runId: status === 'SUCCEEDED' ? runId : null,
  completedAt: status === 'PENDING' ? null : '2026-10-05T08:00:01.000Z',
  failureCode: status === 'FAILED' ? 'AUTHOR_UNAVAILABLE' : null,
});

describe('explicit allocation job execution request/reply contract', () => {
  it('accepts exactly the current actor precondition and selected scenario', () => {
    expect(ExecuteAllocationJobSchema.parse(input())).toEqual(input());
  });

  it('normalizes scenario and expected actor UUIDs', () => {
    expect(
      ExecuteAllocationJobSchema.parse({
        ...input(),
        curriculumId: curriculumId.toUpperCase(),
        expectedActorId: actorId.toUpperCase(),
      }),
    ).toEqual(input());
  });

  it.each(['curriculumId', 'semester', 'year', 'expectedActorId'])(
    'rejects missing request precondition %s',
    (field) => {
      const value: Record<string, unknown> = input();
      delete value[field];
      expect(ExecuteAllocationJobSchema.safeParse(value).success).toBe(false);
    },
  );

  it.each([
    { expectedActorId: null },
    { expectedActorId: 'ADMIN' },
    { expectedActorId: `${actorId}\n` },
    { curriculumId: 'CS' },
    { semester: 'WINTER' },
    { year: '2026' },
    { year: 1999 },
    { year: 2101 },
    { year: 2026.5 },
    { requestId: runId },
    { jobId },
    { runId },
    { result: {} },
    { processed: true },
    { students: [] },
    { professors: 10 },
    { scheduledAt: '2026-10-06T08:00:00.000Z' },
  ])('rejects malformed identity/scope or expanded execution controls %#', (fields) => {
    expect(ExecuteAllocationJobSchema.safeParse({ ...input(), ...fields }).success).toBe(false);
  });

  it.each([
    ['PENDING', false],
    ['SUCCEEDED', true],
    ['SUCCEEDED', false],
    ['FAILED', true],
    ['FAILED', false],
  ] as const)('accepts a verified %s outcome with processed=%s', (status, processed) => {
    const value = { processed, outcome: outcome(status) };
    expect(AllocationJobExecutionSchema.parse(value)).toEqual(value);
  });

  it('rejects processed=true with a pending outcome', () => {
    expect(
      AllocationJobExecutionSchema.safeParse({ processed: true, outcome: outcome('PENDING') })
        .success,
    ).toBe(false);
  });

  it.each([
    { processed: 'true' },
    { processed: 1 },
    { processed: undefined },
    { outcome: undefined },
    { actorId },
    { requestId: runId },
    { retryAfter: 30 },
    { startedAt: '2026-10-05T08:00:00.000Z' },
  ])('rejects malformed or extra execution reply metadata %#', (fields) => {
    expect(
      AllocationJobExecutionSchema.safeParse({
        processed: false,
        outcome: outcome('PENDING'),
        ...fields,
      }).success,
    ).toBe(false);
  });

  it.each([
    { runId: null },
    { failureCode: 'AUTHOR_UNAVAILABLE' },
    { completedAt: null },
    { status: 'RUNNING' },
    { createdById: actorId },
    { studentIds: [actorId] },
  ])('retains strict outcome validation inside execution replies %#', (fields) => {
    expect(
      AllocationJobExecutionSchema.safeParse({
        processed: false,
        outcome: { ...outcome('SUCCEEDED'), ...fields },
      }).success,
    ).toBe(false);
  });
});
