import { calculateGradeSummary } from '../services/gradeSummary';

const courses = [
  { id: 'a', code: 'IT001IU', credits: 3 },
  { id: 'b', code: 'IT002IU', credits: 4 },
  { id: 'pt1', code: 'PT001IU', credits: 2 },
  { id: 'pt2', code: 'PT002IU', credits: 2 },
  { id: 'zero', code: 'ZERO', credits: 0 },
];

describe('numeric grade summary', () => {
  it('weights course scores by credits rather than averaging courses equally', () => {
    const summary = calculateGradeSummary(courses, [
      { courseId: 'a', score: 90 },
      { courseId: 'b', score: 60 },
    ]);
    expect(summary.gpa100).toBeCloseTo(510 / 7);
    expect(summary.gradedCredits).toBe(7);
    expect(summary.gradedCourseCount).toBe(2);
  });

  it('counts the highest retake score once, independently of input order', () => {
    const attempts = [
      { courseId: 'b', score: 75 },
      { courseId: 'a', score: 20 },
      { courseId: 'a', score: 90 },
      { courseId: 'a', score: 45 },
      { courseId: 'a', score: 90 },
    ];
    const summary = calculateGradeSummary(courses, attempts);
    expect(summary).toEqual({
      gpa100: 570 / 7,
      gradedCredits: 7,
      gradedCourseCount: 2,
      courseScores: [
        { courseId: 'a', score: 90, credits: 3 },
        { courseId: 'b', score: 75, credits: 4 },
      ],
    });
    expect(calculateGradeSummary(courses, [...attempts].reverse())).toEqual(summary);
  });

  it('includes a zero score in numerator and denominator', () => {
    const summary = calculateGradeSummary(courses, [
      { courseId: 'a', score: 0 },
      { courseId: 'b', score: 70 },
    ]);
    expect(summary.gpa100).toBe(40);
    expect(summary.gradedCredits).toBe(7);
    expect(summary.gradedCourseCount).toBe(2);
  });

  it('ignores ungraded attempts without interpreting them as zero', () => {
    const summary = calculateGradeSummary(courses, [
      { courseId: 'a', score: null },
      { courseId: 'a', score: 80 },
      { courseId: 'b', score: null },
    ]);
    expect(summary.gpa100).toBe(80);
    expect(summary.gradedCredits).toBe(3);
  });

  it('excludes both physical training courses and zero-credit courses', () => {
    const summary = calculateGradeSummary(courses, [
      { courseId: 'a', score: 60 },
      { courseId: 'pt1', score: 100 },
      { courseId: 'pt2', score: 0 },
      { courseId: 'zero', score: 100 },
    ]);
    expect(summary.courseScores).toEqual([{ courseId: 'a', score: 60, credits: 3 }]);
    expect(summary.gpa100).toBe(60);
  });

  it.each([
    { attempts: [] },
    { attempts: [{ courseId: 'a', score: null }] },
    { attempts: [{ courseId: 'pt1', score: 90 }] },
    { attempts: [{ courseId: 'zero', score: 90 }] },
  ])('reports no GPA when there are no graded eligible credits %#', ({ attempts }) => {
    expect(calculateGradeSummary(courses, attempts)).toEqual({
      gpa100: null,
      gradedCredits: 0,
      gradedCourseCount: 0,
      courseScores: [],
    });
  });

  it('accepts both score boundaries and does not round before threshold comparisons', () => {
    expect(calculateGradeSummary(courses, [{ courseId: 'a', score: 100 }]).gpa100).toBe(100);
    expect(
      calculateGradeSummary(courses, [{ courseId: 'a', score: 70.004 }]).gpa100,
    ).toBeGreaterThan(70);
    expect(calculateGradeSummary(courses, [{ courseId: 'a', score: 70 }]).gpa100).toBe(70);
  });

  it.each([-1, 101, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'rejects invalid scores %s instead of silently excluding them',
    (score) => {
      expect(() => calculateGradeSummary(courses, [{ courseId: 'a', score }])).toThrow(
        'Grade scores',
      );
    },
  );

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY])('rejects invalid credits %s', (credits) => {
    expect(() => calculateGradeSummary([{ id: 'a', code: 'IT001IU', credits }], [])).toThrow(
      'Course credits',
    );
  });

  it('rejects unknown course IDs even for ungraded attempts', () => {
    expect(() => calculateGradeSummary(courses, [{ courseId: 'missing', score: null }])).toThrow(
      'unknown course',
    );
  });

  it('deduplicates consistent course metadata and rejects conflicting course metadata', () => {
    const attempts = [{ courseId: 'a', score: 90 }];
    expect(calculateGradeSummary([...courses, courses[0]], attempts)).toEqual(
      calculateGradeSummary(courses, attempts),
    );
    expect(() =>
      calculateGradeSummary([...courses, { ...courses[0], credits: 6 }], attempts),
    ).toThrow('Conflicting metadata');
  });

  it('does not mutate course or attempt inputs', () => {
    const attempts = Object.freeze([Object.freeze({ courseId: 'a', score: 80 })]);
    const inputCourses = Object.freeze(courses.map((course) => Object.freeze({ ...course })));
    calculateGradeSummary([...inputCourses], [...attempts]);
    expect(attempts[0].score).toBe(80);
    expect(inputCourses[0].credits).toBe(3);
  });
});
