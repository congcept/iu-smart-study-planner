import {
  AllocationRunHistorySchema,
  AllocationRunV1Schema,
  ListAllocationRunsSchema,
  type ResourceScopeDTO,
} from '@iu-study-planner/shared';

const curriculumId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const otherId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const scope: ResourceScopeDTO = { curriculumId, semester: 'FALL', year: 2026 };
const id = (index: number) => `aaaaaaaa-aaaa-4aaa-8aaa-${index.toString(16).padStart(12, '0')}`;
const run = (index: number, createdAt = '2026-10-05T02:00:00.000Z', runScope = scope) =>
  AllocationRunV1Schema.parse({
    id: id(index),
    formatVersion: 1,
    capturedAt: '2026-10-05T01:00:00.000Z',
    createdAt,
    snapshotStored: true,
    result: {
      kind: 'SIMULATION',
      usage: 'REFERENCE_ONLY',
      model: 'ONE_COURSE_PER_STUDENT_ROUND_V1',
      utilityBasis: 'BAYESIAN_DIFFICULTY_AND_IMMEDIATE_UNLOCKS_V1',
      assignmentsPersisted: false,
      eligibilityValidated: false,
      timetableValidated: false,
      allocationValidated: false,
      categoryPersonalizationAvailable: false,
      gradePersonalizationAvailable: false,
      timelinePersonalizationAvailable: false,
      scope: runScope,
      curriculum: { id: runScope.curriculumId, code: 'REF', name: 'Reference', school: 'CSE' },
      cohortStudentCount: 0,
      demandStudentCount: 0,
      unresolvedGpaStudentCount: 0,
      assignedStudentCount: 0,
      noChoicesStudentCount: 0,
      resourceUnknownStudentCount: 0,
      capacityExhaustedStudentCount: 0,
      usedSections: 0,
      utilityPolicy: { difficultyFitWeight: 0.7, immediateUnlockWeight: 0.3 },
      allocationPolicy: {
        studentUtilityWeight: 0.6,
        resourceFitWeight: 0.25,
        fairnessWeight: 0.15,
        congestionThreshold: 0.85,
      },
      recommendationPolicy: { maxCredits: 18, maxDifficulty: 3.5 },
      resources: null,
      courses: [],
    },
  });
const page = (length = 0) => ({
  kind: 'SIMULATION' as const,
  usage: 'REFERENCE_ONLY' as const,
  scope,
  order: 'STORED_NEWEST_FIRST' as const,
  pageSize: 20 as const,
  runs: Array.from({ length }, (_, index) => run(length - index)),
  nextAfter: null as string | null,
});

