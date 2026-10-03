import { useCallback, useEffect, useRef, useState } from 'react';
import type { ContextStudentProgressDTO } from '@iu-study-planner/shared';
import { Button } from '@/components/ui';
import { getContextStudentProgress } from '@/lib/curriculumApi';

type Props = { userId: string; curriculumId: string };
export function CurriculumProgressSummary(props: Props) {
  return <ProgressSession key={JSON.stringify([props.userId, props.curriculumId])} {...props} />;
}

function ProgressSession({ userId, curriculumId }: Props) {
  const [data, setData] = useState<ContextStudentProgressDTO | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const generation = useRef(0);
  const mounted = useRef(false);
  const busy = useRef(false);
  const load = useCallback(async () => {
    if (!mounted.current || busy.current) return;
    busy.current = true;
    const request = ++generation.current;
    setData(null);
    setStatus('loading');
    try {
      const snapshot = await getContextStudentProgress(userId, curriculumId);
      if (!mounted.current || request !== generation.current) return;
      if (
        snapshot.scope.userId.toLowerCase() !== userId.toLowerCase() ||
        snapshot.scope.curriculumId.toLowerCase() !== curriculumId.toLowerCase()
      )
        throw new Error('Wrong progress scope');
      setData(snapshot);
      setStatus('ready');
    } catch {
      if (mounted.current && request === generation.current) setStatus('error');
    } finally {
      if (request === generation.current) busy.current = false;
    }
  }, [userId, curriculumId]);
  const invalidate = useCallback(() => {
    mounted.current = false;
    generation.current++;
    busy.current = false;
  }, []);
  useEffect(() => {
    mounted.current = true;
    void load();
    return invalidate;
  }, [load, invalidate]);

  return (
    <section
      aria-labelledby="context-progress-title"
      className="rounded-xl border border-gray-200 bg-white p-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 id="context-progress-title" className="text-lg font-semibold text-gray-900">
          Saved curriculum progress
        </h3>
        <Button
          variant="secondary"
          className="min-h-11"
          disabled={status === 'loading'}
          onClick={() => void load()}
        >
          Reload progress
        </Button>
      </div>
      {status === 'loading' ? (
        <p role="status" className="mt-3 text-sm text-gray-600">
          Loading saved curriculum progress…
        </p>
      ) : status === 'error' ? (
        <p role="alert" className="mt-3 text-sm text-red-700">
          Could not confirm progress for this curriculum. Reload progress to try again.
        </p>
      ) : (
        data && (
          <>
            <dl className="mt-4 flex flex-wrap gap-x-8 gap-y-4">
              {[
                ['Completed courses', data.progress.completedCourses],
                ['Earned credits', data.progress.completedCredits],
                ['Planned courses', data.planned.length],
                ['In progress', data.inProgress.length],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt className="text-sm text-gray-600">{label}</dt>
                  <dd className="mt-1 font-semibold tabular-nums text-gray-900">{value}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-4 max-w-prose text-sm text-gray-600">
              Totals include only current curriculum members. Physical training earns no degree
              credits. Degree percentage and remaining degree requirements are not verified.
            </p>
            {data.completed.length + data.inProgress.length + data.planned.length === 0 && (
              <p className="mt-3 text-sm text-gray-600">
                No saved course selections in this curriculum yet.
              </p>
            )}
            {data.historicalRecords.length > 0 && (
              <div className="mt-4">
                <h4 className="font-semibold text-gray-900">
                  Historical selections outside this curriculum
                </h4>
                <p className="mt-2 text-sm text-gray-600">
                  These records remain saved and do not contribute to the current totals.
                </p>
                <ul className="mt-3 space-y-2 text-sm text-gray-700">
                  {data.historicalRecords.map((record) => (
                    <li key={record.id} className="break-words">
                      {record.course.code} · {record.course.name} ·{' '}
                      {record.status === 'COMPLETED'
                        ? 'Completed'
                        : record.status === 'IN_PROGRESS'
                          ? 'In progress'
                          : record.status === 'PLANNED'
                            ? 'Planned'
                            : 'Dropped'}
                      {record.electiveGroup && ` · ${record.electiveGroup}`}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )
      )}
    </section>
  );
}
