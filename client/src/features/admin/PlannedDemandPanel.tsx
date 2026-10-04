import { useCallback, useEffect, useRef, useState } from 'react';
import {
  SimulationCapacitySnapshotSchema,
  ResourceScopeSchema,
  type SimulationCapacitySnapshotDTO,
  type ResourceScopeDTO,
} from '@iu-study-planner/shared';
import { Button } from '@/components/ui';
import { getSession } from '@/lib/api';
import { getSimulationCapacity } from '@/lib/adminResourcesApi';

type Props = { userId: string; scope: ResourceScopeDTO; resourceRevision: number | null };

export function PlannedDemandPanel({ userId, scope, resourceRevision }: Props) {
  const owner = userId.toLowerCase();
  const key = JSON.stringify([
    owner,
    scope.curriculumId.toLowerCase(),
    scope.semester,
    scope.year,
    resourceRevision,
  ]);
  return (
    <PlannedSelectionReport
      key={key}
      userId={owner}
      scope={scope}
      resourceRevision={resourceRevision}
    />
  );
}

function PlannedSelectionReport({ userId, scope, resourceRevision }: Props) {
  const { curriculumId, semester, year } = scope;
  const generation = useRef(0);
  const busy = useRef(false);
  const [snapshot, setSnapshot] = useState<SimulationCapacitySnapshotDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    const token = ++generation.current;
    setLoading(true);
    setSnapshot(null);
    setError('');
    try {
      const requested = ResourceScopeSchema.parse({ curriculumId, semester, year });
      const account = await getSession();
      if (token !== generation.current) return;
      if (!account || account.id.toLowerCase() !== userId || account.role !== 'ADMIN') {
        setError('Your admin session changed. Sign in again before reloading planned selections.');
        return;
      }
      const report = SimulationCapacitySnapshotSchema.parse(await getSimulationCapacity(requested));
      if (token !== generation.current) return;
      if (
        report.plannedSelections.scope.curriculumId !== requested.curriculumId ||
        report.plannedSelections.scope.semester !== requested.semester ||
        report.plannedSelections.scope.year !== requested.year
      )
        throw new Error('Wrong capacity report scope');
      setSnapshot(report);
    } catch {
      if (token === generation.current)
        setError('Could not verify planned selections and declared seats. Reload to try again.');
    } finally {
      if (token === generation.current) {
        busy.current = false;
        setLoading(false);
      }
    }
  }, [curriculumId, semester, userId, year]);
  useEffect(() => {
    const active = generation;
    const loadingRequest = busy;
    void load();
    return () => {
      active.current++;
      loadingRequest.current = false;
    };
  }, [load]);

  const selections = snapshot?.plannedSelections;
  return (
    <section aria-label="Planned selections" className="space-y-4 border-t border-gray-200 pt-6">
      <div>
        <h3 className="text-lg font-semibold text-gray-900">
          Planned selections and declared seats
        </h3>
        <p className="mt-2 max-w-prose text-sm text-gray-600">
          Compare current selections with declared course seats in this simulation. The semester and
          year identify the scenario; selections are not filtered to that term.
        </p>
      </div>
      <Button
        variant="secondary"
        className="min-h-11"
        disabled={loading}
        onClick={() => void load()}
      >
        Reload planned selections
      </Button>
      {loading ? (
        <p role="status" className="text-sm text-gray-600">
          Loading current planned selections…
        </p>
      ) : error ? (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      ) : (
        snapshot &&
        selections && (
          <>
            <p className="max-w-prose text-sm text-gray-700">
              Simulation · reference only. {selections.cohortStudentCount} students in the current
              assigned cohort; {selections.plannedStudentCount} students have member-course
              selections, totaling {selections.plannedSelectionCount} planned selections. Each
              student is counted once per course.
            </p>
            <p className="max-w-prose text-sm text-gray-600">
              {selections.ignoredNonmemberSelectionCount} selections outside the current curriculum
              were excluded from course counts. Completed courses are not counted as planned
              selections.
            </p>
            {selections.resourceRevision !== resourceRevision && (
              <p role="status" className="max-w-prose text-sm text-gray-700">
                The report uses a different saved resource revision from the form. Use “Reload saved
                settings” above to review the latest settings; it replaces unsaved edits. Reloading
                this report leaves your form edits unchanged.
              </p>
            )}
            {selections.cohortStudentCount === 0 && (
              <p className="text-sm text-gray-600">
                No students are currently assigned to this curriculum.
              </p>
            )}
            {selections.cohortStudentCount > 0 && selections.plannedSelectionCount === 0 && (
              <p className="text-sm text-gray-600">
                No member courses are currently planned by this cohort.
              </p>
            )}
            {snapshot.resources && snapshot.classroomSeatProxy ? (
              <p className="max-w-prose text-sm text-gray-700">
                Classroom seat proxy: {snapshot.resources.classrooms} rooms ×{' '}
                {snapshot.resources.maxStudentsPerSection} students per section ={' '}
                {snapshot.classroomSeatProxy.seats} seats for one simultaneous section per room.
                This shared proxy is not semester supply and is not assigned to individual courses.
                Lab rooms and professors have not been converted into seats.
              </p>
            ) : (
              <p className="max-w-prose text-sm text-gray-600">
                No saved resource settings. Declared course seats and the classroom proxy are
                unknown.
              </p>
            )}
            <p className="max-w-prose text-sm text-gray-600">
              Declared seats use explicit course limits. Zero is an explicit limit of no seats;
              Unknown means no course capacity was specified. Above limit counts planned selections
              beyond declared seats; it does not identify rejected students or an allocation.
            </p>
            {snapshot.ignoredNonmemberOverrideCount > 0 && (
              <p className="max-w-prose text-sm text-gray-600">
                {snapshot.ignoredNonmemberOverrideCount} saved course overrides outside this
                curriculum were excluded from the diagnostic.
              </p>
            )}
            {snapshot.courses.length === 0 ? (
              <p className="text-sm text-gray-600">
                No courses are listed in this reference curriculum.
              </p>
            ) : (
              <div>
                <p className="mb-3 text-sm text-gray-600 sm:hidden">
                  Scroll the course table horizontally to see every column.
                </p>
                <div
                  role="region"
                  aria-label="Course seat comparison"
                  tabIndex={0}
                  className="overflow-x-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
                >
                  <table className="w-full min-w-[24rem] table-fixed border-collapse text-sm text-gray-900">
                    <caption className="pb-3 text-left font-medium">
                      Current planned selections and declared seats
                    </caption>
                    <thead>
                      <tr className="border-b border-gray-300">
                        <th scope="col" className="w-2/5 py-3 pr-3 text-left font-semibold">
                          Course
                        </th>
                        <th scope="col" className="w-1/5 py-3 pl-2 text-right font-semibold">
                          Students planned
                        </th>
                        <th scope="col" className="w-1/5 py-3 pl-2 text-right font-semibold">
                          Declared seats
                        </th>
                        <th scope="col" className="w-1/5 py-3 pl-2 text-right font-semibold">
                          Above limit
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {snapshot.courses.map((course, index) => (
                        <tr key={course.id} className="border-b border-gray-200">
                          <th scope="row" className="break-words py-3 pr-3 text-left font-normal">
                            <span className="block font-medium">{course.code}</span>
                            <span className="text-gray-600">{selections.courses[index].name}</span>
                          </th>
                          <td className="break-words py-3 pl-2 text-right align-top tabular-nums [overflow-wrap:anywhere]">
                            {selections.courses[index].plannedStudentCount}
                          </td>
                          <td className="break-words py-3 pl-2 text-right align-top tabular-nums [overflow-wrap:anywhere]">
                            {course.declaredSeatCapacity ?? 'Unknown'}
                          </td>
                          <td className="break-words py-3 pl-2 text-right align-top tabular-nums [overflow-wrap:anywhere]">
                            {course.excessPlannedSelections ?? 'Unknown'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            <p className="max-w-prose text-sm text-gray-600">
              Full demand, supply and utilization remain unvalidated. Eligibility, recommendation
              demand, official offerings and allocation have not been validated. These comparisons
              do not change student recommendations.
            </p>
          </>
        )
      )}
    </section>
  );
}
