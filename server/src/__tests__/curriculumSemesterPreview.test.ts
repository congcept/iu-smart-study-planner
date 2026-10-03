import type { CourseStatus } from '@prisma/client';
import type {
  CurriculumCourseDTO,
  CurriculumDetailDTO,
  CurriculumPlacementDTO,
} from '@iu-study-planner/shared';
import { buildCurriculumSemesterPreview } from '../services/curriculumSemesterPreview';
import type { NumericGradeAttempt } from '../services/gradeSummary';

const placement = (academicYear = 1, academicSemester = 1): CurriculumPlacementDTO => ({
  id: `${academicYear}-${academicSemester}`,
  academicYear,
  academicSemester,
  electiveGroup: null,
  electiveSelectCount: null,
  sourceOrder: 0,
  sourceLabel: 'Simulated source',
});
const course = (id: string, changes: Partial<CurriculumCourseDTO> = {}): CurriculumCourseDTO => ({
  id,
  code: id,
  name: id,
  credits: 3,
  difficultyLevel: 2,
  description: null,
  semesterOffered: ['FALL', 'SPRING'],
  avgRating: null,
  ratingCount: 0,
  ratingDifficulty: 2,
  ratingPriorMean: 2,
  ratingPriorSource: 'CURRICULUM_SEED',
  placements: [placement()],
  ...changes,
});
const context = (courses: CurriculumCourseDTO[]): CurriculumDetailDTO => ({
  id: 'context',
  code: 'SIMULATED',
  name: 'Simulated curriculum',
  school: 'CSE',
  degree: 'Bachelor',
  programUrl: 'https://example.test/simulated',
  totalCredits: null,
  isGpaPath: true,
  sourceLabel: 'Simulated source',
  sourceUrl: null,
  usage: 'REFERENCE_ONLY',
  courses,
  prerequisites: [],
  requirements: [],
  ratingPrior: courses.length ? { mean: 2, source: 'CURRICULUM_SEED' } : null,
});
const planned = (courseId: string): { courseId: string; status: CourseStatus } => ({
  courseId,
  status: 'PLANNED',
});
const preview = (
  source: CurriculumDetailDTO,
  records = source.courses.map(({ id }) => planned(id)),
  attempts: NumericGradeAttempt[] = [],
  intensity = 'normal',
) => buildCurriculumSemesterPreview(source, records, attempts, intensity);
const scheduledIds = (result: ReturnType<typeof preview>) =>
  result.slots.flatMap(({ courseIds }) => courseIds);
const edge = (
  courseId: string,
  prerequisiteId: string,
  isStrict = true,
  isCorequisite = false,
) => ({
  id: `${courseId}-${prerequisiteId}`,
  courseId,
  prerequisiteId,
  isStrict,
  isCorequisite,
  mandatory: true as const,
});
const fork = () =>
  context([
    course('grade'),
    course('thesis', { code: 'IT058IU', placements: [placement(4, 2)] }),
    course('alternative', { code: 'IT168IU', placements: [placement(4, 2)] }),
  ]);

