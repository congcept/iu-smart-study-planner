import { useCallback, useEffect, useRef, useState } from 'react';
import type { StudentGradesDTO } from '@iu-study-planner/shared';
import { Button } from '@/components/ui';
import { getStudentGrades } from '@/lib/gradesApi';
import { GradeEntry } from './GradeEntry';

export function GradeDashboard({ userId }: { userId: string }) {
  const [result, setResult] = useState<{ ownerId: string; grades: StudentGradesDTO } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<{ ownerId: string; message: string } | null>(null);
  const generation = useRef(0);
  const load = useCallback(async () => {
    const request = ++generation.current;
    setLoading(true);
    setError(null);
    try {
      const grades = await getStudentGrades();
      if (request === generation.current) setResult({ ownerId: userId, grades });
    } catch {
      if (request === generation.current)
        setError({
          ownerId: userId,
          message: 'Could not load your grades. Check your connection and try again.',
        });
    } finally {
      if (request === generation.current) setLoading(false);
    }
  }, [userId]);
  useEffect(() => {
    const activeGeneration = generation;
    void load();
    return () => {
      activeGeneration.current++;
    };
  }, [load]);
  const acceptSaved = useCallback(
    (saved: StudentGradesDTO) => {
      generation.current++;
      setResult({ ownerId: userId, grades: saved });
      setError(null);
      setLoading(false);
    },
    [userId],
  );
  const grades = result?.ownerId === userId ? result.grades : null;
  const currentError = error?.ownerId === userId ? error.message : null;
  const highest = new Map(
    grades?.summary.courseScores.map(({ courseId, score }) => [courseId, score]) ?? [],
  );

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header>
        <h2 className="text-2xl font-bold text-gray-900">Grades</h2>
        <p className="mt-2 max-w-prose text-sm text-gray-600">
          Your highest recorded score for each course is weighted by its credits. Physical training
          is excluded from GPA.
        </p>
      </header>
      {loading ? (
        <p role="status" className="text-gray-600">
          Loading your grades…
        </p>
      ) : currentError ? (
        <div>
          <p role="alert" className="text-red-700">
            {currentError}
          </p>
          <Button className="mt-3 min-h-11" onClick={() => void load()}>
            Reload grades
          </Button>
        </div>
      ) : (
        grades && (
          <>
            <section
              aria-label="Numeric GPA"
              className="rounded-xl border border-gray-200 bg-white p-5"
            >
              <dl className="flex flex-wrap gap-x-10 gap-y-4">
                <div>
                  <dt className="text-sm text-gray-600">GPA · 100-point scale</dt>
                  <dd className="mt-1 text-xl font-semibold tabular-nums text-gray-900">
                    {grades.summary.gpa100 === null
                      ? 'No scores yet'
                      : grades.summary.gpa100.toFixed(2)}
                  </dd>
                </div>
                <div>
                  <dt className="text-sm text-gray-600">Courses with numeric scores</dt>
                  <dd className="mt-1 font-semibold tabular-nums">
                    {grades.summary.gradedCourseCount}
                  </dd>
                </div>
                <div>
                  <dt className="text-sm text-gray-600">Credits included</dt>
                  <dd className="mt-1 font-semibold tabular-nums">
                    {grades.summary.gradedCredits}
                  </dd>
                </div>
              </dl>
              <p className="mt-4 max-w-prose text-sm text-gray-600">
                Only courses with recorded numeric scores are included. Ungraded courses are not
                counted as zero.
              </p>
              {grades.completedCoursesWithoutNumericGrades.length > 0 && (
                <p className="mt-3 text-sm text-amber-800">
                  {grades.completedCoursesWithoutNumericGrades.length} completed{' '}
                  {grades.completedCoursesWithoutNumericGrades.length === 1
                    ? 'course has'
                    : 'courses have'}{' '}
                  no numeric score. Your GPA covers the scored courses shown here.
                </p>
              )}
            </section>
            <GradeEntry userId={userId} onSaved={acceptSaved} />
            <section aria-labelledby="grade-history-title">
              <h3 id="grade-history-title" className="text-lg font-semibold text-gray-900">
                Grade history
              </h3>
              {grades.attempts.length === 0 ? (
                <p className="mt-3 text-gray-600">
                  No numeric grade attempts recorded yet. Existing letter grades remain unchanged.
                </p>
              ) : (
                <>
                  <p className="mt-2 text-sm text-gray-600">
                    Every attempt is kept. “Highest” marks the score used for that course in GPA.
                  </p>
                  <div
                    role="region"
                    aria-label="Grade history table"
                    tabIndex={0}
                    className="mt-4 overflow-x-auto rounded-xl border border-gray-200 bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-700"
                  >
                    <table className="w-full min-w-[640px] text-left text-sm">
                      <caption className="sr-only">Recorded course scores and retakes</caption>
                      <thead className="border-b border-gray-200 bg-gray-50 text-gray-700">
                        <tr>
                          <th scope="col" className="px-4 py-3">
                            Course
                          </th>
                          <th scope="col" className="px-4 py-3">
                            Score / 100
                          </th>
                          <th scope="col" className="px-4 py-3">
                            Term
                          </th>
                          <th scope="col" className="px-4 py-3">
                            Recorded
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-200">
                        {grades.attempts.map((attempt) => (
                          <tr key={attempt.id}>
                            <th scope="row" className="px-4 py-3 font-normal">
                              <span className="font-semibold">{attempt.course.code}</span>
                              <span className="mt-1 block max-w-xs text-gray-600">
                                {attempt.course.name}
                              </span>
                            </th>
                            <td className="px-4 py-3 tabular-nums">
                              <span className="font-semibold">{attempt.score}</span>
                              {highest.get(attempt.courseId) === attempt.score && (
                                <span className="mt-1 block text-xs text-primary-700">Highest</span>
                              )}
                            </td>
                            <td className="px-4 py-3 text-gray-600">
                              {[attempt.semester, attempt.year]
                                .filter((value) => value !== null)
                                .join(' ') || 'Not specified'}
                            </td>
                            <td className="px-4 py-3 text-gray-600">
                              <time dateTime={attempt.createdAt}>
                                {new Date(attempt.createdAt).toLocaleDateString()}
                              </time>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </section>
          </>
        )
      )}
    </div>
  );
}
