import {
  AllocationJobHistorySchema,
  ListAllocationJobsSchema,
  type AllocationJobOutcomeDTO,
  type ResourceScopeDTO,
} from '@iu-study-planner/shared';

const curriculumId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const otherId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const scope: ResourceScopeDTO = { curriculumId, semester: 'FALL', year: 2026 };
const id = (index: number) => `aaaaaaaa-aaaa-4aaa-8aaa-${index.toString(16).padStart(12, '0')}`;
const job = (index: number, queuedAt = '2026-10-06T01:00:00.000Z'): AllocationJobOutcomeDTO => ({
  jobId: id(index),
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
const page = (length = 0) => ({
  kind: 'SIMULATION',
  usage: 'REFERENCE_ONLY',
  scope,
  order: 'QUEUED_NEWEST_FIRST',
  pageSize: 20,
  jobs: Array.from({ length }, (_, offset) => job(length - offset)),
  nextAfter: null as string | null,
});

describe('bounded scenario request-history contract', () => {
  it.each([0, 1, 20])('accepts a final snapshot page with %i jobs', (length) => {
    expect(AllocationJobHistorySchema.parse(page(length))).toEqual(page(length));
  });

  it('accepts mixed outcomes and a continuation at the last full-page job', () => {
    const input = page(20);
    input.jobs[0] = {
      ...input.jobs[0],
      status: 'SUCCEEDED',
      runId: otherId,
      completedAt: '2026-10-06T01:00:01.000Z',
    };
    input.jobs[1] = {
      ...input.jobs[1],
      status: 'FAILED',
      failureCode: 'PREVIEW_UNAVAILABLE',
      completedAt: '2026-10-06T01:00:02.000Z',
    };
    input.nextAfter = input.jobs.at(-1)!.jobId;
    expect(AllocationJobHistorySchema.parse(input)).toEqual(input);
  });

  it('normalizes query and every page identity before scope, uniqueness and cursor checks', () => {
    expect(
      ListAllocationJobsSchema.parse({
        ...scope,
        curriculumId: curriculumId.toUpperCase(),
        after: otherId.toUpperCase(),
      }),
    ).toEqual({ ...scope, after: otherId });
    const input = page(20);
    const expected = { ...input, nextAfter: input.jobs.at(-1)!.jobId };
    expect(
      AllocationJobHistorySchema.parse({
        ...input,
        scope: { ...scope, curriculumId: curriculumId.toUpperCase() },
        jobs: input.jobs.map((value) => ({
          ...value,
          jobId: value.jobId.toUpperCase(),
          scope: { ...scope, curriculumId: curriculumId.toUpperCase() },
        })),
        nextAfter: expected.nextAfter.toUpperCase(),
      }),
    ).toEqual(expected);
  });

  it.each([
    { curriculumId: `${curriculumId}\n` },
    { year: '2026' },
    { year: 1999 },
    { year: 2101 },
    { semester: 'WINTER' },
    { after: `${otherId}\n` },
    { after: null },
    { limit: 21 },
    { createdById: otherId },
    { requestId: otherId },
  ])('rejects malformed or expanded list inputs %#', (fields) => {
    expect(ListAllocationJobsSchema.safeParse({ ...scope, ...fields }).success).toBe(false);
  });

  it.each([
    { pageSize: 21 },
    { order: 'COMPLETED_NEWEST_FIRST' },
    { nextAfter: undefined },
    { nextAfter: `${otherId}\n` },
    { jobs: undefined },
    { total: 100 },
    { requestId: otherId },
    { createdById: otherId },
  ])('rejects expanded or unsupported page metadata %#', (fields) => {
    expect(AllocationJobHistorySchema.safeParse({ ...page(), ...fields }).success).toBe(false);
  });

  it('rejects more than twenty visible jobs', () => {
    expect(AllocationJobHistorySchema.safeParse(page(21)).success).toBe(false);
  });

  it.each([0, 1, 19])('rejects a continuation on a partial %i-job page', (length) => {
    expect(
      AllocationJobHistorySchema.safeParse({ ...page(length), nextAfter: id(1) }).success,
    ).toBe(false);
  });

  it('rejects a full-page continuation at an undisplayed or non-final identity', () => {
    expect(AllocationJobHistorySchema.safeParse({ ...page(20), nextAfter: otherId }).success).toBe(
      false,
    );
    expect(AllocationJobHistorySchema.safeParse({ ...page(20), nextAfter: id(20) }).success).toBe(
      false,
    );
  });

  it('rejects duplicate identities after normalization', () => {
    expect(
      AllocationJobHistorySchema.safeParse({
        ...page(),
        jobs: [job(2), { ...job(2), jobId: id(2).toUpperCase() }],
      }).success,
    ).toBe(false);
  });

  it.each([{ curriculumId: otherId }, { semester: 'SPRING' as const }, { year: 2027 }])(
    'rejects otherwise valid outcomes in another scenario %#',
    (fields) => {
      expect(
        AllocationJobHistorySchema.safeParse({
          ...page(),
          jobs: [{ ...job(1), scope: { ...scope, ...fields } }],
        }).success,
      ).toBe(false);
    },
  );

  it('orders by enqueue chronology before descending UUID, regardless of completion', () => {
    const newest = {
      ...job(1, '2026-10-06T01:00:02.000Z'),
      status: 'FAILED',
      completedAt: '2026-10-06T01:00:03.000Z',
      failureCode: 'AUTHOR_UNAVAILABLE',
    };
    const oldest = {
      ...job(2),
      status: 'FAILED',
      completedAt: '2026-10-06T02:00:00.000Z',
      failureCode: 'PREVIEW_UNAVAILABLE',
    };
    expect(
      AllocationJobHistorySchema.safeParse({ ...page(), jobs: [newest, oldest] }).success,
    ).toBe(true);
    expect(
      AllocationJobHistorySchema.safeParse({ ...page(), jobs: [oldest, newest] }).success,
    ).toBe(false);
    expect(
      AllocationJobHistorySchema.safeParse({ ...page(), jobs: [job(1), job(2)] }).success,
    ).toBe(false);
  });

  it('retains submillisecond enqueue ordering and treats equivalent fractional precision equally', () => {
    const newest = job(1, '2026-10-06T01:00:00.0009Z');
    const oldest = job(2, '2026-10-06T01:00:00.0001Z');
    expect(
      AllocationJobHistorySchema.safeParse({ ...page(), jobs: [newest, oldest] }).success,
    ).toBe(true);
    expect(
      AllocationJobHistorySchema.safeParse({ ...page(), jobs: [oldest, newest] }).success,
    ).toBe(false);
    expect(
      AllocationJobHistorySchema.safeParse({
        ...page(),
        jobs: [job(2, '2026-10-06T01:00:00.1Z'), job(1, '2026-10-06T01:00:00.100000Z')],
      }).success,
    ).toBe(true);
  });

  it.each([
    { status: 'QUEUED' },
    { runId: otherId },
    { completedAt: '2026-10-06T01:00:01.000Z' },
    { failureCode: 'SQL_ERROR' },
    { inputsCaptured: false },
    { createdById: otherId },
    { requestId: otherId },
    { studentIds: [otherId] },
  ])('rejects contradictory or private outcome fields %#', (fields) => {
    expect(
      AllocationJobHistorySchema.safeParse({ ...page(), jobs: [{ ...job(1), ...fields }] }).success,
    ).toBe(false);
  });
});
