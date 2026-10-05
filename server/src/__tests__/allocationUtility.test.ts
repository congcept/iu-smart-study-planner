import { randomUUID } from 'node:crypto';
import type {
  AllocationUtilityPolicyDTO,
  CourseStatus,
  CurriculumCourseDTO,
  CurriculumDetailDTO,
  GpaPath,
} from '@iu-study-planner/shared';
import {
  calculateAllocationStudentUtility,
  countImmediateCourseUnlocks,
} from '../services/allocationUtility';
import { projectEligibleCohortDemandWithChoices } from '../services/eligibleCohortDemand';

const ids = Array.from({ length: 9 }, () => randomUUID());
const policy: AllocationUtilityPolicyDTO = { difficultyFitWeight: 0.7, immediateUnlockWeight: 0.3 };
const course = (index: number, year = 1, semester = 1): CurriculumCourseDTO => ({
  id: ids[index],
  code: `UTIL${index}IU`,
  name: `Utility reference ${index}`,
  credits: 3,
  difficultyLevel: 3,
  description: null,
  semesterOffered: [],
  avgRating: null,
  ratingCount: 0,
  ratingDifficulty: 3,
  ratingPriorMean: 3,
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
const context = (courses = [course(0), course(1), course(2)]): CurriculumDetailDTO => ({
  id: ids[8],
  code: 'UTILITY',
  name: 'Utility reference curriculum',
  school: 'CSE',
  degree: 'Bachelor',
  programUrl: 'https://example.test/utility',
  totalCredits: null,
  isGpaPath: false,
  sourceLabel: null,
  sourceUrl: null,
  usage: 'REFERENCE_ONLY',
  courses,
  requirements: [],
  prerequisites: [],
  ratingPrior: { mean: 3, source: 'CURRICULUM_SEED' },
});
const edge = (child: number, parent: number, isStrict = true, isCorequisite = false) => ({
  id: randomUUID(),
  courseId: ids[child],
  prerequisiteId: ids[parent],
  isStrict,
  isCorequisite,
  mandatory: true as const,
});
const record = (index: number, status: CourseStatus) => ({ courseId: ids[index], status });
const count = (
  source: CurriculumDetailDTO,
  records: { courseId: string; status: CourseStatus }[] = [],
  path: GpaPath | null = null,
  candidates = [ids[0]],
) => countImmediateCourseUnlocks(source, records, path, candidates);

describe('allocation student utility', () => {
  it.each([
    [1, 0, 0.7],
    [5, 0, 0],
    [3, 1, 0.5],
    [3, 2, 0.55],
    [1, 3, 0.925],
    [5, 1, 0.15],
  ])(
    'computes difficulty %s and %s immediate unlocks as %s',
    (ratingDifficulty, immediateUnlockCount, expected) => {
      expect(
        calculateAllocationStudentUtility({ ratingDifficulty, immediateUnlockCount }, policy),
      ).toBeCloseTo(expected, 12);
    },
  );

  it('supports explicit difficulty-only and unlock-only policies without input mutation', () => {
    const input = { ratingDifficulty: 2, immediateUnlockCount: 3 };
    const before = JSON.stringify({ input, policy });
    expect(
      calculateAllocationStudentUtility(input, {
        difficultyFitWeight: 1,
        immediateUnlockWeight: 0,
      }),
    ).toBe(0.75);
    expect(
      calculateAllocationStudentUtility(input, {
        difficultyFitWeight: 0,
        immediateUnlockWeight: 1,
      }),
    ).toBe(0.75);
    expect(
      calculateAllocationStudentUtility(
        { ...input, immediateUnlockCount: 0 },
        { difficultyFitWeight: 0, immediateUnlockWeight: 1 },
      ),
    ).toBe(0);
    expect(JSON.stringify({ input, policy })).toBe(before);
  });

  it.each([0, 5.01, -1, NaN, Infinity, -Infinity])(
    'rejects invalid difficulty %s',
    (ratingDifficulty) => {
      expect(() =>
        calculateAllocationStudentUtility({ ratingDifficulty, immediateUnlockCount: 1 }, policy),
      ).toThrow();
    },
  );

  it.each([-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid unlock count %s',
    (immediateUnlockCount) => {
      expect(() =>
        calculateAllocationStudentUtility({ ratingDifficulty: 3, immediateUnlockCount }, policy),
      ).toThrow();
    },
  );

  it.each([
    { difficultyFitWeight: 0, immediateUnlockWeight: 0 },
    { difficultyFitWeight: 0.7, immediateUnlockWeight: 0.2 },
    { difficultyFitWeight: 1, immediateUnlockWeight: 1 },
    { difficultyFitWeight: -0.1, immediateUnlockWeight: 1.1 },
    { difficultyFitWeight: NaN, immediateUnlockWeight: 0.3 },
    { difficultyFitWeight: Infinity, immediateUnlockWeight: 0 },
    { ...policy, gradeFitWeight: 0 },
  ])('rejects invalid or unsupported utility policy %#', (invalid) => {
    expect(() =>
      calculateAllocationStudentUtility({ ratingDifficulty: 3, immediateUnlockCount: 1 }, invalid),
    ).toThrow();
  });

  it('rejects unsupported personalized input rather than silently accepting it', () => {
    const invalid = { ratingDifficulty: 3, immediateUnlockCount: 1, inferredGrade: 90 };
    expect(() => calculateAllocationStudentUtility(invalid, policy)).toThrow();
  });
});

describe('immediate mandatory-prerequisite unlocks', () => {
  it('counts a child only when the candidate is its sole remaining mandatory parent', () => {
    const source = context();
    source.prerequisites = [edge(2, 0), edge(2, 1)];
    expect(count(source, [], null, [ids[0], ids[1]])).toEqual(
      new Map([
        [ids[0], 0],
        [ids[1], 0],
      ]),
    );
    expect(count(source, [record(1, 'COMPLETED')])).toEqual(new Map([[ids[0], 1]]));
  });

  it.each(['IN_PROGRESS', 'PLANNED', 'FAILED'] as const)(
    'does not satisfy another parent with %s',
    (status) => {
      const source = context();
      source.prerequisites = [edge(2, 0), edge(2, 1)];
      expect(count(source, [record(1, status)]).get(ids[0])).toBe(0);
    },
  );

  it.each([
    [false, false],
    [true, false],
    [false, true],
    [true, true],
  ])('keeps strict=%s/corequisite=%s mandatory', (isStrict, isCorequisite) => {
    const source = context();
    source.prerequisites = [edge(2, 0), edge(2, 1, isStrict, isCorequisite)];
    expect(count(source).get(ids[0])).toBe(0);
    expect(count(source, [record(1, 'COMPLETED')]).get(ids[0])).toBe(1);
  });

  it.each(['COMPLETED', 'IN_PROGRESS'] as const)('excludes a child already %s', (status) => {
    const source = context();
    source.prerequisites = [edge(2, 0)];
    expect(count(source, [record(2, status)]).get(ids[0])).toBe(0);
  });

  it('still counts a planned child, excludes unplaced children and counts duplicate placements once', () => {
    const source = context();
    source.prerequisites = [edge(2, 0)];
    source.courses[2].placements.push({
      ...source.courses[2].placements[0],
      id: randomUUID(),
      sourceOrder: 20,
    });
    expect(count(source, [record(2, 'PLANNED')]).get(ids[0])).toBe(1);
    source.courses[2].placements = [];
    expect(count(source).get(ids[0])).toBe(0);
  });

  it('defensively deduplicates prerequisite edges and rejects a self unlock', () => {
    const source = context();
    source.prerequisites = [edge(2, 0), edge(2, 0), edge(0, 0)];
    expect(count(source).get(ids[0])).toBe(1);
  });

  it('counts only immediate children, not children still missing another course in the chain', () => {
    const source = context([course(0), course(1), course(2), course(3)]);
    source.prerequisites = [edge(1, 0), edge(2, 1), edge(3, 0)];
    expect(count(source).get(ids[0])).toBe(2);
    expect(count(source, [], null, [ids[0], ids[1]])).toEqual(
      new Map([
        [ids[0], 2],
        [ids[1], 1],
      ]),
    );
  });

  it.each([
    ['THESIS', 1],
    ['ALTERNATIVE', 1],
  ] as const)('counts only children placed in the known %s path', (path, expected) => {
    const source = context([
      course(0),
      { ...course(1, 4, 2), code: 'IT058IU' },
      { ...course(2, 4, 2), code: 'IT168IU' },
    ]);
    source.isGpaPath = true;
    source.prerequisites = [edge(1, 0), edge(2, 0)];
    expect(count(source, [], path).get(ids[0])).toBe(expected);
    const remainingChild = path === 'THESIS' ? 1 : 2;
    expect(count(source, [record(remainingChild, 'COMPLETED')], path).get(ids[0])).toBe(0);
  });

  it('respects caller-prefiltered unknown fork placements while keeping an earlier appearance', () => {
    const source = context([course(0), course(1, 4, 2), course(2, 4, 2)]);
    source.isGpaPath = true;
    source.prerequisites = [edge(1, 0), edge(2, 0)];
    source.courses[2].placements.push({ ...course(2, 3, 2).placements[0], sourceOrder: 20 });
    const filtered = {
      ...source,
      courses: source.courses.map((child) => ({
        ...child,
        placements: child.placements.filter(
          (placement) => !(placement.academicYear === 4 && placement.academicSemester === 2),
        ),
      })),
    };
    expect(count(filtered).get(ids[0])).toBe(1);
  });

  it('defensively defers raw unknown-GPA fork placements and keeps a nonfork appearance', () => {
    const source = context([course(0), course(1, 4, 2), course(2, 4, 2)]);
    source.isGpaPath = true;
    source.prerequisites = [edge(1, 0), edge(2, 0)];
    expect(count(source).get(ids[0])).toBe(0);
    source.courses[2].placements.push({ ...course(2, 3, 2).placements[0], sourceOrder: 20 });
    expect(count(source).get(ids[0])).toBe(1);
  });

  it('includes final-semester children without a GPA fork in a nonfork context', () => {
    const source = context([course(0), course(1, 4, 2)]);
    source.prerequisites = [edge(1, 0)];
    expect(count(source).get(ids[0])).toBe(1);
  });

  it('uses only supplied context membership and edges and leaves context/records unchanged', () => {
    const source = context();
    source.prerequisites = [edge(2, 0), edge(2, 1)];
    const records = [record(1, 'COMPLETED')];
    const before = JSON.stringify({ source, records });
    expect(count(source, records).get(ids[0])).toBe(1);
    expect(count({ ...source, prerequisites: [] }, records).get(ids[0])).toBe(0);
    // Historical completion of an identity absent from the current context is not a parent pass.
    expect(
      count({ ...source, courses: source.courses.filter(({ id }) => id !== ids[1]) }, records).get(
        ids[0],
      ),
    ).toBe(0);
    expect(JSON.stringify({ source, records })).toBe(before);
  });

  it('does not award an unlock to a candidate already completed', () => {
    const source = context();
    source.prerequisites = [edge(2, 0)];
    expect(count(source, [record(0, 'COMPLETED')]).get(ids[0])).toBe(0);
  });

  it('defensively excludes an in-progress candidate and a candidate absent from member metadata', () => {
    const source = context();
    source.prerequisites = [edge(2, 0)];
    expect(count(source, [record(0, 'IN_PROGRESS')]).get(ids[0])).toBe(0);
    expect(
      count({ ...source, courses: source.courses.filter(({ id }) => id !== ids[0]) }).get(ids[0]),
    ).toBe(0);
  });
});

describe('eligible cohort private unlock projection', () => {
  it.each([
    [null, 0],
    [70, 1],
    [70.00001, 1],
  ] as const)('keeps unknown and exact GPA paths aligned for score %s', (score, expected) => {
    const source = context([
      course(0),
      { ...course(1, 4, 2), code: 'IT058IU' },
      { ...course(2, 4, 2), code: 'IT168IU' },
    ]);
    source.isGpaPath = true;
    source.prerequisites = [edge(1, 0), edge(2, 0)];
    const student = {
      id: randomUUID(),
      records: [],
      attempts: score === null ? [] : [{ courseId: ids[0], score }],
    };
    const before = JSON.stringify({ source, student });
    const result = projectEligibleCohortDemandWithChoices(
      { curriculumId: source.id, semester: 'FALL', year: 2026 },
      source,
      [student],
      { maxCredits: 18, maxDifficulty: 3.5 },
    );
    expect(result.choices[0].candidates).toEqual([
      { courseId: ids[0], ratingDifficulty: 3, immediateUnlockCount: expected },
    ]);
    expect(result.demand.demandSelectionCount).toBe(1);
    expect(JSON.stringify(result.demand)).not.toContain('immediateUnlockCount');
    expect(JSON.stringify(result.demand)).not.toContain(student.id);
    expect(JSON.stringify({ source, student })).toBe(before);
  });
});
