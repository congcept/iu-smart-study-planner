import type { StudentGradesDTO } from '@iu-study-planner/shared';

const bands = [
  { lower: 0, upper: 20, label: '0 to below 20' },
  { lower: 20, upper: 40, label: '20 to below 40' },
  { lower: 40, upper: 60, label: '40 to below 60' },
  { lower: 60, upper: 80, label: '60 to below 80' },
  { lower: 80, upper: 100, label: '80 to 100' },
];

export function ScoreDistribution({
  courseScores,
}: {
  courseScores: StudentGradesDTO['summary']['courseScores'];
}) {
  return (
    <section
      aria-labelledby="score-distribution-title"
      className="rounded-xl border border-gray-200 bg-white p-5"
    >
      <h3 id="score-distribution-title" className="text-lg font-semibold text-gray-900">
        Highest-score distribution
      </h3>
      <p className="mt-2 max-w-prose text-sm text-gray-600">
        Each course included in your GPA counts once, using its highest recorded score. These are
        numeric score ranges, not letter grades. Counts are by course, not by credits or attempts.
      </p>
      {courseScores.length === 0 ? (
        <p className="mt-4 text-sm text-gray-600">
          No GPA-eligible numeric scores to show yet. Ungraded courses are not counted as zero.
        </p>
      ) : (
        <table className="mt-4 w-full text-left text-sm">
          <caption className="sr-only">
            Courses included in GPA by highest numeric score range
          </caption>
          <thead className="border-b border-gray-200 text-gray-700">
            <tr>
              <th scope="col" className="py-2 pr-3">
                Score / 100
              </th>
              <th scope="col" className="py-2">
                Courses
              </th>
            </tr>
          </thead>
          <tbody>
            {bands.map(({ lower, upper, label }) => {
              const count = courseScores.filter(
                ({ score }) => score >= lower && (upper === 100 ? score <= upper : score < upper),
              ).length;
              return (
                <tr key={lower}>
                  <th scope="row" className="w-1/2 py-3 pr-3 font-normal text-gray-700">
                    {label}
                  </th>
                  <td className="py-3">
                    <div className="flex items-center gap-3">
                      <span className="min-w-6 tabular-nums">{count}</span>
                      <div aria-hidden="true" className="h-2 flex-1 rounded-full bg-gray-100">
                        <div
                          className="h-2 rounded-full bg-primary-600"
                          style={{ width: `${(count / courseScores.length) * 100}%` }}
                        />
                      </div>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}
