import {
  calculateGradeSummary,
  calculateSemesterGrades,
  type DatedNumericGradeAttempt,
  type GradeCourse,
} from '../services/gradeSummary';

const courses: GradeCourse[] = [
  { id: 'a', code: 'IT001IU', credits: 3 },
  { id: 'b', code: 'IT002IU', credits: 4 },
  { id: 'pt1', code: 'PT001IU', credits: 2 },
  { id: 'pt2', code: 'PT002IU', credits: 2 },
  { id: 'zero', code: 'ZERO', credits: 0 },
];

const attempt = (
  courseId: string,
  score: number | null,
  semester: DatedNumericGradeAttempt['semester'],
  year: number | null,
): DatedNumericGradeAttempt => ({ courseId, score, semester, year });

describe('recorded semester GPA', () => {
  it('uses each term highest score while the same course counts once in every term', () => {
    const semesterGrades = calculateSemesterGrades(courses, [
      attempt('a', 50, 'FALL', 2025),
      attempt('a', 90, 'FALL', 2025),
      attempt('a', 70, 'SPRING', 2025),
      attempt('b', 60, 'SPRING', 2024),
      attempt('b', 80, 'FALL', 2024),
    ]);

    expect(semesterGrades).toEqual({
      terms: [
        { year: 2024, semester: 'FALL', gpa100: 80, gradedCredits: 4, gradedCourseCount: 1 },
        { year: 2024, semester: 'SPRING', gpa100: 60, gradedCredits: 4, gradedCourseCount: 1 },
        { year: 2025, semester: 'FALL', gpa100: 90, gradedCredits: 3, gradedCourseCount: 1 },
        { year: 2025, semester: 'SPRING', gpa100: 70, gradedCredits: 3, gradedCourseCount: 1 },
      ],
      undatedAttemptCount: 0,
    });
    const summary = calculateGradeSummary(courses, [
      attempt('a', 50, 'FALL', 2025),
      attempt('a', 90, 'FALL', 2025),
      attempt('a', 70, 'SPRING', 2025),
      attempt('b', 60, 'SPRING', 2024),
      attempt('b', 80, 'FALL', 2024),
    ]);
    expect(summary.gpa100).toBeCloseTo((90 * 3 + 80 * 4) / 7, 10);
    expect(summary.gradedCourseCount).toBe(2);
  });

  it('weights each term by included course credits', () => {
    const [fall] = calculateSemesterGrades(courses, [
      attempt('a', 84.125, 'FALL', 2026),
      attempt('b', 60, 'FALL', 2026),
    ]).terms;
    expect(fall).toEqual({
      year: 2026,
      semester: 'FALL',
      gpa100: expect.closeTo((84.125 * 3 + 60 * 4) / 7, 10),
      gradedCredits: 7,
      gradedCourseCount: 2,
    });
  });

  it('orders terms by ascending year then enum semester order, not input order', () => {
    const attempts = [
      attempt('a', 80, 'SPRING', 2025),
      attempt('a', 81, 'FALL', 2026),
      attempt('a', 82, 'FALL', 2024),
      attempt('a', 83, 'SUMMER', 2025),
      attempt('a', 84, 'SPRING', 2024),
    ];
    const labels = (input: DatedNumericGradeAttempt[]) =>
      calculateSemesterGrades(courses, input).terms.map(
        ({ year, semester }) => `${year}-${semester}`,
      );
    const expected = ['2024-FALL', '2024-SPRING', '2025-SPRING', '2025-SUMMER', '2026-FALL'];
    expect(labels(attempts)).toEqual(expected);
    expect(labels([...attempts].reverse())).toEqual(expected);
  });

  it('excludes physical training and zero-credit courses without creating empty terms', () => {
    const semesterGrades = calculateSemesterGrades(courses, [
      attempt('pt1', 100, 'FALL', 2024),
      attempt('pt2', 90, 'SPRING', 2024),
      attempt('zero', 95, 'SUMMER', 2025),
    ]);
    expect(semesterGrades).toEqual({ terms: [], undatedAttemptCount: 0 });
  });

  it('counts every eligible attempt missing a term or year instead of guessing a term', () => {
    const semesterGrades = calculateSemesterGrades(courses, [
      attempt('a', 100, null, null),
      attempt('a', 90, 'FALL', null),
      attempt('b', 80, null, 2026),
      attempt('a', 70, null, null),
      attempt('a', null, null, null),
      attempt('pt1', 100, null, null),
      attempt('zero', 100, 'FALL', null),
    ]);
    expect(semesterGrades).toEqual({ terms: [], undatedAttemptCount: 4 });
  });

  it('keeps a recorded zero score as a real term GPA of zero', () => {
    expect(calculateSemesterGrades(courses, [attempt('a', 0, 'FALL', 2026)]).terms).toEqual([
      { year: 2026, semester: 'FALL', gpa100: 0, gradedCredits: 3, gradedCourseCount: 1 },
    ]);
  });

  it('returns an explicit empty result without attempts', () => {
    expect(calculateSemesterGrades(courses, [])).toEqual({
      terms: [],
      undatedAttemptCount: 0,
    });
  });

  it('does not mutate the supplied attempts', () => {
    const attempts = [attempt('a', 40, 'FALL', 2026), attempt('a', 90, null, null)];
    const before = JSON.parse(JSON.stringify(attempts));
    calculateSemesterGrades(courses, attempts);
    expect(attempts).toEqual(before);
  });

  it.each([
    ['an unknown course', [attempt('unknown', 80, 'FALL', 2026)]],
    ['a score above 100', [attempt('a', 101, 'FALL', 2026)]],
    ['a negative score', [attempt('a', -1, null, null)]],
    ['a non-finite score', [attempt('a', Number.POSITIVE_INFINITY, 'FALL', 2026)]],
  ])('rejects %s instead of publishing a partial term list', (_label, attempts) => {
    expect(() => calculateSemesterGrades(courses, attempts)).toThrow();
  });
});
