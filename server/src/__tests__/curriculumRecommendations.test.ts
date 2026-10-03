import type {
  CurriculumCourseDTO,
  CurriculumDetailDTO,
  CurriculumPlacementDTO,
} from '@iu-study-planner/shared';
import { recommendCurriculumCourses } from '../services/curriculumRecommendations';

const placement = (academicYear = 1, academicSemester = 1): CurriculumPlacementDTO => ({
  id: `${academicYear}-${academicSemester}`,
  academicYear,
  academicSemester,
  electiveGroup: null,
  electiveSelectCount: null,
  sourceOrder: 0,
  sourceLabel: 'Simulated reference',
});
const course = (id: string, code = id, year = 1, semester = 1): CurriculumCourseDTO => ({
  id,
  code,
  name: id,
  credits: 3,
  difficultyLevel: 1,
  description: null,
  semesterOffered: ['FALL'],
  avgRating: null,
  ratingCount: 0,
  ratingDifficulty: 2,
  ratingPriorMean: 2,
  ratingPriorSource: 'CURRICULUM_SEED',
  placements: [placement(year, semester)],
});
const context = (courses: CurriculumCourseDTO[]): CurriculumDetailDTO => ({
  id: 'context',
  code: 'SIMULATED',
  name: 'Simulated curriculum',
  school: 'CSE',
  degree: 'Bachelor',
  programUrl: 'https://example.test/reference',
  totalCredits: null,
  isGpaPath: true,
  sourceLabel: 'Simulated reference',
  sourceUrl: null,
  usage: 'REFERENCE_ONLY',
  courses,
  requirements: [],
  prerequisites: [],
  ratingPrior: { mean: 2, source: 'CURRICULUM_SEED' },
});
const options = { maxCredits: 30, maxDifficulty: 5 };
const fork = () =>
  context([
    course('grade'),
    course('thesis', 'IT058IU', 4, 2),
    course('alternative', 'IT168IU', 4, 2),
  ]);

