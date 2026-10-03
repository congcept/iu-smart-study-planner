import type {
  CurriculumSemesterPreviewDTO,
  SemesterPreviewUnscheduledReason,
} from '@iu-study-planner/shared';
import { CourseRatingBadge } from '../curriculum/CourseRatingBadge';

const reasonLabels: Record<SemesterPreviewUnscheduledReason, string> = {
  UNPLACED: 'No valid reference semester placement is recorded for this course.',
  GPA_EXCLUDED: 'This placement is excluded by the GPA path from your recorded scores.',
  COURSE_EXCEEDS_CREDIT_CAP: 'This course exceeds the credit limit for the selected intensity.',
  REFERENCE_SLOT_LIMIT: 'This placement is beyond the preview’s reference slot limit.',
  PREREQUISITE_CYCLE: 'A prerequisite cycle prevents this course from being scheduled.',
  UNMET_PREREQUISITE:
    'A mandatory prerequisite has not been completed or scheduled in an earlier slot.',
  NO_REMAINING_PLACEMENT:
    'No reference placement remains with prerequisites met and enough credit space.',
};

export function CurriculumPlannerPreview({ preview }: { preview: CurriculumSemesterPreviewDTO }) {
  const byId = new Map(preview.courses.map((course) => [course.id, course]));
  return (
    <section aria-label="Reference semester preview" className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-gray-900">Reference semester preview</h3>
        <p className="mt-2 max-w-prose text-sm text-gray-700">
          Reference curriculum slots, not a timetable. Elective and course offering requirements
          still need verification.
        </p>
        <p className="mt-2 text-sm text-gray-700">
          {preview.gpaPath === 'THESIS'
            ? 'Recorded GPA path: Thesis.'
            : preview.gpaPath === 'ALTERNATIVE'
              ? 'Recorded GPA path: Alternative.'
              : 'No GPA path restriction is applied.'}
        </p>
        {preview.scope.ratingPrior && (
          <p className="mt-2 max-w-prose text-sm text-gray-700">
            Difficulty estimates combine course votes with a shared prior.{' '}
            {preview.scope.ratingPrior.source === 'CURRICULUM_RATINGS'
              ? 'The prior uses ratings in this curriculum.'
              : 'The prior uses seed estimates in this reference curriculum.'}{' '}
            Vote counts are shown with each estimate.
          </p>
        )}
      </div>
      <div>
        <h4 className="font-semibold text-gray-900">Saved planned courses</h4>
        <p className="mt-2 text-sm text-gray-700 tabular-nums">
          {preview.stats.selectedCourseCount} selected courses · {preview.stats.selectedCredits}{' '}
          selected credits. {preview.stats.scheduledCourseCount} scheduled courses ·{' '}
          {preview.stats.scheduledCredits} scheduled credits.
        </p>
        {preview.courses.length === 0 ? (
          <p className="mt-2 text-sm text-gray-700">
            No current curriculum courses are planned yet. This preview uses only saved selections.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-gray-200 border-y border-gray-200">
            {preview.courses.map((course) => (
              <li
                key={course.id}
                className="flex flex-wrap items-baseline justify-between gap-2 py-3"
              >
                <div className="min-w-0 break-words">
                  <strong className="text-gray-900">{course.code}</strong>{' '}
                  <span className="text-gray-700">{course.name}</span>
                  <CourseRatingBadge course={course} />
                </div>
                <span className="text-sm text-gray-700">{course.credits} credits</span>
              </li>
            ))}
          </ul>
        )}
        {preview.ignoredPlannedIds.length > 0 && (
          <p className="mt-3 text-sm text-gray-700">
            {preview.ignoredPlannedIds.length} saved planned courses outside this curriculum were
            excluded from the preview. Their history is preserved.
          </p>
        )}
      </div>
      {preview.slots.map((slot) => (
        <section
          key={`${slot.academicYear}:${slot.academicSemester}`}
          aria-label={`Year ${slot.academicYear}, Semester ${slot.academicSemester}`}
          className="border-t border-gray-200 pt-5"
        >
          <h4 className="font-semibold text-gray-900">
            Year {slot.academicYear}, Semester {slot.academicSemester}
          </h4>
          <p className="mt-2 text-sm text-gray-700 tabular-nums">
            {slot.totalCredits} credits · Average rating difficulty{' '}
            {slot.averageDifficulty.toFixed(1)} / 5
          </p>
          <ul className="mt-3 space-y-2 text-sm text-gray-700">
            {slot.courseIds.map((id) => {
              const course = byId.get(id)!;
              return (
                <li key={id}>
                  <strong className="text-gray-900">{course.code}</strong> {course.name}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
      {preview.unscheduled.length > 0 && (
        <section aria-label="Unscheduled courses" className="border-t border-gray-200 pt-5">
          <h4 className="font-semibold text-gray-900">Unscheduled courses</h4>
          <ul className="mt-3 space-y-3 text-sm text-gray-700">
            {preview.unscheduled.map(({ courseId, reason }) => {
              const course = byId.get(courseId)!;
              return (
                <li key={courseId}>
                  <strong className="text-gray-900">{course.code}</strong> {course.name}
                  <p className="mt-1">{reasonLabels[reason]}</p>
                </li>
              );
            })}
          </ul>
        </section>
      )}
      {preview.requirements.length > 0 && (
        <section aria-label="Unresolved requirements" className="border-t border-gray-200 pt-5">
          <h4 className="font-semibold text-gray-900">Unresolved requirements</h4>
          <p className="mt-2 max-w-prose text-sm text-gray-700">
            These reference requirements are not courses and are not resolved by this preview.
          </p>
          <ul className="mt-3 space-y-2 text-sm text-gray-700">
            {preview.requirements.map((requirement) => (
              <li key={requirement.id}>
                {requirement.name} · {requirement.credits} credits
                {requirement.academicYear !== null && requirement.academicSemester !== null
                  ? ` · Year ${requirement.academicYear}, Semester ${requirement.academicSemester}`
                  : ''}
              </li>
            ))}
          </ul>
        </section>
      )}
    </section>
  );
}
