import { randomUUID } from 'node:crypto';
import type { CourseStatus } from '@prisma/client';
import {
  EligibleCohortDemandPolicySchema,
  EligibleCohortDemandSnapshotSchema,
  type CurriculumCourseDTO,
  type CurriculumDetailDTO,
} from '@iu-study-planner/shared';
import { projectEligibleCohortDemand } from '../services/eligibleCohortDemand';

const ids = Array.from({ length: 10 }, () => randomUUID());
const course = (index: number, year = 1, semester = 1): CurriculumCourseDTO => ({
  id: ids[index],
  code: `TEST${index}IU`,
  name: `Reference ${index}`,
  credits: 3,
  difficultyLevel: 2,
  description: null,
  semesterOffered: [],
  avgRating: null,
  ratingCount: 0,
  ratingDifficulty: 2,
  ratingPriorMean: 2,
  ratingPriorSource: 'CURRICULUM_SEED',
  placements: [
    {
      id: randomUUID(),
      academicYear: year,
      academicSemester: semester,
      electiveGroup: null,
      electiveSelectCount: null,
      sourceOrder: index,
      sourceLabel: null,
    },
  ],
});
const context = (courses: CurriculumCourseDTO[], isGpaPath = false): CurriculumDetailDTO => ({
  id: ids[9],
  code: 'TEST',
  name: 'Reference curriculum',
  school: 'CSE',
  degree: 'Bachelor',
  programUrl: 'https://example.test/reference',
  totalCredits: null,
  isGpaPath,
  sourceLabel: null,
  sourceUrl: null,
  usage: 'REFERENCE_ONLY',
  courses,
  requirements: [],
  prerequisites: [],
  ratingPrior: courses.length ? { mean: 2, source: 'CURRICULUM_SEED' } : null,
});
const scope = { curriculumId: ids[9], semester: 'FALL' as const, year: 2026 };
const policy = { maxCredits: 18, maxDifficulty: 3.5 };
const student = (
  records: { courseId: string; status: CourseStatus }[] = [],
  attempts: { courseId: string; score: number | null }[] = [],
) => ({ id: randomUUID(), records, attempts });
const planned = (index: number) => ({ courseId: ids[index], status: 'PLANNED' as const });
const project = (source: CurriculumDetailDTO, students = [student()], options = policy) =>
  projectEligibleCohortDemand(scope, source, students, options);
const fork = () =>
  context(
    [course(0), { ...course(1, 4, 2), code: 'IT058IU' }, { ...course(2, 4, 2), code: 'IT168IU' }],
    true,
  );