describe('bounded immutable allocation run history contract', () => {
  it.each([0, 1, 19, 20])('accepts a terminal page with %i pinned runs', (length) => {
    const input = page(length);
    expect(AllocationRunHistorySchema.parse(input)).toEqual(input);
  });

  it('accepts a full page continuation only at the final displayed run', () => {
    const input = page(20);
    input.nextAfter = input.runs.at(-1)!.id;
    expect(AllocationRunHistorySchema.parse(input)).toEqual(input);
  });

  it('normalizes page, run, nested curriculum and continuation UUIDs before comparison', () => {
    const input = page(20);
    const expected = { ...input, nextAfter: input.runs.at(-1)!.id };
    expect(
      AllocationRunHistorySchema.parse({
        ...input,
        scope: { ...scope, curriculumId: curriculumId.toUpperCase() },
        runs: input.runs.map((value) => ({
          ...value,
          id: value.id.toUpperCase(),
          result: {
            ...value.result,
            scope: { ...scope, curriculumId: curriculumId.toUpperCase() },
            curriculum: { ...value.result.curriculum, id: curriculumId.toUpperCase() },
          },
        })),
        nextAfter: expected.nextAfter.toUpperCase(),
      }),
    ).toEqual(expected);
  });

  it.each([
    { pageSize: 0 },
    { pageSize: 19 },
    { pageSize: 21 },
    { pageSize: '20' },
    { order: 'CAPTURED_NEWEST_FIRST' },
    { kind: 'ENROLLMENT' },
    { usage: 'VALIDATED' },
    { actorId: otherId },
    { requestId: otherId },
    { total: 100 },
    { nextAfter: undefined },
    { nextAfter: 'invalid' },
    { runs: undefined },
  ])('rejects invalid bounds, private or expanded page metadata %#', (fields) => {
    expect(AllocationRunHistorySchema.safeParse({ ...page(), ...fields }).success).toBe(false);
  });

  it('rejects more than the fixed twenty displayed rows', () => {
    expect(AllocationRunHistorySchema.safeParse(page(21)).success).toBe(false);
  });

  it.each([0, 1, 19])('rejects continuation on a partial page of %i runs', (length) => {
    const input = page(length);
    expect(
      AllocationRunHistorySchema.safeParse({ ...input, nextAfter: input.runs.at(-1)?.id ?? id(1) })
        .success,
    ).toBe(false);
  });

  it.each([id(2), otherId])(
    'rejects a full-page cursor that does not identify its last run %s',
    (nextAfter) => {
      expect(AllocationRunHistorySchema.safeParse({ ...page(20), nextAfter }).success).toBe(false);
    },
  );

  it('rejects duplicate run identities after case normalization', () => {
    const first = run(2);
    expect(
      AllocationRunHistorySchema.safeParse({
        ...page(),
        runs: [first, { ...first, id: first.id.toUpperCase() }],
      }).success,
    ).toBe(false);
  });

  it.each([{ curriculumId: otherId }, { semester: 'SPRING' as const }, { year: 2027 }])(
    'rejects internally valid runs from a different scenario %#',
    (fields) => {
      expect(
        AllocationRunHistorySchema.safeParse({
          ...page(),
          runs: [run(1, undefined, { ...scope, ...fields })],
        }).success,
      ).toBe(false);
    },
  );

  it.each([
    { curriculumId: 'REF' },
    { semester: 'WINTER' },
    { year: 1999 },
    { year: 2101 },
    { year: 2026.5 },
    { year: '2026' },
    { actorId: otherId },
  ])('rejects malformed or expanded page scope %#', (fields) => {
    expect(
      AllocationRunHistorySchema.safeParse({ ...page(), scope: { ...scope, ...fields } }).success,
    ).toBe(false);
  });

  it('orders storage time before UUID and capture time', () => {
    const newest = run(1, '2026-10-05T02:00:02.000Z');
    newest.capturedAt = '2026-10-05T00:00:00.000Z';
    const oldest = run(2, '2026-10-05T02:00:01.000Z');
    const input = { ...page(), runs: [newest, oldest] };
    expect(AllocationRunHistorySchema.safeParse(input).success).toBe(true);
    expect(AllocationRunHistorySchema.safeParse({ ...input, runs: [oldest, newest] }).success).toBe(
      false,
    );
  });

  it('orders equal storage times by UUID descending', () => {
    expect(
      AllocationRunHistorySchema.safeParse({ ...page(), runs: [run(2), run(1)] }).success,
    ).toBe(true);
    expect(
      AllocationRunHistorySchema.safeParse({ ...page(), runs: [run(1), run(2)] }).success,
    ).toBe(false);
  });

  it('distinguishes submillisecond storage timestamps before the UUID tiebreaker', () => {
    const newest = run(1, '2026-10-05T02:00:00.0009Z');
    const oldest = run(2, '2026-10-05T02:00:00.0001Z');
    expect(
      AllocationRunHistorySchema.safeParse({ ...page(), runs: [newest, oldest] }).success,
    ).toBe(true);
    expect(
      AllocationRunHistorySchema.safeParse({ ...page(), runs: [oldest, newest] }).success,
    ).toBe(false);
  });

  it.each([
    ['2026-10-05T02:00:00Z', '2026-10-05T02:00:00.000Z'],
    ['2026-10-05T02:00:00.1Z', '2026-10-05T02:00:00.100000Z'],
    ['2026-10-05T02:00:00.0009Z', '2026-10-05T02:00:00.000900Z'],
  ])('uses UUID ordering when storage fractions represent the same time %#', (left, right) => {
    expect(
      AllocationRunHistorySchema.safeParse({ ...page(), runs: [run(2, left), run(1, right)] })
        .success,
    ).toBe(true);
    expect(
      AllocationRunHistorySchema.safeParse({ ...page(), runs: [run(1, left), run(2, right)] })
        .success,
    ).toBe(false);
  });

  it.each([
    { formatVersion: 2 },
    { snapshotStored: false },
    { createdAt: 'yesterday' },
    { capturedAt: '2026-10-06T01:00:00.000Z' },
    { createdById: otherId },
    { requestId: otherId },
    { studentIds: [otherId] },
  ])('rejects unsupported, corrupt or private pinned run fields %#', (fields) => {
    expect(
      AllocationRunHistorySchema.safeParse({ ...page(), runs: [{ ...run(1), ...fields }] }).success,
    ).toBe(false);
  });

  it.each([
    { cohortStudentCount: 1 },
    { assignedStudentCount: 1 },
    { usedSections: 1 },
    { assignmentsPersisted: true },
    { studentId: otherId },
    { assignments: [] },
    { utilityPolicy: { difficultyFitWeight: 0.8, immediateUnlockWeight: 0.3 } },
    { recommendationPolicy: { maxCredits: 31, maxDifficulty: 3 } },
  ])('rejects corrupt counts, claims or private pinned result fields %#', (fields) => {
    const value = run(1);
    expect(
      AllocationRunHistorySchema.safeParse({
        ...page(),
        runs: [{ ...value, result: { ...value.result, ...fields } }],
      }).success,
    ).toBe(false);
  });

  it('rejects private identifiers in otherwise valid zero-demand course rows', () => {
    const value = run(1);
    const course = {
      id: otherId,
      code: 'C1',
      name: 'Course one',
      demandStudentCount: 0,
      assignedStudentCount: 0,
      openedSections: 0,
      seatCapacity: 0,
      seatUtilization: null,
    };
    expect(
      AllocationRunHistorySchema.safeParse({
        ...page(),
        runs: [{ ...value, result: { ...value.result, courses: [course] } }],
      }).success,
    ).toBe(true);
    expect(
      AllocationRunHistorySchema.safeParse({
        ...page(),
        runs: [
          {
            ...value,
            result: {
              ...value.result,
              courses: [{ ...course, studentIds: [otherId], studentUtility: 0.5 }],
            },
          },
        ],
      }).success,
    ).toBe(false);
  });

  it('accepts a normalized scenario-only list request with an optional cursor', () => {
    expect(
      ListAllocationRunsSchema.parse({
        ...scope,
        curriculumId: curriculumId.toUpperCase(),
        after: otherId.toUpperCase(),
      }),
    ).toEqual({ ...scope, after: otherId });
    expect(ListAllocationRunsSchema.parse(scope)).toEqual(scope);
  });

  it.each([
    { curriculumId: 'REF' },
    { semester: 'WINTER' },
    { year: 1999 },
    { year: 2101 },
    { year: 2026.5 },
    { year: '2026' },
    { after: '' },
    { after: 'cursor' },
    { after: null },
    { limit: 100 },
    { pageSize: 20 },
    { actorId: otherId },
    { createdById: otherId },
    { requestId: otherId },
    { order: 'asc' },
  ])('rejects malformed scope/cursor or expanded listing controls %#', (fields) => {
    expect(ListAllocationRunsSchema.safeParse({ ...scope, ...fields }).success).toBe(false);
  });
});