describe('contextual recommendation placement and GPA policy', () => {
  it.each([
    [71, 'THESIS', 'thesis'],
    [70, 'ALTERNATIVE', 'alternative'],
    [69, 'ALTERNATIVE', 'alternative'],
    [70.00001, 'THESIS', 'thesis'],
  ] as const)('filters the fork before counts and budgeting for score %s', (score, path, id) => {
    const result = recommendCurriculumCourses(
      fork(),
      [{ courseId: 'grade', status: 'COMPLETED' }],
      [{ courseId: 'grade', score }],
      { ...options, maxCredits: 3 },
    );
    expect(result.courses.map((row) => row.id)).toEqual([id]);
    expect(result.stats).toMatchObject({
      gpaPath: path,
      totalAvailable: 1,
      filteredCount: 1,
      totalRecommendedCredits: 3,
    });
  });

  it('uses highest retakes without needing a current completion flag', () => {
    const result = recommendCurriculumCourses(
      fork(),
      [],
      [
        { courseId: 'grade', score: 30 },
        { courseId: 'grade', score: 90 },
        { courseId: 'grade', score: 40 },
      ],
      options,
    );
    expect(result.stats.gpaPath).toBe('THESIS');
    expect(result.courses.map((row) => row.id)).toEqual(['grade', 'thesis']);
  });

  it('uses decimal-exact credit-weighted scores at the 70 boundary', () => {
    const source = fork();
    source.courses[0].credits = 1;
    source.courses.push(course('second'));
    const result = recommendCurriculumCourses(
      source,
      [],
      [
        { courseId: 'grade', score: 0.16 },
        { courseId: 'second', score: 93.28 },
      ],
      options,
    );
    expect(result.stats.gpaPath).toBe('ALTERNATIVE');
  });

  it('excludes PT, zero-credit and nonmember scores from GPA but includes planned PT credits', () => {
    const source = fork();
    source.courses.push(course('pt', 'PT001IU'), { ...course('zero'), credits: 0 });
    const result = recommendCurriculumCourses(
      source,
      [],
      [
        { courseId: 'grade', score: 70 },
        { courseId: 'pt', score: 100 },
        { courseId: 'zero', score: 100 },
        { courseId: 'outsider', score: 100 },
      ],
      options,
    );
    expect(result.stats.gpaPath).toBe('ALTERNATIVE');
    expect(result.stats.totalRecommendedCredits).toBe(9);
  });

  it('retains both fork options with no eligible numeric scores', () => {
    const result = recommendCurriculumCourses(fork(), [], [], options);
    expect(result.stats.gpaPath).toBeNull();
    expect(result.courses.map((row) => row.id)).toEqual(['grade', 'thesis', 'alternative']);
    expect(result.stats.totalAvailable).toBe(3);
  });

  it('does not invent a fork for a nonfork curriculum with high numeric grades', () => {
    const source = fork();
    source.isGpaPath = false;
    const result = recommendCurriculumCourses(
      source,
      [],
      [{ courseId: 'grade', score: 99 }],
      options,
    );
    expect(result.stats.gpaPath).toBeNull();
    expect(result.stats.totalAvailable).toBe(3);
  });

  it('preserves an earlier elective appearance while filtering its opposite final-semester placement', () => {
    const source = fork();
    source.courses[2].placements.push(placement(3, 2));
    const result = recommendCurriculumCourses(
      source,
      [],
      [{ courseId: 'grade', score: 90 }],
      options,
    );
    expect(result.courses.find(({ id }) => id === 'alternative')?.placements).toEqual([
      placement(3, 2),
    ]);
    expect(result.stats).toMatchObject({ totalAvailable: 3, totalRecommendedCredits: 9 });
  });

  it.each([
    [true, false],
    [false, false],
    [true, true],
    [false, true],
  ])('enforces context edges for strict=%s/corequisite=%s', (isStrict, isCorequisite) => {
    const source = context([course('parent'), course('dependent')]);
    source.prerequisites.push({
      id: 'edge',
      courseId: 'dependent',
      prerequisiteId: 'parent',
      isStrict,
      isCorequisite,
      mandatory: true,
    });
    const blocked = recommendCurriculumCourses(source, [], [], options);
    const allowed = recommendCurriculumCourses(
      source,
      [{ courseId: 'parent', status: 'COMPLETED' }],
      [],
      options,
    );
    expect(blocked.courses.map((row) => row.id)).toEqual(['parent']);
    expect(allowed.courses.map((row) => row.id)).toEqual(['dependent']);
  });

  it.each(['COMPLETED', 'IN_PROGRESS'] as const)('excludes %s courses', (status) => {
    expect(
      recommendCurriculumCourses(
        context([course('a'), course('b')]),
        [{ courseId: 'a', status }],
        [],
        options,
      ).courses.map((row) => row.id),
    ).toEqual(['b']);
  });

  it('keeps planned courses available and counts repeated placements once', () => {
    const repeated = course('a');
    repeated.placements.push(placement(2, 1));
    const result = recommendCurriculumCourses(
      context([repeated]),
      [{ courseId: 'a', status: 'PLANNED' }],
      [],
      options,
    );
    expect(result.courses).toHaveLength(1);
    expect(result.stats.totalRecommendedCredits).toBe(3);
    expect(result.courses[0].placements).toHaveLength(2);
  });

  it('applies offering filters after prerequisite availability', () => {
    const source = context([course('fall'), { ...course('spring'), semesterOffered: ['SPRING'] }]);
    const result = recommendCurriculumCourses(source, [], [], { ...options, semester: 'SPRING' });
    expect(result.stats).toMatchObject({ totalAvailable: 2, filteredCount: 1 });
    expect(result.courses).toEqual([source.courses[1]]);
  });

  it('returns no legacy fallback for empty or unplaced contexts', () => {
    const empty = recommendCurriculumCourses(context([]), [], [], options);
    const unplaced = { ...course('unplaced'), placements: [] };
    expect(empty.courses).toEqual([]);
    expect(empty.stats.averageDifficulty).toBe(0);
    expect(empty.scope).toMatchObject({
      usage: 'REFERENCE_ONLY',
      categoryPersonalizationAvailable: false,
    });
    expect(
      recommendCurriculumCourses(context([unplaced]), [], [], options).stats.totalAvailable,
    ).toBe(0);
  });

  it('does not count unlock edges to an excluded GPA option in ranking', () => {
    const source = fork();
    source.courses.unshift(course('other'));
    source.prerequisites.push({
      id: 'edge',
      courseId: 'alternative',
      prerequisiteId: 'grade',
      isStrict: true,
      isCorequisite: false,
      mandatory: true,
    });
    const result = recommendCurriculumCourses(source, [], [{ courseId: 'grade', score: 90 }], {
      ...options,
      maxCredits: 3,
    });
    expect(result.courses.map(({ id }) => id)).toEqual(['other']);
    expect(result.courses[0]).not.toHaveProperty('category');
    expect(result.courses[0]).not.toHaveProperty('isPrerequisiteFor');
  });
});
