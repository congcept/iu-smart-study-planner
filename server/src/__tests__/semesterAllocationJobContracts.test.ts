import {
  CreateSemesterAllocationJobSchema,
  SemesterAllocationJobSchema,
} from '@iu-study-planner/shared';

const actor = 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA';
const curriculum = 'BBBBBBBB-BBBB-4BBB-8BBB-BBBBBBBBBBBB';
const key = 'CCCCCCCC-CCCC-4CCC-8CCC-CCCCCCCCCCCC';
const scope = { curriculumId: curriculum, semester: 'FALL', year: 2026 };
const receipt = {
  id: key,
  kind: 'SIMULATION',
  usage: 'REFERENCE_ONLY',
  model: 'SEMESTER_CREDIT_BUDGET_V1',
  scope,
  status: 'QUEUED',
  queuedAt: '2026-10-07T05:00:00.000Z',
  inputsCaptured: false,
};

describe('semester queue intent contracts', () => {
  it('normalizes durable identifiers without capturing inputs or projecting execution', () => {
    expect(
      CreateSemesterAllocationJobSchema.parse({ ...scope, requestId: key, expectedActorId: actor }),
    ).toEqual({
      ...scope,
      curriculumId: curriculum.toLowerCase(),
      requestId: key.toLowerCase(),
      expectedActorId: actor.toLowerCase(),
    });
    expect(SemesterAllocationJobSchema.parse(receipt)).toEqual({
      ...receipt,
      id: key.toLowerCase(),
      scope: { ...scope, curriculumId: curriculum.toLowerCase() },
    });
  });
  it.each([
    'createdById',
    'userId',
    'model',
    'inputs',
    'students',
    'resources',
    'policies',
    'maxCredits',
    'status',
    'runId',
  ])('rejects caller-supplied %s in the scenario-only intent', (field) => {
    expect(
      CreateSemesterAllocationJobSchema.safeParse({
        ...scope,
        requestId: key,
        expectedActorId: actor,
        [field]: actor,
      }).success,
    ).toBe(false);
  });
  it.each([
    'createdById',
    'requestId',
    'students',
    'roster',
    'policies',
    'resourceRevision',
    'result',
    'run',
    'completedAt',
    'failureCode',
  ])('rejects private/captured/execution field %s in the immutable enqueue receipt', (field) => {
    expect(SemesterAllocationJobSchema.safeParse({ ...receipt, [field]: actor }).success).toBe(
      false,
    );
  });
  it.each([
    { model: 'ONE_COURSE_ROUND_V1' },
    { model: 'SEMESTER_CREDIT_BUDGET_V2' },
    { kind: 'OFFICIAL' },
    { usage: 'REGISTRATION' },
    { status: 'SUCCEEDED' },
    { status: 'PENDING' },
    { inputsCaptured: true },
    { queuedAt: '2026-10-07' },
    { scope: { ...scope, year: '2026' } },
    { scope: { ...scope, year: 1999 } },
    { scope: { ...scope, year: 2101 } },
    { scope: { ...scope, semester: 'AUTUMN' } },
    { scope: { ...scope, ownerId: actor } },
  ])('rejects incompatible or misleading receipt claims %j', (change) => {
    expect(SemesterAllocationJobSchema.safeParse({ ...receipt, ...change }).success).toBe(false);
  });
  it('requires exact UUIDs and an explicit expected actor before any retry lookup', () => {
    const input = { ...scope, requestId: key, expectedActorId: actor };
    for (const field of ['curriculumId', 'requestId', 'expectedActorId'] as const) {
      expect(
        CreateSemesterAllocationJobSchema.safeParse({ ...input, [field]: `${input[field]}\n` })
          .success,
      ).toBe(false);
      expect(
        CreateSemesterAllocationJobSchema.safeParse({ ...input, [field]: undefined }).success,
      ).toBe(false);
    }
  });
});