describe('eligible cohort planned or reference-recommended demand projection', () => {
  it('counts each student once in the union and separately reports overlapping selections', () => {
    const repeated = course(0);
    repeated.placements.push({
      ...repeated.placements[0],
      id: randomUUID(),
      sourceOrder: 10,
      electiveGroup: 'Another group',
    });
    const result = project(context([repeated, course(1)]), [student([planned(0)]), student()]);
    expect(result).toMatchObject({
      cohortStudentCount: 2,
      demandStudentCount: 2,
      eligiblePlannedStudentCount: 1,
      recommendedStudentCount: 2,
      eligiblePlannedSelectionCount: 1,
      recommendedSelectionCount: 4,
      demandSelectionCount: 4,
      overlapSelectionCount: 1,
    });
    expect(result.courses).toEqual([
      {
        id: ids[0],
        code: 'TEST0IU',
        name: 'Reference 0',
        eligiblePlannedStudentCount: 1,
        recommendedStudentCount: 2,
        overlapStudentCount: 1,
        demandStudentCount: 2,
        supply: null,
        utilization: null,
      },
      {
        id: ids[1],
        code: 'TEST1IU',
        name: 'Reference 1',
        eligiblePlannedStudentCount: 0,
        recommendedStudentCount: 2,
        overlapStudentCount: 0,
        demandStudentCount: 2,
        supply: null,
        utilization: null,
      },
    ]);
  });

  it('retains eligible planned choices rejected by the recommendation credit budget', () => {
    const result = project(context([course(0), course(1)]), [student([planned(1)])], {
      ...policy,
      maxCredits: 3,
    });
    expect(result).toMatchObject({
      eligiblePlannedSelectionCount: 1,
      recommendedSelectionCount: 1,
      demandSelectionCount: 2,
      overlapSelectionCount: 0,
      eligiblePlannedStudentCount: 1,
      recommendedStudentCount: 1,
      demandStudentCount: 1,
    });
    expect(EligibleCohortDemandSnapshotSchema.safeParse(result).success).toBe(true);
    expect(result.courses[0]).toMatchObject({
      recommendedStudentCount: 1,
      eligiblePlannedStudentCount: 0,
      demandStudentCount: 1,
    });
    expect(result.courses[1]).toMatchObject({
      recommendedStudentCount: 0,
      eligiblePlannedStudentCount: 1,
      demandStudentCount: 1,
    });
  });

  it('counts zero-choice members and students without choices in the cohort', () => {
    const result = project(context([{ ...course(0), placements: [] }]), [
      student(),
      student([planned(0)]),
    ]);
    expect(result).toMatchObject({
      cohortStudentCount: 2,
      demandStudentCount: 0,
      demandSelectionCount: 0,
      ineligibleMemberPlannedSelectionCount: 1,
    });
    expect(result.courses[0].demandStudentCount).toBe(0);
    expect(project(context([]), [student([planned(0)])])).toMatchObject({
      cohortStudentCount: 1,
      ignoredNonmemberPlannedSelectionCount: 1,
      courses: [],
      demandSelectionCount: 0,
    });
    expect(project(context([course(0)]), [])).toMatchObject({
      cohortStudentCount: 0,
      demandStudentCount: 0,
    });
  });

  it.each([
    [true, false],
    [false, false],
    [true, true],
    [false, true],
  ])('requires every context edge for strict=%s/corequisite=%s', (isStrict, isCorequisite) => {
    const source = context([course(0), course(1)]);
    source.prerequisites.push({
      id: randomUUID(),
      courseId: ids[1],
      prerequisiteId: ids[0],
      isStrict,
      isCorequisite,
      mandatory: true,
    });
    const result = project(source, [
      student([planned(1)]),
      student([{ courseId: ids[0], status: 'COMPLETED' }, planned(1)]),
    ]);
    expect(result).toMatchObject({
      eligiblePlannedSelectionCount: 1,
      ineligibleMemberPlannedSelectionCount: 1,
      demandSelectionCount: 2,
    });
    expect(result.courses[1]).toMatchObject({ demandStudentCount: 1, overlapStudentCount: 1 });
  });

  it.each(['COMPLETED', 'IN_PROGRESS'] as const)(
    'excludes %s courses from both demand inputs',
    (status) => {
      const result = project(context([course(0)]), [student([{ courseId: ids[0], status }])]);
      expect(result).toMatchObject({
        demandSelectionCount: 0,
        eligiblePlannedSelectionCount: 0,
        recommendedSelectionCount: 0,
      });
    },
  );

  it('separates nonmember plans from unplaced member choices and ignores old record terms', () => {
    const result = project(context([course(0), { ...course(1), placements: [] }]), [
      student([planned(0), planned(1), planned(2)]),
    ]);
    expect(result).toMatchObject({
      eligiblePlannedSelectionCount: 1,
      ignoredNonmemberPlannedSelectionCount: 1,
      ineligibleMemberPlannedSelectionCount: 1,
      demandSelectionCount: 1,
    });
  });

  it('uses the requested term only as scenario identity and never filters global offerings', () => {
    const source = context([course(0), { ...course(1), semesterOffered: ['SPRING'] }]);
    const students = [student([planned(0)])];
    const fall = project(source, students);
    const summer = projectEligibleCohortDemand(
      { ...scope, semester: 'SUMMER', year: 2027 },
      source,
      students,
      policy,
    );
    expect(summer.courses).toEqual(fall.courses);
    expect(summer.termBasis).toBe('SCENARIO_ONLY');
  });

  it('defers unknown-GPA final-semester placements while preserving an earlier appearance', () => {
    const source = fork();
    source.courses[2].placements.push({ ...course(2, 3, 2).placements[0], sourceOrder: 20 });
    const result = project(source, [student([planned(1), planned(2)])]);
    expect(result).toMatchObject({
      unresolvedGpaStudentCount: 1,
      eligiblePlannedSelectionCount: 1,
      ineligibleMemberPlannedSelectionCount: 1,
      recommendedSelectionCount: 2,
      demandSelectionCount: 2,
    });
    expect(result.courses.find(({ id }) => id === ids[1])?.demandStudentCount).toBe(0);
    expect(result.courses.find(({ id }) => id === ids[2])?.demandStudentCount).toBe(1);
  });

  it('does not defer Y4S2 in a nonfork curriculum without grades', () => {
    const source = fork();
    source.isGpaPath = false;
    expect(project(source)).toMatchObject({
      unresolvedGpaStudentCount: 0,
      recommendedSelectionCount: 3,
    });
  });

  it.each([
    [70, 2],
    [70.00001, 1],
    [69.99, 2],
  ])('uses the exact GPA %s boundary for planned and recommended choices', (score, expected) => {
    const result = project(fork(), [
      student([planned(1), planned(2)], [{ courseId: ids[0], score }]),
    ]);
    expect(result).toMatchObject({
      unresolvedGpaStudentCount: 0,
      eligiblePlannedSelectionCount: 1,
      ineligibleMemberPlannedSelectionCount: 1,
    });
    expect(result.courses.find(({ id }) => id === ids[expected])?.overlapStudentCount).toBe(1);
  });

  it('uses highest retakes, member-only credit weighting and excludes physical training scores', () => {
    const source = fork();
    source.courses[0].credits = 1;
    source.courses.push(course(3), { ...course(4), code: 'PT001IU' });
    const result = project(source, [
      student(
        [planned(1), planned(2)],
        [
          { courseId: ids[0], score: 0.16 },
          { courseId: ids[0], score: 0.1 },
          { courseId: ids[3], score: 93.28 },
          { courseId: ids[4], score: 100 },
          { courseId: ids[8], score: 100 },
        ],
      ),
    ]);
    expect(result.courses.find(({ id }) => id === ids[1])?.demandStudentCount).toBe(0);
    expect(result.courses.find(({ id }) => id === ids[2])?.overlapStudentCount).toBe(1);
    expect(result.unresolvedGpaStudentCount).toBe(0);
    const high = project(fork(), [
      student(
        [],
        [
          { courseId: ids[0], score: 20 },
          { courseId: ids[0], score: 90 },
        ],
      ),
    ]);
    expect(high.courses.find(({ id }) => id === ids[1])?.recommendedStudentCount).toBe(1);
  });

  it('counts physical training credits against the recommendation budget', () => {
    const source = context([{ ...course(0), code: 'PT001IU' }, course(1)]);
    const result = project(source, [student()], { ...policy, maxCredits: 3 });
    expect(result.recommendedSelectionCount).toBe(1);
    expect(result.courses[0].recommendedStudentCount).toBe(1);
    expect(result.courses[1].recommendedStudentCount).toBe(0);
  });

  it('leaves inputs unchanged, publishes aggregates only and declares validation limits', () => {
    const source = fork();
    const students = [student([planned(0)])];
    const before = JSON.stringify({ source, students });
    const result = project(source, students);
    expect(JSON.stringify({ source, students })).toBe(before);
    expect(JSON.stringify(result)).not.toContain(students[0].id);
    expect(result).toMatchObject({
      kind: 'SIMULATION',
      usage: 'REFERENCE_ONLY',
      recommendationPolicy: policy,
      recommendationDemandAvailable: true,
      eligibilityValidated: false,
      offeringValidationAvailable: false,
      allocationValidated: false,
      unknownGpaPolicy: 'DEFER_FORK_ONLY_PLACEMENTS',
      prerequisitePolicy: 'ALL_CONTEXT_PREREQUISITES_MANDATORY',
    });
    expect(EligibleCohortDemandSnapshotSchema.safeParse(result).success).toBe(true);
  });

  it('rejects duplicate students and duplicate per-student records, while accepting retake history', () => {
    const same = student();
    expect(() => project(context([course(0)]), [same, same])).toThrow();
    expect(() => project(context([course(0)]), [student([planned(0), planned(0)])])).toThrow();
    expect(() =>
      project(context([course(0)]), [
        student(
          [],
          [
            { courseId: ids[0], score: 70 },
            { courseId: ids[0], score: 90 },
          ],
        ),
      ]),
    ).not.toThrow();
  });

  it.each([-1, 100.1, NaN, Infinity])('rejects invalid persisted score %s', (score) => {
    expect(() =>
      project(context([course(0)]), [student([], [{ courseId: ids[0], score }])]),
    ).toThrow();
  });

  it('rejects mismatched context scope and malformed curriculum rating metadata', () => {
    expect(() => project({ ...context([course(0)]), id: randomUUID() })).toThrow();
    expect(() => project(context([{ ...course(0), ratingCount: -1 }]))).toThrow();
    expect(() => project(context([{ ...course(0), ratingDifficulty: NaN }]))).toThrow();
  });
});

