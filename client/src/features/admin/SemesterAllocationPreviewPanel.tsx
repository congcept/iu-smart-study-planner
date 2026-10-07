import { isAxiosError } from 'axios';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  SemesterAllocationPreviewSchema,
  SemesterAllocationScopeV1Schema,
  type ResourceScopeDTO,
  type SemesterAllocationPreviewDTO,
} from '@iu-study-planner/shared';
import { Button } from '@/components/ui';
import { getSession } from '@/lib/api';
import { getSemesterAllocationPreview } from '@/lib/semesterAllocationApi';

type Props = {
  userId: string;
  scope: ResourceScopeDTO;
  resourceRevision: number | null;
  courses?: ReadonlyArray<{ id: string; code: string; name: string }>;
};
class AdminSessionChanged extends Error {}

export function SemesterAllocationPreviewPanel(props: Props) {
  const owner = props.userId.toLowerCase();
  const key = JSON.stringify([
    owner,
    props.scope.curriculumId.toLowerCase(),
    props.scope.semester,
    props.scope.year,
    props.resourceRevision,
  ]);
  return <SemesterReport key={key} {...props} userId={owner} />;
}

function SemesterReport({ userId, scope, resourceRevision, courses }: Props) {
  const { curriculumId, semester, year } = scope;
  const generation = useRef(0);
  const busy = useRef(false);
  const [report, setReport] = useState<SemesterAllocationPreviewDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const verifySession = useCallback(async () => {
    const account = await getSession();
    if (!account || account.id.toLowerCase() !== userId || account.role !== 'ADMIN')
      throw new AdminSessionChanged();
  }, [userId]);
  const load = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    const token = ++generation.current;
    setReport(null);
    setLoading(true);
    setError('');
    try {
      const requested = SemesterAllocationScopeV1Schema.parse({ curriculumId, semester, year });
      await verifySession();
      if (token !== generation.current) return;
      let outcome: { success: true; value: unknown } | { success: false; failure: unknown };
      try {
        outcome = { success: true, value: await getSemesterAllocationPreview(requested) };
      } catch (failure) {
        outcome = { success: false, failure };
      }
      if (token !== generation.current) return;
      await verifySession();
      if (token !== generation.current) return;
      if (!outcome.success) throw outcome.failure;
      const result = SemesterAllocationPreviewSchema.parse(outcome.value);
      if (
        result.result.scope.curriculumId !== requested.curriculumId ||
        result.result.scope.semester !== requested.semester ||
        result.result.scope.year !== requested.year
      )
        throw new Error('Wrong semester preview scope');
      setReport(result);
    } catch (failure) {
      if (token === generation.current)
        setError(
          failure instanceof AdminSessionChanged ||
            (isAxiosError(failure) && [401, 403].includes(failure.response?.status ?? 0))
            ? 'Your admin session changed. Sign in again before reloading the semester preview.'
            : isAxiosError(failure) && failure.response?.status === 409
              ? 'This cohort exceeds the preview limits: 500 students, 100 choices per student or 10,000 total choices. A larger cohort needs a batch allocation job.'
              : 'Could not verify the semester preview. Reload to try again.',
        );
    } finally {
      if (token === generation.current) {
        busy.current = false;
        setLoading(false);
      }
    }
  }, [curriculumId, semester, verifySession, year]);
  useEffect(() => {
    const active = generation;
    const pending = busy;
    void load();
    return () => {
      active.current++;
      pending.current = false;
    };
  }, [load]);
  const result = report?.result;
  const envelope = result?.envelope;
  const names = new Map((courses ?? []).map((course) => [course.id.toLowerCase(), course]));
  return (
    <section
      aria-label="Semester allocation preview"
      className="space-y-4 border-t border-gray-200 pt-6"
    >
      <div>
        <h3 className="text-lg font-semibold text-gray-900">Semester allocation preview</h3>
        <p className="mt-2 max-w-prose text-sm text-gray-600">
          Several courses per student over simulated rounds. Each round considers at most one
          further course per student; opened course sections and seats carry forward between rounds.
          This preview saves no assignments or academic plans.
        </p>
      </div>
      <Button
        variant="secondary"
        className="min-h-11"
        disabled={loading}
        onClick={() => void load()}
      >
        Reload semester preview
      </Button>
      {loading ? (
        <p role="status" className="text-sm text-gray-600">
          Loading semester preview…
        </p>
      ) : error ? (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      ) : (
        report &&
        result &&
        envelope && (
          <>
            <p className="max-w-prose text-sm text-gray-700">
              Simulation · reference only. {result.studentCount}{' '}
              {result.studentCount === 1 ? 'student' : 'students'} in the current assigned cohort.
              The configured reference target is {report.recommendationPolicy.maxCredits} credits
              per student. The {semester.toLowerCase()} {year} scenario does not confirm official
              course offerings.
            </p>
            <dl className="grid grid-cols-1 gap-x-8 gap-y-3 text-sm sm:grid-cols-2">
              {[
                ['Students with assignments', result.assignedStudentCount],
                ['Course assignments', result.assignedCourseCount],
                ['Total reference target credits', result.totalTargetCredits],
                ['Assigned credits', result.totalAssignedCredits],
                ['Credits left unassigned', result.totalRemainingCredits],
                ['Simulated rounds', result.rounds],
              ].map(([label, value]) => (
                <div
                  key={label}
                  className="flex items-baseline justify-between gap-4 border-b border-gray-200 pb-2"
                >
                  <dt className="text-gray-700">{label}</dt>
                  <dd className="font-semibold tabular-nums text-gray-900">{value}</dd>
                </div>
              ))}
            </dl>
            <div>
              <h4 className="font-medium text-gray-900">Why each student stopped</h4>
              <dl className="mt-3 grid grid-cols-1 gap-x-8 gap-y-3 text-sm sm:grid-cols-2">
                {[
                  ['Reached reference target', result.stopReasonCounts.TARGET_REACHED],
                  ['No remaining eligible choices', result.stopReasonCounts.NO_REMAINING_CHOICES],
                  ['Choices exceed remaining credit budget', result.stopReasonCounts.CREDIT_LIMIT],
                  ['Resource settings missing', result.stopReasonCounts.RESOURCE_UNKNOWN],
                  ['Shared capacity exhausted', result.stopReasonCounts.CAPACITY_EXHAUSTED],
                ].map(([label, value]) => (
                  <div
                    key={label}
                    className="flex items-baseline justify-between gap-4 border-b border-gray-200 pb-2"
                  >
                    <dt className="text-gray-700">{label}</dt>
                    <dd className="font-semibold tabular-nums text-gray-900">{value}</dd>
                  </div>
                ))}
              </dl>
            </div>
            {result.studentCount === 0 && (
              <p className="text-sm text-gray-600">
                No students are currently assigned to this curriculum.
              </p>
            )}
            {result.studentCount > 0 &&
              result.assignedCourseCount === 0 &&
              result.stopReasonCounts.NO_REMAINING_CHOICES === result.studentCount && (
                <p className="text-sm text-gray-600">
                  No eligible choices are available for this cohort.
                </p>
              )}
            {envelope.resourceRevision !== resourceRevision && (
              <p role="status" className="max-w-prose text-sm text-gray-700">
                The preview uses a different saved resource revision from the form. Reload saved
                settings above to review it; that replaces unsaved edits. Reloading this preview
                preserves form edits.
              </p>
            )}
            {envelope.envelope ? (
              <>
                <p className="max-w-prose text-sm text-gray-700">
                  Saved resource revision {envelope.resourceRevision}. {result.usedSections} of{' '}
                  {envelope.envelope.sharedSectionCeiling} shared classroom/staff sections opened;{' '}
                  {envelope.envelope.sharedSeatCeiling} seats in the shared simulation ceiling. Each
                  opened section belongs to one course and remains shared across every round.
                </p>
                {envelope.envelope.sharedSectionCeiling === 0 && (
                  <p className="max-w-prose text-sm text-gray-600">
                    Saved settings provide zero shared section capacity. Students with eligible
                    choices cannot receive course assignments in this simulation.
                  </p>
                )}
              </>
            ) : (
              <p className="max-w-prose text-sm text-gray-600">
                No saved resource settings. Capacity is unknown; students with eligible choices
                remain unresolved.
              </p>
            )}
            {result.courses.length === 0 ? (
              <p className="text-sm text-gray-600">
                No courses are listed in this reference curriculum.
              </p>
            ) : (
              <div>
                <p className="mb-3 text-sm text-gray-600 sm:hidden">
                  Scroll the semester table horizontally to see every column.
                </p>
                <div
                  role="region"
                  aria-label="Semester course allocations"
                  tabIndex={0}
                  className="overflow-x-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
                >
                  <table className="w-full min-w-[42rem] table-fixed border-collapse text-sm text-gray-900">
                    <caption className="pb-3 text-left font-medium">
                      Shared course sections and credit assignments
                    </caption>
                    <thead>
                      <tr className="border-b border-gray-300">
                        <th scope="col" className="w-1/3 py-3 pr-3 text-left font-semibold">
                          Course
                        </th>
                        {['Credits', 'Eligible demand', 'Assigned', 'Sections', 'Opened seats'].map(
                          (label) => (
                            <th
                              key={label}
                              scope="col"
                              className="py-3 pl-2 text-right font-semibold"
                            >
                              {label}
                            </th>
                          ),
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {result.courses.map((course) => {
                        const name = names.get(course.courseId);
                        return (
                          <tr key={course.courseId} className="border-b border-gray-200">
                            <th
                              scope="row"
                              className="break-words py-3 pr-3 text-left font-normal [overflow-wrap:anywhere]"
                            >
                              {name ? (
                                <>
                                  <span className="block font-medium">{name.code}</span>
                                  <span className="text-gray-600">{name.name}</span>
                                </>
                              ) : (
                                <>
                                  <span className="block font-medium">Course ID</span>
                                  <span className="text-gray-600">{course.courseId}</span>
                                </>
                              )}
                            </th>
                            {[
                              course.credits,
                              course.demandStudentCount,
                              course.assignedStudentCount,
                              course.openedSections,
                              course.seatCapacity,
                            ].map((value, index) => (
                              <td
                                key={index}
                                className="py-3 pl-2 text-right align-top tabular-nums"
                              >
                                {value}
                              </td>
                            ))}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <p className="mt-3 max-w-prose text-sm text-gray-600">
                  Course labels use the loaded reference; credits and counts come from this preview.
                  Missing labels are shown by course ID. Eligible demand counts students who
                  considered a course; assignments count course seats, so one student can have
                  several assignments.
                </p>
              </div>
            )}
            <p className="max-w-prose text-sm text-gray-600">
              Choices use mandatory prerequisites and confirmed numeric GPA paths at the start of
              the simulation. Assignments in one round do not unlock courses in the next round. The
              credit target is a configured reference budget, not a confirmed student request.
              Official eligibility, registration, timetables, labs, staff availability and
              qualifications remain unverified. Category, grade-fit and graduation-timeline
              personalization are unavailable.
            </p>
          </>
        )
      )}
    </section>
  );
}
