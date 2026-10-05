import {
  AllocationJobSchema,
  CreateAllocationJobSchema,
  ResourceScopeSchema,
  type AllocationJobDTO,
  type CreateAllocationJobDTO,
} from '@iu-study-planner/shared';

const curriculumId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const actorId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const requestId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const jobId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const scope = { curriculumId, semester: 'FALL' as const, year: 2026 };
const createRequest = (): CreateAllocationJobDTO => ({
  ...scope,
  requestId,
  expectedActorId: actorId,
});
const queuedJob = (): AllocationJobDTO => ({
  id: jobId,
  kind: 'SIMULATION',
  usage: 'REFERENCE_ONLY',
  scope,
  status: 'QUEUED',
  queuedAt: '2026-10-05T08:00:00.000Z',
  inputsCaptured: false,
});

describe('immutable simulation allocation queue contracts', () => {
  it('accepts an explicit scenario request with a mandatory actor precondition', () => {
    expect(CreateAllocationJobSchema.parse(createRequest())).toEqual(createRequest());
  });

  it('normalizes all enqueue UUIDs without inferring or replacing the actor', () => {
    expect(
      CreateAllocationJobSchema.parse({
        ...createRequest(),
        curriculumId: curriculumId.toUpperCase(),
        requestId: requestId.toUpperCase(),
        expectedActorId: actorId.toUpperCase(),
      }),
    ).toEqual(createRequest());
  });

  it.each(['curriculumId', 'semester', 'year', 'requestId', 'expectedActorId'])(
    'rejects enqueue requests missing %s',
    (field) => {
      const input: Record<string, unknown> = createRequest();
      delete input[field];
      expect(CreateAllocationJobSchema.safeParse(input).success).toBe(false);
    },
  );

  it.each([
    { curriculumId: 'CS' },
    { requestId: '' },
    { requestId: null },
    { expectedActorId: 'ADMIN' },
    { expectedActorId: null },
    { curriculumId: `${curriculumId}\n` },
    { requestId: ` ${requestId}` },
    { expectedActorId: `${actorId}\n` },
    { semester: 'WINTER' },
    { semester: 'fall' },
    { year: 1999 },
    { year: 2101 },
    { year: 2026.5 },
    { year: '2026' },
    { year: Number.NaN },
    { year: Number.POSITIVE_INFINITY },
  ])('rejects malformed enqueue scope or identity %#', (fields) => {
    expect(CreateAllocationJobSchema.safeParse({ ...createRequest(), ...fields }).success).toBe(
      false,
    );
  });

  it.each([
    { id: jobId },
    { createdById: actorId },
    { actorId },
    { status: 'QUEUED' },
    { queuedAt: '2026-10-05T08:00:00.000Z' },
    { inputsCaptured: false },
    { resourceRevision: 1 },
    { students: [] },
    { result: {} },
    { policy: {} },
    { scheduledAt: '2026-10-06T08:00:00.000Z' },
    { runNow: true },
  ])('rejects client-owned source, execution or simulation inputs %#', (fields) => {
    expect(CreateAllocationJobSchema.safeParse({ ...createRequest(), ...fields }).success).toBe(
      false,
    );
  });

  it.each(['FALL', 'SPRING', 'SUMMER'] as const)(
    'preserves the existing resource scenario contract for %s and both year bounds',
    (semester) => {
      for (const year of [2000, 2026, 2100]) {
        const scenario = { ...scope, semester, year };
        const request = CreateAllocationJobSchema.parse({ ...createRequest(), ...scenario });
        const job = AllocationJobSchema.parse({ ...queuedJob(), scope: scenario });
        expect(job.scope).toEqual(ResourceScopeSchema.parse(scenario));
        expect({
          curriculumId: request.curriculumId,
          semester: request.semester,
          year: request.year,
        }).toEqual(job.scope);
      }
    },
  );

  it('accepts a private-free queued receipt with explicitly uncaptured inputs', () => {
    const result = AllocationJobSchema.parse(queuedJob());
    expect(result).toEqual(queuedJob());
    expect(Object.keys(result).sort()).toEqual(
      ['id', 'kind', 'usage', 'scope', 'status', 'queuedAt', 'inputsCaptured'].sort(),
    );
  });

  it('normalizes receipt and nested scenario UUIDs', () => {
    expect(
      AllocationJobSchema.parse({
        ...queuedJob(),
        id: jobId.toUpperCase(),
        scope: { ...scope, curriculumId: curriculumId.toUpperCase() },
      }),
    ).toEqual(queuedJob());
  });

  it.each(['id', 'kind', 'usage', 'scope', 'status', 'queuedAt', 'inputsCaptured'])(
    'rejects receipts missing %s',
    (field) => {
      const input: Record<string, unknown> = queuedJob();
      delete input[field];
      expect(AllocationJobSchema.safeParse(input).success).toBe(false);
    },
  );

  it.each([
    { id: 'job-1' },
    { id: `${jobId}\n` },
    { kind: 'ENROLLMENT' },
    { usage: 'VALIDATED' },
    { status: 'RUNNING' },
    { status: 'SUCCEEDED' },
    { status: 'FAILED' },
    { status: 'queued' },
    { inputsCaptured: true },
    { inputsCaptured: null },
    { inputsCaptured: 'false' },
    { queuedAt: 'yesterday' },
    { queuedAt: '2026-10-05' },
    { queuedAt: '2026-10-05T08:00:00' },
    { queuedAt: '2026-10-05T08:00:00+07:00' },
    { queuedAt: 1791187200000 },
  ])('rejects malformed receipt metadata and unsupported execution claims %#', (fields) => {
    expect(AllocationJobSchema.safeParse({ ...queuedJob(), ...fields }).success).toBe(false);
  });

  it.each([
    { createdById: actorId },
    { requestId },
    { expectedActorId: actorId },
    { leaseToken: requestId },
    { studentIds: [actorId] },
    { scores: [] },
    { runId: requestId },
    { result: {} },
    { assignmentsPersisted: true },
    { startedAt: '2026-10-05T08:00:00.000Z' },
    { scheduledAt: '2026-10-06T08:00:00.000Z' },
  ])('rejects private data and premature lifecycle fields in receipts %#', (fields) => {
    expect(AllocationJobSchema.safeParse({ ...queuedJob(), ...fields }).success).toBe(false);
  });

  it.each([
    { curriculumId: 'CS' },
    { curriculumId: `${curriculumId}\n` },
    { semester: 'WINTER' },
    { year: 1999 },
    { year: 2101 },
    { year: 2026.5 },
    { year: '2026' },
    { createdById: actorId },
    { requestId },
    { students: [] },
  ])('rejects malformed or private nested receipt scope %#', (fields) => {
    expect(
      AllocationJobSchema.safeParse({ ...queuedJob(), scope: { ...scope, ...fields } }).success,
    ).toBe(false);
  });
});