describe('eligible cohort demand runtime contract', () => {
  it('rejects an impossible distinct union when the same student overlaps several courses', () => {
    const source = context([course(0), course(1)]);
    const snapshot = project(source, [
      student([planned(0), planned(1)]),
      student([
        { courseId: ids[0], status: 'COMPLETED' },
        { courseId: ids[1], status: 'COMPLETED' },
      ]),
    ]);
    expect(snapshot).toMatchObject({
      cohortStudentCount: 2,
      eligiblePlannedStudentCount: 1,
      recommendedStudentCount: 1,
      demandStudentCount: 1,
      overlapSelectionCount: 2,
    });
    expect(
      EligibleCohortDemandSnapshotSchema.safeParse({ ...snapshot, demandStudentCount: 2 }).success,
    ).toBe(false);
  });

  it.each([
    { maxCredits: 0, maxDifficulty: 3.5 },
    { maxCredits: 31, maxDifficulty: 3.5 },
    { maxCredits: 3.5, maxDifficulty: 3.5 },
    { maxCredits: 18, maxDifficulty: 0 },
    { maxCredits: 18, maxDifficulty: 5.1 },
    { maxCredits: 18, maxDifficulty: Infinity },
    { ...policy, semester: 'FALL' },
    { ...policy, completedIds: [] },
  ])('rejects malformed or overriding policy %#', (input) => {
    expect(EligibleCohortDemandPolicySchema.safeParse(input).success).toBe(false);
  });

  it.each([
    ['demandSelectionCount', 2],
    ['overlapSelectionCount', 2],
    ['demandStudentCount', 2],
    ['eligibilityValidated', true],
    ['offeringValidationAvailable', true],
    ['allocationValidated', true],
    ['users', []],
  ])('rejects inconsistent totals or unsupported snapshot field %s', (key, value) => {
    const valid = project(context([course(0)]), [student([planned(0)])]);
    expect(EligibleCohortDemandSnapshotSchema.safeParse({ ...valid, [key]: value }).success).toBe(
      false,
    );
  });
});
