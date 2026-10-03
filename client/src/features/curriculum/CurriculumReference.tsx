import type { CurriculumDetailDTO } from '@iu-study-planner/shared';

export function CurriculumReference({ curriculum }: { curriculum: CurriculumDetailDTO }) {
  const courses = [...curriculum.courses].sort((a, b) => a.code.localeCompare(b.code));
  const courseById = new Map(courses.map((course) => [course.id.toLowerCase(), course]));
  const parents = new Map<string, string[]>();
  for (const edge of curriculum.prerequisites) {
    const id = edge.courseId.toLowerCase();
    parents.set(id, [
      ...(parents.get(id) ?? []),
      courseById.get(edge.prerequisiteId.toLowerCase())!.code,
    ]);
  }
  return (
    <section aria-label="Assigned curriculum reference" className="space-y-5">
      <div className="rounded-xl border border-gray-200 bg-white p-5">
        <h3 className="text-lg font-semibold text-gray-900">
          {curriculum.code} · {curriculum.name}
        </h3>
        <p className="mt-2 text-sm text-gray-600">
          {curriculum.school} · {curriculum.degree}
        </p>
        <p className="mt-3 max-w-prose text-sm text-gray-700">
          This reference view is read-only. Course completion editing and degree progress are not
          available here yet. Placements show curriculum year and semester, rather than confirmed
          class offerings.
        </p>
        <p className="mt-3 text-sm text-gray-700">
          {curriculum.isGpaPath
            ? 'This reference includes a GPA-based thesis path. Use Grades to review your scores.'
            : 'This reference does not use a GPA-based thesis path.'}
        </p>
        {curriculum.sourceLabel && (
          <p className="mt-3 text-sm text-gray-600">Reference source: {curriculum.sourceLabel}</p>
        )}
        <p className="mt-3 text-sm text-gray-600">
          {courses.length} unique course {courses.length === 1 ? 'reference' : 'references'}. All
          listed prerequisites are mandatory.
        </p>
      </div>
      {courses.length === 0 ? (
        <p className="text-gray-600">No courses are included in this reference yet.</p>
      ) : (
        <ul className="grid min-w-0 gap-4 sm:grid-cols-2">
          {courses.map((course) => (
            <li key={course.id} className="min-w-0 rounded-xl border border-gray-200 bg-white p-5">
              <h4 className="break-words font-semibold text-gray-900">
                {course.code} · {course.name}
              </h4>
              <p className="mt-2 text-sm text-gray-700">{course.credits} credits</p>
              <p className="mt-2 text-sm text-gray-600">
                Difficulty {course.ratingDifficulty.toFixed(1)} / 5 ·{' '}
                {course.ratingCount === 0
                  ? 'No ratings yet'
                  : `${course.ratingCount} ${course.ratingCount === 1 ? 'rating' : 'ratings'}`}
              </p>
              <p className="mt-1 text-xs text-gray-600">
                Estimate uses{' '}
                {course.ratingPriorSource === 'CURRICULUM_RATINGS'
                  ? 'ratings across this curriculum'
                  : 'seed difficulty across this curriculum'}{' '}
                as its prior.
              </p>
              {course.placements.length === 0 ? (
                <p className="mt-3 text-sm text-gray-600">No reference placement recorded.</p>
              ) : (
                <ul
                  aria-label={`${course.code} reference placements`}
                  className="mt-3 space-y-1 text-sm text-gray-700"
                >
                  {[...course.placements]
                    .sort((a, b) => a.sourceOrder - b.sourceOrder)
                    .map((placement) => (
                      <li key={placement.id}>
                        {placement.academicYear !== null
                          ? `Year ${placement.academicYear}`
                          : 'Year unspecified'}{' '}
                        ·{' '}
                        {placement.academicSemester !== null
                          ? `Semester ${placement.academicSemester}`
                          : 'Semester unspecified'}
                        {placement.electiveGroup && ` · ${placement.electiveGroup}`}
                        {placement.electiveSelectCount !== null &&
                          ` · Select ${placement.electiveSelectCount} in this group`}
                      </li>
                    ))}
                </ul>
              )}
              <p className="mt-3 break-words text-sm text-gray-700">
                Prerequisites:{' '}
                {parents.get(course.id.toLowerCase())?.sort().join(', ') ||
                  'None listed in this reference'}
              </p>
            </li>
          ))}
        </ul>
      )}
      {curriculum.requirements.length > 0 && (
        <section aria-labelledby="reference-requirements">
          <h3 id="reference-requirements" className="text-lg font-semibold text-gray-900">
            Unresolved elective requirements
          </h3>
          <p className="mt-2 text-sm text-gray-600">
            These requirements have no specific course identity in this reference. They are not
            counted as completed courses.
          </p>
          <ul className="mt-3 space-y-2 text-sm text-gray-700">
            {curriculum.requirements.map((requirement) => (
              <li key={requirement.id}>
                {requirement.name} · {requirement.credits} credits
              </li>
            ))}
          </ul>
        </section>
      )}
    </section>
  );
}
