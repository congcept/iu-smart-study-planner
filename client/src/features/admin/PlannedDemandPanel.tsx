import { useCallback, useEffect, useRef, useState } from 'react';
import {
  PlannedDemandSnapshotSchema,
  ResourceScopeSchema,
  type PlannedDemandSnapshotDTO,
  type ResourceScopeDTO,
} from '@iu-study-planner/shared';
import { Button } from '@/components/ui';
import { getSession } from '@/lib/api';
import { getPlannedDemand } from '@/lib/adminResourcesApi';

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
  const [snapshot, setSnapshot] = useState<PlannedDemandSnapshotDTO | null>(null);
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
      const report = PlannedDemandSnapshotSchema.parse(await getPlannedDemand(requested));
      if (token !== generation.current) return;
      if (
        report.scope.curriculumId !== requested.curriculumId ||
        report.scope.semester !== requested.semester ||
        report.scope.year !== requested.year
      )
        throw new Error('Wrong planned selection scope');
      setSnapshot(report);
    } catch {
      if (token === generation.current)
        setError('Could not verify planned selections. Reload to try again.');
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

  return (
    <section aria-label="Planned selections" className="space-y-4 border-t border-gray-200 pt-6">
      <div>
        <h3 className="text-lg font-semibold text-gray-900">Planned selections</h3>
        <p className="mt-2 max-w-prose text-sm text-gray-600">
          A simulation report of current selections in this reference curriculum. The semester and
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
        snapshot && (
          <>
            <p className="max-w-prose text-sm text-gray-700">
              Simulation · reference only. {snapshot.cohortStudentCount} students in the current
              assigned cohort; {snapshot.plannedStudentCount} students have member-course
              selections, totaling {snapshot.plannedSelectionCount} planned selections. Each student
              is counted once per course.
            </p>
            <p className="max-w-prose text-sm text-gray-600">
              {snapshot.ignoredNonmemberSelectionCount} selections outside the current curriculum
              were excluded from course counts. Completed courses are not counted as planned
              selections.
            </p>
            {snapshot.resourceRevision !== resourceRevision && (
              <p role="status" className="max-w-prose text-sm text-gray-700">
                Resource settings changed since the form loaded. Use “Reload saved settings” above
                to review the latest settings; it replaces unsaved edits. These selection counts do
                not confirm course capacity.
              </p>
            )}
            {snapshot.cohortStudentCount === 0 && (
              <p className="text-sm text-gray-600">
                No students are currently assigned to this curriculum.
              </p>
            )}
            {snapshot.cohortStudentCount > 0 && snapshot.plannedSelectionCount === 0 && (
              <p className="text-sm text-gray-600">
                No member courses are currently planned by this cohort.
              </p>
            )}
            {snapshot.courses.length === 0 ? (
              <p className="text-sm text-gray-600">
                No courses are listed in this reference curriculum.
              </p>
            ) : (
              <table className="w-full table-fixed border-collapse text-sm text-gray-900">
                <caption className="pb-3 text-left font-medium">Current planned selections</caption>
                <thead>
                  <tr className="border-b border-gray-300">
                    <th scope="col" className="w-2/3 py-3 pr-4 text-left font-semibold">
                      Course
                    </th>
                    <th scope="col" className="py-3 text-right font-semibold">
                      Students planned
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {snapshot.courses.map((course) => (
                    <tr key={course.id} className="border-b border-gray-200">
                      <th scope="row" className="break-words py-3 pr-4 text-left font-normal">
                        <span className="block font-medium">{course.code}</span>
                        <span className="text-gray-600">{course.name}</span>
                      </th>
                      <td className="py-3 text-right align-top tabular-nums">
                        {course.plannedStudentCount}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p className="max-w-prose text-sm text-gray-600">
              Supply and utilization are unknown. Resource totals have not been converted into
              course capacity. Eligibility, recommendation demand and official offerings have not
              been validated.
            </p>
          </>
        )
      )}
    </section>
  );
}
