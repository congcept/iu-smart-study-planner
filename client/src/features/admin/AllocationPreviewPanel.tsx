import { isAxiosError } from 'axios';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AllocationPreviewSchema,
  ResourceScopeSchema,
  type AllocationPreviewDTO,
  type ResourceScopeDTO,
} from '@iu-study-planner/shared';
import { Button } from '@/components/ui';
import { getSession } from '@/lib/api';
import { getAllocationPreview } from '@/lib/adminResourcesApi';

type Props = { userId: string; scope: ResourceScopeDTO; resourceRevision: number | null };
class AdminSessionChanged extends Error {}
const percent = new Intl.NumberFormat(undefined, { style: 'percent', maximumFractionDigits: 1 });

export function AllocationPreviewPanel({ userId, scope, resourceRevision }: Props) {
  const owner = userId.toLowerCase();
  const key = JSON.stringify([
    owner,
    scope.curriculumId.toLowerCase(),
    scope.semester,
    scope.year,
    resourceRevision,
  ]);
  return (
    <AllocationReport key={key} userId={owner} scope={scope} resourceRevision={resourceRevision} />
  );
}

function AllocationReport({ userId, scope, resourceRevision }: Props) {
  const { curriculumId, semester, year } = scope;
  const generation = useRef(0);
  const busy = useRef(false);
  const [report, setReport] = useState<AllocationPreviewDTO | null>(null);
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
    setLoading(true);
    setReport(null);
    setError('');
    try {
      const requested = ResourceScopeSchema.parse({ curriculumId, semester, year });
      await verifySession();
      if (token !== generation.current) return;
      const result = AllocationPreviewSchema.parse(await getAllocationPreview(requested));
      if (token !== generation.current) return;
      const resultScope = result.snapshot.demand.scope;
      if (
        resultScope.curriculumId !== requested.curriculumId ||
        resultScope.semester !== requested.semester ||
        resultScope.year !== requested.year
      )
        throw new Error('Wrong allocation preview scope');
      await verifySession();
      if (token !== generation.current) return;
      setReport(result);
    } catch (failure) {
      if (token === generation.current)
        setError(
          failure instanceof AdminSessionChanged ||
            (isAxiosError(failure) && [401, 403].includes(failure.response?.status ?? 0))
            ? 'Your admin session changed. Sign in again before reloading the allocation preview.'
            : isAxiosError(failure) && failure.response?.status === 409
              ? 'This cohort exceeds the preview limits: 500 students, 100 choices per student or 10,000 total choices. A larger cohort needs a batch allocation job.'
              : 'Could not verify the allocation preview. Reload to try again.',
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
  const source = report?.snapshot;
  const envelope = source?.resourceEnvelope;
  return (
    <section aria-label="Allocation preview" className="space-y-4 border-t border-gray-200 pt-6">
      <div>
        <h3 className="text-lg font-semibold text-gray-900">Allocation preview</h3>
        <p className="mt-2 max-w-prose text-sm text-gray-600">
          One course per student in one simulated round. Uses eligible planned and recommended
          choices from the current assigned cohort. This preview saves no assignments.
        </p>
      </div>
      <Button
        variant="secondary"
        className="min-h-11"
        disabled={loading}
        onClick={() => void load()}
      >
        Reload allocation preview
      </Button>
      {loading ? (
        <p role="status" className="text-sm text-gray-600">
          Loading allocation preview…
        </p>
      ) : error ? (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      ) : (
        report &&
        source &&
        envelope && (
          <>
            <p className="max-w-prose text-sm text-gray-700">
              Simulation · reference only. {source.demand.cohortStudentCount}{' '}
              {source.demand.cohortStudentCount === 1 ? 'student' : 'students'} in this cohort;{' '}
              {source.demand.demandStudentCount} have eligible choices, totaling{' '}
              {source.demand.demandSelectionCount} course choices. The selected semester and year
              identify the scenario; official term offerings are unverified.
            </p>
            <dl className="grid grid-cols-1 gap-x-8 gap-y-3 text-sm sm:grid-cols-2">
              {[
                ['Assigned in simulation', report.assignedStudentCount],
                ['No eligible choices', report.noChoicesStudentCount],
                ['Unresolved without resource settings', report.resourceUnknownStudentCount],
                ['Unassigned after capacity is exhausted', report.capacityExhaustedStudentCount],
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
            {source.demand.cohortStudentCount === 0 && (
              <p className="text-sm text-gray-600">
                No students are currently assigned to this curriculum.
              </p>
            )}
            {source.demand.cohortStudentCount > 0 && source.demand.demandStudentCount === 0 && (
              <p className="text-sm text-gray-600">
                No eligible choices are available for this cohort.
              </p>
            )}
            {source.demand.unresolvedGpaStudentCount > 0 && (
              <p className="max-w-prose text-sm text-gray-600">
                {source.demand.unresolvedGpaStudentCount}{' '}
                {source.demand.unresolvedGpaStudentCount === 1 ? 'student has' : 'students have'} no
                confirmed numeric GPA path. Final-semester fork-only choices are deferred for them.
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
              <p className="max-w-prose text-sm text-gray-700">
                Saved resource revision {envelope.resourceRevision}. {report.usedSections} of{' '}
                {envelope.envelope.sharedSectionCeiling} shared classroom/staff sections opened;{' '}
                {envelope.envelope.sharedSeatCeiling}{' '}
                {envelope.envelope.sharedSeatCeiling === 1 ? 'seat' : 'seats'} in the shared
                simulation ceiling. Seats belong to opened course sections, not to every course at
                once.
              </p>
            ) : (
              <p className="max-w-prose text-sm text-gray-600">
                No saved resource settings. Capacity is unknown; eligible students remain
                unresolved.
              </p>
            )}
            {report.courses.length === 0 ? (
              <p className="text-sm text-gray-600">
                No courses are listed in this reference curriculum.
              </p>
            ) : (
              <div>
                <p className="mb-3 text-sm text-gray-600 sm:hidden">
                  Scroll the allocation table horizontally to see every column.
                </p>
                <div
                  role="region"
                  aria-label="Course allocation comparison"
                  tabIndex={0}
                  className="overflow-x-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
                >
                  <table className="w-full min-w-[40rem] table-fixed border-collapse text-sm text-gray-900">
                    <caption className="pb-3 text-left font-medium">
                      Eligible choices and simulated seat assignments
                    </caption>
                    <thead>
                      <tr className="border-b border-gray-300">
                        <th scope="col" className="w-1/3 py-3 pr-3 text-left font-semibold">
                          Course
                        </th>
                        {[
                          'Eligible demand',
                          'Assigned',
                          'Sections',
                          'Opened seats',
                          'Assigned-seat use',
                        ].map((label) => (
                          <th
                            key={label}
                            scope="col"
                            className="py-3 pl-2 text-right font-semibold"
                          >
                            {label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {report.courses.map((course) => (
                        <tr key={course.id} className="border-b border-gray-200">
                          <th scope="row" className="break-words py-3 pr-3 text-left font-normal">
                            <span className="block font-medium">{course.code}</span>
                            <span className="text-gray-600">{course.name}</span>
                          </th>
                          {[
                            course.demandStudentCount,
                            course.assignedStudentCount,
                            course.openedSections,
                            course.seatCapacity,
                            course.seatUtilization === null
                              ? 'No section'
                              : percent.format(course.seatUtilization),
                          ].map((value, index) => (
                            <td
                              key={index}
                              className="break-words py-3 pl-2 text-right align-top tabular-nums [overflow-wrap:anywhere]"
                            >
                              {value}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            <p className="max-w-prose text-sm text-gray-600">
              Assigned-seat use compares simulated assignments with opened seats; it is not demand
              divided by supply. Ranking uses Bayesian difficulty, resource fit and scarcity.
              Category, grade-fit and graduation-timeline personalization remain unavailable. Labs,
              course overrides, professor availability and qualifications, calendars and
              full-semester allocation remain unverified.
            </p>
          </>
        )
      )}
    </section>
  );
}
