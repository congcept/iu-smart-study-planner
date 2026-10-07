import {
  ListOwnSemesterAllocationRunsSchema,
  OwnSemesterAllocationHistorySchema,
  type OwnSemesterAllocationRunV1DTO,
} from '@iu-study-planner/shared';

const id = (n: number) => `aaaaaaaa-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const run = (n = 1): OwnSemesterAllocationRunV1DTO => ({
  id: id(n),
  formatVersion: 1,
  capturedAt: '2026-10-06T01:00:00.000Z',
  createdAt: '2026-10-06T01:00:01.000Z',
  snapshotStored: true,
  simulationAssignmentsStored: true,
  kind: 'SIMULATION',
  usage: 'REFERENCE_ONLY',
  model: 'SEMESTER_CREDIT_BUDGET_V1',
  scope: { curriculumId: id(90), semester: 'FALL', year: 2026 },
  eligibilityValidated: false,
  allocationValidated: false,
  timetableValidated: false,
  academicPlansChanged: false,
  result: {
    targetCredits: 6,
    courseIds: [id(99)],
    assignedCredits: 6,
    remainingCredits: 0,
    reason: 'TARGET_REACHED',
  },
  courses: [{ courseId: id(99), credits: 6 }],
});
const page = (runs: unknown[] = [run()]) => ({
  kind: 'SIMULATION',
  usage: 'REFERENCE_ONLY',
  visibility: 'CURRENT_ACCOUNT_ONLY',
  order: 'STORED_NEWEST_FIRST',
  pageSize: 5,
  after: null,
  runs,
  nextAfter: null,
});

describe('bounded own semester history contract', () => {
  it('accepts empty history and exact five-result continuation without inventing scope filters', () => {
    expect(OwnSemesterAllocationHistorySchema.parse(page([])).runs).toEqual([]);
    const runs = [5, 4, 3, 2, 1].map(run);
    runs[0].scope.semester = 'SPRING';
    runs[1].scope.curriculumId = id(91);
    const result = OwnSemesterAllocationHistorySchema.parse({
      ...page(runs),
      nextAfter: id(1).toUpperCase(),
    });
    expect(result.nextAfter).toBe(id(1));
    expect(result.runs[0].scope.semester).toBe('SPRING');
  });
  it('normalizes only a strict continuation query without accepting identities or page budgets', () => {
    expect(ListOwnSemesterAllocationRunsSchema.parse({})).toEqual({});
    expect(ListOwnSemesterAllocationRunsSchema.parse({ after: id(1).toUpperCase() })).toEqual({
      after: id(1),
    });
    for (const query of [
      { userId: id(1) },
      { curriculumId: id(90) },
      { limit: 100 },
      { after: [id(1)] },
      { after: `${id(1)} ` },
      { after: 'invalid' },
    ])
      expect(ListOwnSemesterAllocationRunsSchema.safeParse(query).success).toBe(false);
  });
  it('rejects duplicate, ascending, excessive or boundary-repeated results', () => {
    for (const value of [
      page([run(), run()]),
      page([run(1), run(2)]),
      page([6, 5, 4, 3, 2, 1].map(run)),
      { ...page(), after: id(1) },
      { ...page(), pageSize: 20 },
    ])
      expect(OwnSemesterAllocationHistorySchema.safeParse(value).success).toBe(false);
  });
  it('orders by storage time before ID and preserves submillisecond ordering', () => {
    const recent = { ...run(1), createdAt: '2026-10-06T01:00:01.000002Z' };
    const earlier = { ...run(2), createdAt: '2026-10-06T01:00:01.000001Z' };
    expect(OwnSemesterAllocationHistorySchema.safeParse(page([recent, earlier])).success).toBe(
      true,
    );
    expect(OwnSemesterAllocationHistorySchema.safeParse(page([earlier, recent])).success).toBe(
      false,
    );
  });
  it('allows a terminal full page but requires any continuation to reference its last result', () => {
    const full = page([5, 4, 3, 2, 1].map(run));
    expect(OwnSemesterAllocationHistorySchema.safeParse(full).success).toBe(true);
    for (const value of [
      { ...page(), nextAfter: id(1) },
      { ...full, nextAfter: id(2) },
      { ...page([]), nextAfter: id(1) },
    ])
      expect(OwnSemesterAllocationHistorySchema.safeParse(value).success).toBe(false);
  });
  it('rejects participant, author, roster and aggregate additions rather than stripping them', () => {
    for (const field of [
      'userId',
      'studentId',
      'createdById',
      'requestId',
      'input',
      'students',
      'envelope',
    ]) {
      expect(
        OwnSemesterAllocationHistorySchema.safeParse({ ...page(), [field]: id(8) }).success,
      ).toBe(false);
      expect(
        OwnSemesterAllocationHistorySchema.safeParse(page([{ ...run(), [field]: id(8) }])).success,
      ).toBe(false);
    }
  });
  it('rejects inconsistent own credits, private outcome identities and official validation claims', () => {
    for (const entry of [
      { ...run(), result: { ...run().result, assignedCredits: 5 } },
      { ...run(), result: { ...run().result, studentId: id(8) } },
      { ...run(), eligibilityValidated: true },
      { ...run(), academicPlansChanged: true },
      { ...run(), courses: [{ courseId: id(98), credits: 6 }] },
    ])
      expect(OwnSemesterAllocationHistorySchema.safeParse(page([entry])).success).toBe(false);
  });
});
