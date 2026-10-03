import { describe, expect, it } from 'vitest';
import type { Course, YearSemesterGroup } from '@/types';
import { recommendCurriculumCourses } from '../recommendations';

function course(id: string, score?: number, credits = 3): Course {
  return {
    id,
    code: id,
    name: id,
    credits,
    ratingDifficulty: score,
    ratingCount: score === undefined ? undefined : 0,
    difficultyLevel: score === 1 ? 5 : 1,
    category: 'CORE',
    semesterOffered: ['FALL'],
    prerequisites: [],
    isPrerequisiteFor: [],
    createdAt: '',
    updatedAt: '',
  };
}
const group = (courses: Course[], year = 1, semester = 1): YearSemesterGroup => ({
  courses,
  year,
  semester,
});
const suggest = (
  groups: YearSemesterGroup[],
  cap = 3,
  completed = new Set<string>(),
  thesis = true,
) => recommendCurriculumCourses(groups, completed, cap, thesis);

describe('curriculum recommendations', () => {
  it('chooses the lower Bayesian estimate despite inverted individual seeds and code order', () => {
    expect(suggest([group([course('A', 4), course('Z', 1)])])).toEqual(['Z']);
  });
  it('keeps earlier curriculum semesters ahead of easier future courses', () => {
    expect(suggest([group([course('A', 1)], 1, 2), group([course('Z', 5)])])).toEqual(['Z']);
  });
  it('uses code order for equal estimates, regardless of input order', () => {
    expect(suggest([group([course('Z', 3.25), course('A', 3.25)])])).toEqual(['A']);
  });
  it('treats zero-vote shared estimates as usable instead of falling back to seeds', () => {
    expect(suggest([group([course('A', 4.5), course('Z', 3)])])).toEqual(['Z']);
  });
  it('keeps unknown legacy estimates after available estimates without fabricating a seed score', () => {
    expect(suggest([group([course('A'), course('Z', 5)])])).toEqual(['Z']);
  });
  it('retains deterministic code order when every estimate is unknown', () => {
    expect(suggest([group([course('Z'), course('A')])])).toEqual(['A']);
  });
  it.each([NaN, Infinity, 0, 6])('treats invalid estimate %s as unknown', (score) => {
    expect(suggest([group([course('A', score), course('Z', 4)])])).toEqual(['Z']);
  });
  it('never recommends a blocked dependent in the same batch as its parent', () => {
    const parent = course('A', 4);
    const child = {
      ...course('B', 1),
      prerequisites: [
        {
          id: 'edge',
          courseId: 'B',
          prerequisiteId: 'A',
          isStrict: false,
          isCorequisite: true,
        },
      ],
    };
    expect(suggest([group([child, parent])], 6)).toEqual(['A']);
    expect(suggest([group([child, parent])], 6, new Set(['A']))).toEqual(['B']);
  });
  it('requires every prerequisite and excludes completed courses', () => {
    const child = {
      ...course('C', 1),
      prerequisites: ['A', 'B'].map((id) => ({
        id,
        courseId: 'C',
        prerequisiteId: id,
        isStrict: true,
        isCorequisite: false,
      })),
    };
    expect(suggest([group([course('A', 3), child])], 6, new Set(['A']))).toEqual([]);
  });
  it('does not spend credits twice on duplicate elective placements', () => {
    const duplicate = course('A', 2, 2);
    expect(suggest([group([duplicate, course('B', 4, 2)]), group([duplicate], 2)], 4)).toEqual([
      'A',
      'B',
    ]);
  });
  it('skips oversized courses and keeps filling the credit budget', () => {
    expect(suggest([group([course('A', 1, 4), course('B', 3, 2), course('C', 4, 1)])])).toEqual([
      'B',
      'C',
    ]);
  });
  it.each([true, false])('filters the GPA path before spending credits (thesis=%s)', (thesis) => {
    const groups = [
      group([course('IT058IU', 1, 6), course('IT099IU', 2, 3)], 4, 2),
      group([course('Z', 4)], 4, 3),
    ];
    expect(suggest(groups, 6, new Set(), thesis)).toEqual(thesis ? ['IT058IU'] : ['IT099IU', 'Z']);
  });
  it('does not mutate curriculum ordering', () => {
    const groups = [group([course('Z', 4), course('A', 1)])];
    suggest(groups);
    expect(groups[0].courses.map(({ id }) => id)).toEqual(['Z', 'A']);
  });
});
