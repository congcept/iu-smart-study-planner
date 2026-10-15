import { useCallback, useEffect, useRef, useState } from 'react';
import { isAxiosError } from 'axios';
import { OwnStudyPlanCoursesSchema, type OwnStudyPlanCoursesDTO } from '@iu-study-planner/shared';
import { Button } from '@/components/ui';
import {
  getSavedStudyPlanCourses,
  SavedStudyPlanCoursesSessionChangedError,
} from '@/lib/savedStudyPlanCoursesApi';

type Props = {
  ownerId: string;
  planId: string;
  semesterId: string;
  expectedCurriculumId: string | null;
  onBack: () => void;
};
type State =
  | { status: 'loading' }
  | { status: 'error'; account: boolean; unavailable: boolean }
  | { status: 'ready'; result: OwnStudyPlanCoursesDTO };
const semesterNames = { FALL: 'Fall', SPRING: 'Spring', SUMMER: 'Summer' };

function SavedCourseBody({ ownerId, planId, semesterId, expectedCurriculumId, onBack }: Props) {
  const [state, setState] = useState<State>({ status: 'loading' });
  const generation = useRef(0);
  const mounted = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const read = useCallback(async () => {
    if (!mounted.current) return;
    controller.current?.abort();
    const active = new AbortController();
    controller.current = active;
    const version = ++generation.current;
    const current = () =>
      mounted.current && generation.current === version && !active.signal.aborted;
    setState({ status: 'loading' });
    try {
      const received = await getSavedStudyPlanCourses(
        ownerId,
        planId,
        semesterId,
        expectedCurriculumId,
        active.signal,
      );
      if (!current()) return;
      const result = OwnStudyPlanCoursesSchema.parse(received);
      if (
        result.scope.userId !== ownerId ||
        result.scope.curriculumId !== expectedCurriculumId ||
        result.plan.id !== planId ||
        result.semester.id !== semesterId
      )
        throw new Error('Saved course references do not match the requested scope');
      setState({ status: 'ready', result });
    } catch (error) {
      if (!current()) return;
      const status = isAxiosError(error) ? error.response?.status : undefined;
      setState({
        status: 'error',
        account:
          error instanceof SavedStudyPlanCoursesSessionChangedError ||
          status === 401 ||
          status === 403,
        unavailable: status === 404,
      });
    }
  }, [ownerId, planId, semesterId, expectedCurriculumId]);
  const invalidate = useCallback(() => {
    mounted.current = false;
    generation.current++;
    controller.current?.abort();
  }, []);
  useEffect(() => {
    mounted.current = true;
    void read();
    const refresh = () => void read();
    const visible = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', visible);
    return () => {
      invalidate();
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [read, invalidate]);

  return (
    <section
      aria-label="Saved semester course references"
      className="rounded-xl border border-gray-200 bg-white p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">Saved semester course references</h3>
          <p className="mt-2 max-w-prose text-sm text-gray-700">
            Course names are current catalog labels, shown in stored list order. They do not
            establish the original curriculum, prerequisites, GPA eligibility or a valid timetable.
            Membership indicators describe placements in your currently assigned curriculum only.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Button type="button" variant="secondary" className="min-h-11" onClick={onBack}>
            Back to saved semesters
          </Button>
          <Button
            type="button"
            variant="secondary"
            className="min-h-11"
            disabled={state.status === 'loading'}
            onClick={() => void read()}
          >
            Reload saved courses
          </Button>
        </div>
      </div>
      {state.status === 'loading' && (
        <p role="status" className="mt-4 text-sm text-gray-600">
          Loading saved course references…
        </p>
      )}
      {state.status === 'error' && (
        <div className="mt-4">
          <p role="alert" className="text-sm text-red-700">
            {state.account
              ? 'Your account or curriculum could not be confirmed. Return to saved semesters after signing in.'
              : state.unavailable
                ? 'This saved plan or semester is no longer available. Return to saved semesters and reload.'
                : 'Could not confirm saved course references. Retry this read or reload.'}
          </p>
          {!state.account && !state.unavailable && (
            <Button
              type="button"
              variant="secondary"
              className="mt-3 min-h-11"
              onClick={() => void read()}
            >
              Retry saved courses
            </Button>
          )}
        </div>
      )}
      {state.status === 'ready' && (
        <div className="mt-4 space-y-4">
          <h4 className="break-words font-semibold text-gray-900">{state.result.plan.name}</h4>
          <p className="text-sm text-gray-700">
            {semesterNames[state.result.semester.semester]} {state.result.semester.year}
          </p>
          {state.result.courseReferences.status === 'UNAVAILABLE' ? (
            <p role="status" className="text-sm text-gray-700">
              {state.result.courseReferences.reason === 'READER_LIMIT'
                ? 'This saved course list exceeds the display limits. Its contents have been preserved.'
                : 'This older saved course format cannot be displayed safely. Its contents have been preserved.'}
            </p>
          ) : state.result.courseReferences.entries.length === 0 ? (
            <p className="text-sm text-gray-700">
              This saved semester contains an empty course list.
            </p>
          ) : (
            <ol className="list-inside list-decimal space-y-3 text-sm text-gray-700">
              {state.result.courseReferences.entries.map((entry, index) => (
                <li key={entry.courseId} className="break-words">
                  {entry.catalog ? (
                    <span>
                      <strong>{entry.catalog.code}</strong> — {entry.catalog.name}
                    </span>
                  ) : (
                    <span>Current catalog entry unavailable for saved reference {index + 1}.</span>
                  )}
                  <p className="mt-1 text-sm text-gray-600">
                    {entry.currentCurriculumMembership === 'NO_ASSIGNED_CURRICULUM'
                      ? 'No curriculum assigned — membership not assessed.'
                      : entry.currentCurriculumMembership === 'PLACED_MEMBER'
                        ? 'Listed in your current curriculum.'
                        : 'No placement in your current curriculum.'}
                  </p>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </section>
  );
}

export function SavedStudyPlanCoursesPanel(props: Props) {
  const ownerId = props.ownerId.toLowerCase();
  const planId = props.planId.toLowerCase();
  const semesterId = props.semesterId.toLowerCase();
  const expectedCurriculumId = props.expectedCurriculumId?.toLowerCase() ?? null;
  return (
    <SavedCourseBody
      key={JSON.stringify([ownerId, planId, semesterId, expectedCurriculumId])}
      {...props}
      ownerId={ownerId}
      planId={planId}
      semesterId={semesterId}
      expectedCurriculumId={expectedCurriculumId}
    />
  );
}
