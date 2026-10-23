import type { StudentGradesDTO } from '@iu-study-planner/shared';

export function SemesterGpa({
  semesterGrades,
}: {
  semesterGrades?: StudentGradesDTO['semesterGrades'];
}) {
  return (
    <section
      aria-labelledby="semester-gpa-title"
      className="rounded-xl border border-gray-200 bg-white p-5"
    >
      <h3 id="semester-gpa-title" className="text-lg font-semibold text-gray-900">
        Recorded semester GPA
      </h3>
      <p className="mt-2 max-w-prose text-sm text-gray-600">
        Each term uses its own highest recorded score for every course, weighted by credits. The GPA
        above combines all of your terms and is not replaced by these term figures. Term labels come
        from what you recorded with each score, not from an official academic calendar.
      </p>
      {semesterGrades === undefined ? (
        <p className="mt-4 max-w-prose text-sm text-gray-600">
          Recorded semester GPA is unavailable in this saved grade snapshot. Reload grades to
          request the current summary; the GPA above is unchanged.
        </p>
      ) : (
        <>
          <dl className="mt-4 flex flex-wrap gap-x-10 gap-y-4">
            <div>
              <dt className="text-sm text-gray-600">Recorded terms</dt>
              <dd className="mt-1 font-semibold tabular-nums">{semesterGrades.terms.length}</dd>
            </div>
            {semesterGrades.undatedAttemptCount > 0 && (
              <div>
                <dt className="text-sm text-gray-600">Scored attempts without a term</dt>
                <dd className="mt-1 font-semibold tabular-nums">
                  {semesterGrades.undatedAttemptCount}
                </dd>
              </div>
            )}
          </dl>
          {semesterGrades.terms.length === 0 ? (
            <p className="mt-4 max-w-prose text-sm text-gray-600">
              No terms recorded yet. A term GPA appears once an included course has a scored attempt
              with both a recorded term and year.
            </p>
          ) : (
            <div
              role="region"
              aria-label="Recorded semester GPA table"
              tabIndex={0}
              className="mt-4 overflow-x-auto rounded-lg border border-gray-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-700"
            >
              <table className="w-full min-w-[560px] text-left text-sm">
                <caption className="sr-only">
                  Recorded term GPA, included credits and scored courses
                </caption>
                <thead className="border-b border-gray-200 bg-gray-50 text-gray-700">
                  <tr>
                    <th scope="col" className="px-4 py-3">
                      Term
                    </th>
                    <th scope="col" className="px-4 py-3">
                      GPA · 100-point scale
                    </th>
                    <th scope="col" className="px-4 py-3">
                      Credits included
                    </th>
                    <th scope="col" className="px-4 py-3">
                      Courses with numeric scores
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {semesterGrades.terms.map((term) => (
                    <tr key={`${term.year}-${term.semester}`}>
                      <th scope="row" className="px-4 py-3 font-normal">
                        {term.semester} {term.year}
                      </th>
                      <td className="px-4 py-3 font-semibold tabular-nums">
                        {term.gpa100.toFixed(2)}
                      </td>
                      <td className="px-4 py-3 tabular-nums">{term.gradedCredits}</td>
                      <td className="px-4 py-3 tabular-nums">{term.gradedCourseCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {semesterGrades.undatedAttemptCount > 0 && (
            <p className="mt-3 max-w-prose text-sm text-gray-600">
              Scored attempts without both a recorded term and year are never assigned to a term.
              They still count toward the GPA above when their course is included.
            </p>
          )}
        </>
      )}
    </section>
  );
}
