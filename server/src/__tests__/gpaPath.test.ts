import type { GpaPath } from '@iu-study-planner/shared';
import { isCourseInGpaPath } from '../services/gpaPath';

const finalSemester = { academicYear: 4, academicSemester: 2 };
describe('current CS recommendation GPA placement', () => {
  it.each([
    ['THESIS', 'IT058IU', true],
    ['THESIS', 'IT168IU', false],
    ['THESIS', 'IT096IU', false],
    ['ALTERNATIVE', 'IT058IU', false],
    ['ALTERNATIVE', 'IT168IU', true],
    ['ALTERNATIVE', 'IT096IU', true],
    [null, 'IT058IU', true],
    [null, 'IT168IU', true],
    [null, 'IT096IU', true],
  ] as [GpaPath | null, string, boolean][])(
    '%s path course %s is eligible: %s',
    (path, code, expected) => {
      expect(isCourseInGpaPath({ code, ...finalSemester }, path)).toBe(expected);
    },
  );
  it.each(['THESIS', 'ALTERNATIVE'] as const)(
    'retains earlier duplicate elective placements for %s',
    (path) => {
      expect(
        isCourseInGpaPath({ code: 'IT160IU', academicYear: 2, academicSemester: 2 }, path),
      ).toBe(true);
      expect(
        isCourseInGpaPath({ code: 'IT160IU', academicYear: 3, academicSemester: 1 }, path),
      ).toBe(true);
    },
  );
  it('does not infer a final-semester placement when metadata is absent', () => {
    expect(
      isCourseInGpaPath(
        { code: 'IT058IU', academicYear: null, academicSemester: null },
        'ALTERNATIVE',
      ),
    ).toBe(true);
  });
});