describe('selected-course contextual reference semester preview', () => {
  it('previews only member PLANNED records and reports nonmember planned history', () => {
    const source = context([
      course('planned'),
      course('completed'),
      course('progress'),
      course('failed'),
    ]);
    const result = preview(source, [
      planned('planned'),
      { courseId: 'completed', status: 'COMPLETED' },
      { courseId: 'progress', status: 'IN_PROGRESS' },
      { courseId: 'failed', status: 'FAILED' },
      planned('historical'),
    ]);
    expect(scheduledIds(result)).toEqual(['planned']);
    expect(result.courses.map(({ id }) => id)).toEqual(['planned']);
    expect(result.ignoredPlannedIds).toEqual(['historical']);
    expect(result.stats).toMatchObject({
      selectedCourseCount: 1,
      scheduledCourseCount: 1,
      selectedCredits: 3,
      scheduledCredits: 3,
    });
  });

  it('keeps empty selection and empty context empty without inventing degree estimates', () => {
    for (const result of [
      preview(context([course('unused')]), []),
      preview(context([]), [planned('historical')]),
    ]) {
      expect(result.slots).toEqual([]);
      expect(result.courses).toEqual([]);
      expect(result.stats).toMatchObject({
        selectedCourseCount: 0,
        scheduledCourseCount: 0,
        semestersToCompletion: null,
        totalRemainingCredits: null,
        estimatedGraduation: null,
      });
      expect(result.scope).toMatchObject({
        usage: 'REFERENCE_ONLY',
        planningBasis: 'SELECTED_COURSES',
        electiveRequirementsValidated: false,
        offeringValidationAvailable: false,
        calendarDatesAvailable: false,
      });
    }
  });

  it('counts repeated placements and repeated selected records as one global course', () => {
    const repeated = course('repeated', { placements: [placement(), placement(2, 1)] });
    const result = preview(context([repeated]), [planned('repeated'), planned('repeated')]);
    expect(scheduledIds(result)).toEqual(['repeated']);
    expect(result.stats).toMatchObject({
      selectedCourseCount: 1,
      scheduledCourseCount: 1,
      selectedCredits: 3,
      scheduledCredits: 3,
    });
    expect(result.courses[0].placements).toHaveLength(2);
  });

  it('schedules a selected course only in its actual contextual reference slot', () => {
    const result = preview(context([course('late', { placements: [placement(3, 3)] })]));
    expect(result.slots).toMatchObject([
      { academicYear: 3, academicSemester: 3, courseIds: ['late'] },
    ]);
    expect(result.slots).toHaveLength(1);
  });

  it('ignores conflicting global slot and prerequisite fields instead of borrowing legacy metadata', () => {
    const conflicting = {
      ...course('dependent', { placements: [placement(2, 1)] }),
      academicYear: 4,
      academicSemester: 2,
      prerequisites: [{ prerequisiteId: 'global-missing-parent' }],
    };
    const result = preview(context([conflicting]));
    expect(result.slots).toMatchObject([
      { academicYear: 2, academicSemester: 1, courseIds: ['dependent'] },
    ]);
    expect(result.unscheduled).toEqual([]);
  });

  it('unlocks a dependent after its selected parent finishes an earlier reference slot', () => {
    const source = context([
      course('parent'),
      course('dependent', { placements: [placement(1, 2)] }),
    ]);
    source.prerequisites = [edge('dependent', 'parent')];
    const result = preview(source);
    expect(result.slots).toMatchObject([
      { academicYear: 1, academicSemester: 1, courseIds: ['parent'] },
      { academicYear: 1, academicSemester: 2, courseIds: ['dependent'] },
    ]);
    expect(result.unscheduled).toEqual([]);
  });

  it('does not let a selected parent unlock a dependent in the same reference slot', () => {
    const source = context([course('parent'), course('dependent')]);
    source.prerequisites = [edge('dependent', 'parent')];
    const result = preview(source);
    expect(scheduledIds(result)).toEqual(['parent']);
    expect(result.unscheduled).toEqual([expect.objectContaining({ courseId: 'dependent' })]);
    expect(result.stats).toMatchObject({ scheduledCourseCount: 1, unscheduledCourseCount: 1 });
  });

  it('requires a completed member parent and rejects in-progress, missing or outsider substitutes', () => {
    const source = context([course('parent'), course('dependent')]);
    source.prerequisites = [edge('dependent', 'parent')];
    const completed = preview(source, [
      planned('dependent'),
      { courseId: 'parent', status: 'COMPLETED' },
    ]);
    expect(scheduledIds(completed)).toEqual(['dependent']);
    for (const records of [
      [planned('dependent')],
      [planned('dependent'), { courseId: 'parent', status: 'IN_PROGRESS' as const }],
      [planned('dependent'), { courseId: 'outsider', status: 'COMPLETED' as const }],
    ]) {
      expect(scheduledIds(preview(source, records))).toEqual([]);
    }
  });

  it('enforces every context edge regardless of strict or corequisite provenance flags', () => {
    for (const [isStrict, isCorequisite] of [
      [true, false],
      [false, false],
      [true, true],
      [false, true],
    ]) {
      const source = context([course('parent'), course('dependent')]);
      source.prerequisites = [edge('dependent', 'parent', isStrict, isCorequisite)];
      expect(scheduledIds(preview(source, [planned('dependent')]))).toEqual([]);
      expect(
        scheduledIds(
          preview(source, [planned('dependent'), { courseId: 'parent', status: 'COMPLETED' }]),
        ),
      ).toEqual(['dependent']);
    }
  });

  it('reports a prerequisite cycle as unscheduled rather than falsely completing the selection', () => {
    const source = context([course('a'), course('b', { placements: [placement(1, 2)] })]);
    source.prerequisites = [edge('a', 'b'), edge('b', 'a')];
    const result = preview(source);
    expect(scheduledIds(result)).toEqual([]);
    expect(result.unscheduled).toEqual(
      expect.arrayContaining([
        { courseId: 'a', reason: 'PREREQUISITE_CYCLE' },
        { courseId: 'b', reason: 'PREREQUISITE_CYCLE' },
      ]),
    );
    expect(result.stats).toMatchObject({
      scheduledCourseCount: 0,
      unscheduledCourseCount: 2,
      estimatedGraduation: null,
    });
  });

  it('uses highest eligible member retakes and excludes outsider, PT and zero-credit scores', () => {
    const source = fork();
    source.courses.push(course('pt', { code: 'PT001IU' }), course('zero', { credits: 0 }));
    const result = preview(
      source,
      [planned('thesis'), planned('alternative')],
      [
        { courseId: 'grade', score: 30 },
        { courseId: 'grade', score: 90 },
        { courseId: 'grade', score: 40 },
        { courseId: 'outsider', score: 0 },
        { courseId: 'pt', score: 0 },
        { courseId: 'zero', score: 0 },
      ],
    );
    expect(result.gpaPath).toBe('THESIS');
    expect(scheduledIds(result)).toEqual(['thesis']);
    expect(result.unscheduled).toContainEqual({ courseId: 'alternative', reason: 'GPA_EXCLUDED' });
  });

  it('applies the decimal-exact weighted 70 threshold before scheduling the final fork', () => {
    const source = fork();
    source.courses[0].credits = 1;
    source.courses.push(course('second'));
    const result = preview(
      source,
      [planned('thesis'), planned('alternative')],
      [
        { courseId: 'grade', score: 0.16 },
        { courseId: 'second', score: 93.28 },
      ],
    );
    expect(result.gpaPath).toBe('ALTERNATIVE');
    expect(scheduledIds(result)).toEqual(['alternative']);
    expect(result.unscheduled).toContainEqual({ courseId: 'thesis', reason: 'GPA_EXCLUDED' });
  });

  it('retains both options for null numeric GPA and for a nonfork context', () => {
    const source = fork();
    expect(
      new Set(scheduledIds(preview(source, [planned('thesis'), planned('alternative')]))),
    ).toEqual(new Set(['thesis', 'alternative']));
    source.isGpaPath = false;
    const result = preview(
      source,
      [planned('thesis'), planned('alternative')],
      [{ courseId: 'grade', score: 99 }],
    );
    expect(result.gpaPath).toBeNull();
    expect(new Set(scheduledIds(result))).toEqual(new Set(['thesis', 'alternative']));
  });

  it('preserves an earlier repeated appearance when its final-semester GPA placement is excluded', () => {
    const source = fork();
    source.courses[2].placements.unshift(placement(3, 2));
    const result = preview(source, [planned('alternative')], [{ courseId: 'grade', score: 90 }]);
    expect(result.gpaPath).toBe('THESIS');
    expect(result.slots).toMatchObject([
      { academicYear: 3, academicSemester: 2, courseIds: ['alternative'] },
    ]);
    expect(result.unscheduled).toEqual([]);
  });

  it('includes physical training in the credit budget and reports courses over the cap', () => {
    const source = context([
      course('pt', { code: 'PT001IU', credits: 3 }),
      course('regular', { credits: 12 }),
      course('oversize', { credits: 16 }),
    ]);
    const result = preview(source);
    expect(new Set(scheduledIds(result))).toEqual(new Set(['pt', 'regular']));
    expect(result.stats).toMatchObject({
      selectedCredits: 31,
      scheduledCredits: 15,
      scheduledCourseCount: 2,
    });
    expect(result.slots[0].totalCredits).toBe(15);
    expect(result.unscheduled).toContainEqual({
      courseId: 'oversize',
      reason: 'COURSE_EXCEEDS_CREDIT_CAP',
    });
  });

  it('uses rating difficulty rather than the seed and deterministically ranks competing courses', () => {
    const harder = course('A-hard', { credits: 9, difficultyLevel: 1, ratingDifficulty: 5 });
    const easier = course('Z-easy', { credits: 9, difficultyLevel: 5, ratingDifficulty: 1 });
    const source = context([harder, easier]);
    const forward = preview(source, undefined, [], 'low');
    const reversed = preview(context([easier, harder]), undefined, [], 'low');
    expect(scheduledIds(forward)).toEqual(['Z-easy']);
    expect(scheduledIds(reversed)).toEqual(['Z-easy']);
    expect(forward.slots[0]).toMatchObject({ totalCredits: 9, averageDifficulty: 1 });
  });

  it('preserves unresolved free-elective metadata and leaves degree feasibility unclaimed', () => {
    const source = context([course('a')]);
    source.requirements = [
      {
        id: 'free',
        kind: 'FREE_ELECTIVE',
        name: 'Free elective',
        credits: 3,
        academicYear: 3,
        academicSemester: 2,
        sourceOrder: 10,
        sourceLabel: 'Simulated source',
      },
    ];
    const before = JSON.stringify(source);
    Object.freeze(source.requirements[0]);
    Object.freeze(source.requirements);
    const result = preview(source);
    expect(result.requirements).toEqual(source.requirements);
    expect(result.scope.electiveRequirementsValidated).toBe(false);
    expect(result.stats).toMatchObject({
      semestersToCompletion: null,
      totalRemainingCredits: null,
      estimatedGraduation: null,
    });
    expect(JSON.stringify(source)).toBe(before);
  });

  it('reports unplaced selections without borrowing an unrelated global slot', () => {
    const result = preview(context([course('unplaced', { placements: [] })]));
    expect(result.slots).toEqual([]);
    expect(result.unscheduled).toEqual([{ courseId: 'unplaced', reason: 'UNPLACED' }]);
    expect(result.stats).toMatchObject({
      selectedCourseCount: 1,
      unscheduledCourseCount: 1,
      scheduledCredits: 0,
    });
  });

  it('does not reward a parent for targets that cannot be unlocked in a later usable slot', () => {
    const parent = course('parent', { code: 'A-parent', credits: 9, ratingDifficulty: 2 });
    const competitor = course('competitor', { code: 'Z-easier', credits: 9, ratingDifficulty: 1 });
    const variants: {
      child: CurriculumCourseDTO;
      selected: boolean;
      additionalParent?: CurriculumCourseDTO;
      additionalParentSelected?: boolean;
    }[] = [
      { child: course('child'), selected: true },
      {
        child: course('child', { code: 'IT168IU', placements: [placement(4, 2)] }),
        selected: true,
      },
      { child: course('child', { placements: [] }), selected: true },
      { child: course('child', { credits: 10, placements: [placement(1, 2)] }), selected: true },
      { child: course('child', { placements: [placement(1, 2)] }), selected: false },
      {
        child: course('child', { placements: [placement(1, 2)] }),
        selected: true,
        additionalParent: course('other-parent'),
        additionalParentSelected: false,
      },
      {
        child: course('child', { placements: [placement(1, 2)] }),
        selected: true,
        additionalParent: course('other-parent', { placements: [placement(1, 3)] }),
        additionalParentSelected: true,
      },
    ];
    for (const { child, selected, additionalParent, additionalParentSelected } of variants) {
      const source = context([
        parent,
        competitor,
        course('grade'),
        child,
        ...(additionalParent ? [additionalParent] : []),
      ]);
      source.prerequisites = [
        edge('child', 'parent'),
        ...(additionalParent ? [edge('child', additionalParent.id)] : []),
      ];
      const result = preview(
        source,
        [
          planned('parent'),
          planned('competitor'),
          ...(selected ? [planned('child')] : []),
          ...(additionalParent && additionalParentSelected ? [planned(additionalParent.id)] : []),
        ],
        [{ courseId: 'grade', score: 90 }],
        'low',
      );
      expect(result.slots[0].courseIds).toEqual(['competitor']);
    }
    const usable = context([
      parent,
      competitor,
      course('child', { placements: [placement(1, 2)] }),
    ]);
    usable.prerequisites = [edge('child', 'parent')];
    expect(scheduledIds(preview(usable, undefined, [], 'low'))).toEqual(['parent', 'child']);
  });

  it('reports downstream cycle blockers across shared dependency paths without mislabeling acyclic blockers', () => {
    const source = context([
      course('cycleA'),
      course('cycleB'),
      course('downstream1'),
      course('downstream2'),
      course('missing'),
      course('blocked'),
      course('good'),
    ]);
    source.prerequisites = [
      edge('cycleA', 'cycleB'),
      edge('cycleB', 'cycleA'),
      edge('downstream1', 'cycleA'),
      edge('downstream1', 'cycleB'),
      edge('downstream2', 'downstream1'),
      edge('downstream2', 'cycleA'),
      edge('blocked', 'missing'),
    ];
    const result = preview(
      source,
      source.courses.filter(({ id }) => id !== 'missing').map(({ id }) => planned(id)),
    );
    expect(scheduledIds(result)).toEqual(['good']);
    for (const courseId of ['cycleA', 'cycleB', 'downstream1', 'downstream2']) {
      expect(result.unscheduled).toContainEqual({ courseId, reason: 'PREREQUISITE_CYCLE' });
    }
    expect(result.unscheduled).toContainEqual({
      courseId: 'blocked',
      reason: 'UNMET_PREREQUISITE',
    });
    expect(result.unscheduled).toHaveLength(5);
  });
});
