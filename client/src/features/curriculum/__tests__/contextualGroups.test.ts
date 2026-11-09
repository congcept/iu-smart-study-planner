import type { CurriculumDetailDTO } from '@iu-study-planner/shared';
import { contextualGroups } from '../contextualGroups';

const course = (
  id: string,
  code: string,
  credits: number,
  placements: { year: number | null; semester: number | null; group?: string | null }[],
) => ({
  id,
  code,
  name: `Course ${code}`,
  credits,
  difficultyLevel: 2.5,
  description: null,
  semesterOffered: [] as CurriculumDetailDTO['courses'][number]['semesterOffered'],
  ratingPriorSource: 'CURRICULUM_SEED' as const,
  avgRating: null,
  ratingCount: 0,
  ratingDifficulty: 0,
  ratingPriorMean: 0,
  placements: placements.map((placement, index) => ({
    id: `${id}-${index}`,
    academicYear: placement.year,
    academicSemester: placement.semester,
    electiveGroup: placement.group ?? null,
    electiveSelectCount: placement.group ? 1 : null,
    electiveSelectCredits: null,
    sourceOrder: index,
    sourceLabel: null,
  })),
});

const detail: CurriculumDetailDTO = {
  id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  code: 'IT-CE',
  name: 'Computer Engineering',
  school: 'CSE',
  degree: 'Engineer',
  programUrl: 'https://example.test',
  totalCredits: 150,
  isGpaPath: false,
  sourceLabel: null,
  sourceUrl: null,
  usage: 'REFERENCE_ONLY',
  ratingPrior: { mean: 2.6, source: 'CURRICULUM_SEED' },
  courses: [
    course('a1', 'IT116IU', 4, [{ year: 1, semester: 1 }]),
    course('a2', 'IT069IU', 4, [{ year: 1, semester: 2 }]),
    course('a3', 'IT091IU', 4, [{ year: 2, semester: 2 }]),
    // Placed twice: the same course in two elective groups.
    course('a4', 'IT401IU', 3, [
      { year: 3, semester: 1, group: 'Group A' },
      { year: 4, semester: 1, group: 'Group B' },
    ]),
    course('a5', 'IT083IU', 3, [{ year: 4, semester: 1 }]),
    course('a6', 'IT058IU', 10, [{ year: 4, semester: 2 }]),
    // A member with no placement: it is in the program but the document gives it no slot.
    course('a7', 'IT999IU', 2, [{ year: null, semester: null }]),
  ],
  prerequisites: [
    {
      id: 'p1',
      courseId: 'a2',
      prerequisiteId: 'a1',
      isStrict: true,
      isCorequisite: false,
      mandatory: true,
    },
    {
      id: 'p2',
      courseId: 'a6',
      prerequisiteId: 'a5',
      isStrict: true,
      isCorequisite: false,
      mandatory: true,
    },
  ],
  externalPrerequisites: [
    {
      id: 'e1',
      courseId: 'a3',
      prerequisiteCode: 'IT149IU',
      kind: 'HT',
      alternativeGroup: 'programming',
    },
  ],
  requirements: [
    {
      id: 'r1',
      kind: 'UNNAMED_ELECTIVE',
      name: 'Elective 1',
      credits: 4,
      academicYear: 3,
      academicSemester: 1,
      sourceOrder: 0,
      sourceLabel: null,
    },
    {
      id: 'r2',
      kind: 'UNNAMED_ELECTIVE',
      name: 'Elective 2',
      credits: 4,
      academicYear: null,
      academicSemester: null,
      sourceOrder: 1,
      sourceLabel: null,
    },
  ],
};

describe('contextual curriculum adapter', () => {
  it('groups by the program’s own placements, ascending', () => {
    const { groups } = contextualGroups(detail);
    expect(groups.map(({ year, semester }) => [year, semester])).toEqual([
      [1, 1],
      [1, 2],
      [2, 2],
      [3, 1],
      [4, 1],
      [4, 2],
    ]);
  });

  it('keeps a course placed twice in both slots with its own elective group', () => {
    const { groups } = contextualGroups(detail);
    const placements = groups.flatMap(({ courses }) =>
      courses.filter(({ code }) => code === 'IT401IU'),
    );
    expect(placements.map(({ electiveGroup }) => electiveGroup)).toEqual(['Group A', 'Group B']);
    expect(placements.map(({ category }) => category)).toEqual(['ELECTIVE', 'ELECTIVE']);
  });

  it('gives an unnamed elective slot a card instead of inventing candidates', () => {
    const { groups, unresolved } = contextualGroups(detail);
    const slot = groups
      .find(({ year, semester }) => year === 3 && semester === 1)!
      .courses.find(({ id }) => id === 'r1')!;
    expect(slot.name).toContain('candidates not listed');
    expect(slot.credits).toBe(4);
    expect(slot.category).toBe('ELECTIVE');
    // A requirement with no slot stays unresolved and is not placed anywhere.
    expect(unresolved.map(({ id }) => id)).toEqual(['r1', 'r2']);
    expect(groups.flatMap(({ courses }) => courses).filter(({ id }) => id === 'r2')).toHaveLength(
      0,
    );
  });

  it('links prerequisites in both directions for dependent highlighting', () => {
    const { byId } = contextualGroups(detail);
    expect(byId.get('a2')!.prerequisites.map(({ prerequisiteId }) => prerequisiteId)).toEqual([
      'a1',
    ]);
    expect(byId.get('a1')!.isPrerequisiteFor.map(({ prerequisiteId }) => prerequisiteId)).toEqual([
      'a2',
    ]);
  });

  it('keeps the thesis in the final slot behind its own prerequisite', () => {
    const { groups, byId } = contextualGroups(detail);
    const thesis = groups
      .find(({ year, semester }) => year === 4 && semester === 2)!
      .courses.find(({ code }) => code === 'IT058IU')!;
    expect(thesis.prerequisites.map(({ prerequisiteId }) => prerequisiteId)).toEqual(['a5']);
    expect(byId.get('a5')!.academicYear).toBe(4);
    expect(byId.get('a5')!.academicSemester).toBe(1);
  });

  it('does not place a member the document gives no slot', () => {
    const { groups, courses } = contextualGroups(detail);
    expect(groups.flatMap(({ courses: placed }) => placed).map(({ code }) => code)).not.toContain(
      'IT999IU',
    );
    // It is still the program's course, so it can be named; it simply has no column.
    expect(courses.map(({ code }) => code)).toContain('IT999IU');
  });

  it('carries external requirements without inventing a member for them', () => {
    const { byId } = contextualGroups(detail);
    // The external edge names a course this program does not offer, so nothing is attached to the
    // member it constrains; it stays visible through the reference read instead.
    expect(byId.get('a3')!.prerequisites).toEqual([]);
    expect(detail.externalPrerequisites).toHaveLength(1);
  });
});
