import { randomUUID } from 'node:crypto';
import {
  ListSemesterAllocationJobsSchema,
  SemesterAllocationJobHistorySchema,
} from '@iu-study-planner/shared';

describe('strict semester request history contracts', () => {
  const scope = { curriculumId: randomUUID(), semester: 'FALL' as const, year: 2026 };
  const receipt = (n: number) => ({
    id: `11111111-1111-4111-8111-${String(n).padStart(12, '0')}`,
    kind: 'SIMULATION' as const,
    usage: 'REFERENCE_ONLY' as const,
    model: 'SEMESTER_CREDIT_BUDGET_V1' as const,
    scope,
    status: 'QUEUED' as const,
    queuedAt: '2026-10-08T00:00:00.000Z',
    inputsCaptured: false as const,
  });
  const entry = (n: number) => {
    const job = receipt(n);
    return {
      job,
      outcome: {
        jobId: job.id,
        kind: job.kind,
        usage: job.usage,
        model: job.model,
        scope,
        queuedAt: job.queuedAt,
        executionModel: 'ATOMIC_SINGLE_JOB' as const,
        status: 'PENDING' as const,
        runId: null,
        completedAt: null,
        failureCode: null,
      },
    };
  };
  const page = () => ({
    kind: 'SIMULATION',
    usage: 'REFERENCE_ONLY',
    model: 'SEMESTER_CREDIT_BUDGET_V1',
    scope,
    order: 'QUEUED_NEWEST_FIRST',
    pageSize: 5,
    after: null,
    requests: [5, 4, 3, 2, 1].map(entry),
    nextAfter: receipt(1).id,
  });
  it('accepts paired immutable receipts and bounded pending outcomes', () => {
    expect(SemesterAllocationJobHistorySchema.parse(page())).toEqual(page());
  });
  it('accepts empty first and exhausted continuation pages', () => {
    for (const after of [null, receipt(6).id])
      expect(
        SemesterAllocationJobHistorySchema.safeParse({
          ...page(),
          requests: [],
          after,
          nextAfter: null,
        }).success,
      ).toBe(true);
  });
  it('accepts a short final page and a full page without another continuation', () => {
    expect(
      SemesterAllocationJobHistorySchema.safeParse({
        ...page(),
        requests: [entry(1)],
        nextAfter: null,
      }).success,
    ).toBe(true);
    expect(
      SemesterAllocationJobHistorySchema.safeParse({ ...page(), nextAfter: null }).success,
    ).toBe(true);
  });
  it('accepts coherent success and failure without private payloads', () => {
    const data = page();
    const success = {
      ...entry(5),
      outcome: {
        ...entry(5).outcome,
        status: 'SUCCEEDED',
        runId: randomUUID(),
        completedAt: '2026-10-08T00:01:00.000Z',
      },
    };
    const failure = {
      ...entry(4),
      outcome: {
        ...entry(4).outcome,
        status: 'FAILED',
        failureCode: 'AUTHOR_UNAVAILABLE',
        completedAt: '2026-10-08T00:01:00.000Z',
      },
    };
    expect(
      SemesterAllocationJobHistorySchema.safeParse({
        ...data,
        requests: [success, failure, ...data.requests.slice(2)],
      }).success,
    ).toBe(true);
  });
  it.each(['userId', 'createdById', 'requestId', 'pageSize', 'status', 'model'])(
    'rejects query override %s',
    (key) => {
      expect(
        ListSemesterAllocationJobsSchema.safeParse({ ...scope, [key]: randomUUID() }).success,
      ).toBe(false);
    },
  );
  it('normalizes all scope and continuation UUIDs', () => {
    const after = randomUUID();
    expect(
      ListSemesterAllocationJobsSchema.parse({
        ...scope,
        curriculumId: scope.curriculumId.toUpperCase(),
        after: after.toUpperCase(),
      }),
    ).toEqual({ ...scope, after });
  });
  it.each([
    { after: 'missing' },
    { after: `${receipt(1).id}\n` },
    { year: 1999 },
    { year: 2101 },
    { year: 2026.5 },
    { semester: 'WINTER' },
  ])('rejects invalid query %j', (change) => {
    expect(ListSemesterAllocationJobsSchema.safeParse({ ...scope, ...change }).success).toBe(false);
  });
  it.each(['students', 'createdById', 'requestId', 'result', 'policy', 'totalCount'])(
    'rejects private or unsupported page field %s',
    (key) => {
      expect(SemesterAllocationJobHistorySchema.safeParse({ ...page(), [key]: [] }).success).toBe(
        false,
      );
    },
  );
  it('rejects extra private fields in either receipt, outcome or pair', () => {
    for (const request of [
      { ...entry(1), requestId: randomUUID() },
      { ...entry(1), job: { ...receipt(1), createdById: randomUUID() } },
      { ...entry(1), outcome: { ...entry(1).outcome, students: [] } },
    ])
      expect(
        SemesterAllocationJobHistorySchema.safeParse({
          ...page(),
          requests: [request],
          nextAfter: null,
        }).success,
      ).toBe(false);
  });
  it('rejects duplicate request IDs and a returned continuation boundary', () => {
    expect(
      SemesterAllocationJobHistorySchema.safeParse({
        ...page(),
        requests: [entry(1), entry(1)],
        nextAfter: null,
      }).success,
    ).toBe(false);
    expect(
      SemesterAllocationJobHistorySchema.safeParse({ ...page(), after: receipt(3).id }).success,
    ).toBe(false);
  });
  it('rejects over-sized pages and non-last/short-page continuations', () => {
    for (const change of [
      { requests: [6, 5, 4, 3, 2, 1].map(entry) },
      { nextAfter: receipt(2).id },
      { requests: [entry(1)], nextAfter: receipt(1).id },
    ])
      expect(SemesterAllocationJobHistorySchema.safeParse({ ...page(), ...change }).success).toBe(
        false,
      );
  });
  it.each([
    { jobId: randomUUID() },
    { scope: { ...scope, year: 2027 } },
    { queuedAt: '2026-10-08T00:00:00.001Z' },
    { model: 'SEMESTER_CREDIT_BUDGET_V2' },
  ])('rejects outcome/receipt mismatch %j', (change) => {
    expect(
      SemesterAllocationJobHistorySchema.safeParse({
        ...page(),
        requests: [{ ...entry(1), outcome: { ...entry(1).outcome, ...change } }],
        nextAfter: null,
      }).success,
    ).toBe(false);
  });
  it('rejects a pair in another scenario and a future page model', () => {
    expect(
      SemesterAllocationJobHistorySchema.safeParse({ ...page(), scope: { ...scope, year: 2027 } })
        .success,
    ).toBe(false);
    expect(
      SemesterAllocationJobHistorySchema.safeParse({
        ...page(),
        model: 'SEMESTER_CREDIT_BUDGET_V2',
      }).success,
    ).toBe(false);
  });
  it('uses descending IDs for tied queue timestamps', () => {
    expect(
      SemesterAllocationJobHistorySchema.safeParse({
        ...page(),
        requests: [entry(1), entry(2)],
        nextAfter: null,
      }).success,
    ).toBe(false);
  });
  it('orders queue timestamps before identifiers, including submillisecond precision', () => {
    const at = (n: number, queuedAt: string) => ({
      job: { ...receipt(n), queuedAt },
      outcome: { ...entry(n).outcome, queuedAt },
    });
    const requests = [at(1, '2026-10-08T00:00:00.0002Z'), at(2, '2026-10-08T00:00:00.0001Z')];
    expect(
      SemesterAllocationJobHistorySchema.safeParse({ ...page(), requests, nextAfter: null })
        .success,
    ).toBe(true);
    expect(
      SemesterAllocationJobHistorySchema.safeParse({
        ...page(),
        requests: [...requests].reverse(),
        nextAfter: null,
      }).success,
    ).toBe(false);
  });
});
