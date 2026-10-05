import { AllocationJobOutcomeSchema, type AllocationJobOutcomeDTO } from '@iu-study-planner/shared';

const curriculumId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const jobId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const runId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const queuedAt = '2026-10-05T08:00:00.000Z';
const completedAt = '2026-10-05T08:00:01.000Z';
const scope = { curriculumId, semester: 'FALL' as const, year: 2026 };
const pending = (): AllocationJobOutcomeDTO => ({
  jobId,
  kind: 'SIMULATION',
  usage: 'REFERENCE_ONLY',
  executionModel: 'ATOMIC_SINGLE_JOB',
  scope,
  queuedAt,
  status: 'PENDING',
  runId: null,
  completedAt: null,
  failureCode: null,
});
const succeeded = (): AllocationJobOutcomeDTO => ({
  ...pending(),
  status: 'SUCCEEDED',
  runId,
  completedAt,
});
const failed = (
  failureCode: 'AUTHOR_UNAVAILABLE' | 'PREVIEW_UNAVAILABLE' = 'AUTHOR_UNAVAILABLE',
): AllocationJobOutcomeDTO => ({ ...pending(), status: 'FAILED', failureCode, completedAt });

describe('atomic simulation allocation job outcome contract', () => {
  it('accepts pending without claiming whether a worker is currently active', () => {
    expect(AllocationJobOutcomeSchema.parse(pending())).toEqual(pending());
  });

  it('accepts a successful terminal outcome identifying an immutable run', () => {
    expect(AllocationJobOutcomeSchema.parse(succeeded())).toEqual(succeeded());
  });

  it.each(['AUTHOR_UNAVAILABLE', 'PREVIEW_UNAVAILABLE'] as const)(
    'accepts a terminal failure with only sanitized %s',
    (code) => {
      expect(AllocationJobOutcomeSchema.parse(failed(code))).toEqual(failed(code));
    },
  );

  it('normalizes job, run and nested curriculum UUIDs', () => {
    expect(
      AllocationJobOutcomeSchema.parse({
        ...succeeded(),
        jobId: jobId.toUpperCase(),
        runId: runId.toUpperCase(),
        scope: { ...scope, curriculumId: curriculumId.toUpperCase() },
      }),
    ).toEqual(succeeded());
  });

  it.each([
    { status: 'PENDING', runId, completedAt: null, failureCode: null },
    { status: 'PENDING', runId: null, completedAt, failureCode: null },
    { status: 'PENDING', runId: null, completedAt: null, failureCode: 'AUTHOR_UNAVAILABLE' },
    { status: 'PENDING', runId, completedAt, failureCode: 'PREVIEW_UNAVAILABLE' },
    { status: 'SUCCEEDED', runId: null, completedAt, failureCode: null },
    { status: 'SUCCEEDED', runId, completedAt: null, failureCode: null },
    { status: 'SUCCEEDED', runId, completedAt, failureCode: 'PREVIEW_UNAVAILABLE' },
    { status: 'SUCCEEDED', runId: null, completedAt: null, failureCode: 'AUTHOR_UNAVAILABLE' },
    { status: 'FAILED', runId: null, completedAt, failureCode: null },
    { status: 'FAILED', runId: null, completedAt: null, failureCode: 'AUTHOR_UNAVAILABLE' },
    { status: 'FAILED', runId, completedAt, failureCode: 'PREVIEW_UNAVAILABLE' },
    { status: 'FAILED', runId, completedAt: null, failureCode: null },
  ])('rejects mutually inconsistent outcome fields %#', (fields) => {
    expect(AllocationJobOutcomeSchema.safeParse({ ...pending(), ...fields }).success).toBe(false);
  });

  it.each([
    'jobId',
    'kind',
    'usage',
    'executionModel',
    'scope',
    'queuedAt',
    'status',
    'runId',
    'completedAt',
    'failureCode',
  ])('rejects missing required outcome field %s even when nullable', (field) => {
    const input: Record<string, unknown> = pending();
    delete input[field];
    expect(AllocationJobOutcomeSchema.safeParse(input).success).toBe(false);
  });

  it.each([
    { jobId: 'job-1' },
    { jobId: `${jobId}\n` },
    { runId: 'run-1' },
    { runId: `${runId}\n` },
    { kind: 'ENROLLMENT' },
    { usage: 'VALIDATED' },
    { executionModel: 'ATOMIC_MULTI_JOB' },
    { executionModel: 'LEASED_WORKER' },
    { status: 'RUNNING' },
    { status: 'QUEUED' },
    { status: 'succeeded' },
    { status: null },
  ])('rejects invalid identity, status or unsupported execution claims %#', (fields) => {
    expect(AllocationJobOutcomeSchema.safeParse({ ...succeeded(), ...fields }).success).toBe(false);
  });

  it.each([
    'DATABASE_ERROR',
    'Authentication required',
    'Private student abc failed with score 45',
    '',
    { message: 'Private raw exception' },
  ])('rejects unsupported or private failure details %#', (failureCode) => {
    expect(AllocationJobOutcomeSchema.safeParse({ ...failed(), failureCode }).success).toBe(false);
  });

  it.each([
    { createdById: jobId },
    { requestId: runId },
    { expectedActorId: jobId },
    { leaseToken: runId },
    { studentIds: [jobId] },
    { scores: [] },
    { result: {} },
    { inputsCaptured: true },
    { inputsCaptured: false },
    { attempts: 1 },
    { startedAt: queuedAt },
    { scheduledAt: queuedAt },
    { error: 'Private raw failure' },
    { assignmentsPersisted: true },
  ])('rejects private fields and unsupported lifecycle details %#', (fields) => {
    expect(AllocationJobOutcomeSchema.safeParse({ ...pending(), ...fields }).success).toBe(false);
  });

  it.each([
    { curriculumId: 'CS' },
    { curriculumId: `${curriculumId}\n` },
    { semester: 'WINTER' },
    { year: 1999 },
    { year: 2101 },
    { year: 2026.5 },
    { year: '2026' },
    { createdById: jobId },
    { studentIds: [jobId] },
  ])('rejects malformed or expanded nested scenarios %#', (fields) => {
    expect(
      AllocationJobOutcomeSchema.safeParse({ ...pending(), scope: { ...scope, ...fields } })
        .success,
    ).toBe(false);
  });

  it.each(['FALL', 'SPRING', 'SUMMER'] as const)(
    'accepts %s at both scenario year bounds',
    (semester) => {
      for (const year of [2000, 2100]) {
        const input = { ...pending(), scope: { ...scope, semester, year } };
        expect(AllocationJobOutcomeSchema.parse(input)).toEqual(input);
      }
    },
  );

  it.each([
    { queuedAt: 'yesterday' },
    { queuedAt: '2026-10-05' },
    { queuedAt: `${queuedAt}\n` },
    { queuedAt: '2026-10-05T08:00:00+07:00' },
    { completedAt: '2026-10-05T08:00:00' },
    { completedAt: `${completedAt}\n` },
    { completedAt: 1791187200000 },
  ])('rejects malformed, local or whitespace timestamp values %#', (fields) => {
    expect(AllocationJobOutcomeSchema.safeParse({ ...succeeded(), ...fields }).success).toBe(false);
  });

  it.each([
    [queuedAt, queuedAt],
    ['2026-10-05T08:00:00Z', '2026-10-05T08:00:00.000Z'],
    ['2026-10-05T08:00:00.1Z', '2026-10-05T08:00:00.100000Z'],
    ['2026-10-05T08:00:00.0001Z', '2026-10-05T08:00:00.0009Z'],
  ])('accepts equal or later completion with exact fractional chronology %#', (start, end) => {
    expect(
      AllocationJobOutcomeSchema.safeParse({ ...succeeded(), queuedAt: start, completedAt: end })
        .success,
    ).toBe(true);
  });

  it.each([
    ['2026-10-05T08:00:01.000Z', queuedAt],
    ['2026-10-05T08:00:00.0009Z', '2026-10-05T08:00:00.0001Z'],
  ])('rejects completion before enqueue including submillisecond differences %#', (start, end) => {
    for (const terminal of [succeeded(), failed()])
      expect(
        AllocationJobOutcomeSchema.safeParse({ ...terminal, queuedAt: start, completedAt: end })
          .success,
      ).toBe(false);
  });
});
