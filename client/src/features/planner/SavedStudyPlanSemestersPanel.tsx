import { useCallback, useEffect, useRef, useState } from 'react';
import { isAxiosError } from 'axios';
import {
  OwnStudyPlanSemestersSchema,
  type OwnStudyPlanSemesterMetadataDTO,
  type OwnStudyPlanSemestersDTO,
} from '@iu-study-planner/shared';
import { Button } from '@/components/ui';
import {
  isOlderSavedStudyPlanSemester,
  listSavedStudyPlanSemesters,
  SavedStudyPlanSemestersSessionChangedError,
} from '@/lib/savedStudyPlanSemestersApi';

import { SavedStudyPlanCoursesPanel } from './SavedStudyPlanCoursesPanel';

type Props = {
  ownerId: string;
  planId: string;
  expectedCurriculumId: string | null;
  onBack: () => void;
};
type Request = { after?: string; boundary?: OwnStudyPlanSemesterMetadataDTO };
type State =
  | { status: 'selected'; semesterId: string }
  | { status: 'loading' }
  | { status: 'error'; account: boolean; unavailable: boolean; cursor: boolean }
  | { status: 'ready'; page: OwnStudyPlanSemestersDTO };
const semesterNames = { FALL: 'Fall', SPRING: 'Spring', SUMMER: 'Summer' };

function SavedSemesterBody({ ownerId, planId, expectedCurriculumId, onBack }: Props) {
  const [state, setState] = useState<State>({ status: 'loading' });
  const generation = useRef(0);
  const mounted = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const lastRequest = useRef<Request>({});
  const heading = useRef<HTMLHeadingElement>(null);
  const isSelected = state.status === 'selected';

  useEffect(() => {
    if (!isSelected) heading.current?.focus();
  }, [isSelected]);

  const read = useCallback(
    async (input: Request) => {
      if (!mounted.current) return;
      const request = JSON.parse(JSON.stringify(input)) as Request;
      lastRequest.current = request;
      controller.current?.abort();
      const active = new AbortController();
      controller.current = active;
      const version = ++generation.current;
      const current = () =>
        mounted.current && generation.current === version && !active.signal.aborted;
      setState({ status: 'loading' });
      try {
        const received = await listSavedStudyPlanSemesters(
          ownerId,
          planId,
          expectedCurriculumId,
          request.after ? { after: request.after } : {},
          { boundary: request.boundary, signal: active.signal },
        );
        if (!current()) return;
        const page = OwnStudyPlanSemestersSchema.parse(received);
        if (
          page.scope.userId !== ownerId ||
          page.scope.curriculumId !== expectedCurriculumId ||
          page.plan.id !== planId ||
          page.after !== (request.after ?? null) ||
          (request.boundary &&
            page.semesters.some(
              (semester) => !isOlderSavedStudyPlanSemester(semester, request.boundary!),
            ))
        )
          throw new Error('Saved semester metadata does not match its requested scope');
        setState({ status: 'ready', page });
      } catch (error) {
        if (!current()) return;
        const status = isAxiosError(error) ? error.response?.status : undefined;
        setState({
          status: 'error',
          account:
            error instanceof SavedStudyPlanSemestersSessionChangedError ||
            status === 401 ||
            status === 403,
          unavailable: status === 404,
          cursor: status === 409,
        });
      }
    },
    [ownerId, planId, expectedCurriculumId],
  );
  const invalidate = useCallback(() => {
    mounted.current = false;
    generation.current++;
    controller.current?.abort();
  }, []);
  useEffect(() => {
    mounted.current = true;
    void read({});
    const refresh = () => void read({});
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

  const returnToSemesters = useCallback(() => {
    void read({});
  }, [read]);
  const renderGeneration = generation.current;
  if (state.status === 'selected')
    return (
      <SavedStudyPlanCoursesPanel
        ownerId={ownerId}
        planId={planId}
        semesterId={state.semesterId}
        expectedCurriculumId={expectedCurriculumId}
        onBack={returnToSemesters}
      />
    );

  const pending = state.status === 'loading';
  return (
    <section
      aria-label="Saved plan semester references"
      className="rounded-xl border border-gray-200 bg-white p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h3 ref={heading} tabIndex={-1} className="text-lg font-semibold text-gray-900">
            Saved plan semester references
          </h3>
          <p className="mt-2 max-w-prose text-sm text-gray-700">
            These are stored semester labels and credit totals, newest saved first. This order is
            not an academic sequence. Credits have not been checked against current courses,
            prerequisites, GPA or a timetable. These references do not change your course
            selections.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Button type="button" variant="secondary" className="min-h-11" onClick={onBack}>
            Back to saved plans
          </Button>
          <Button
            type="button"
            variant="secondary"
            className="min-h-11"
            disabled={pending}
            onClick={() => void read({})}
          >
            Reload saved semesters
          </Button>
        </div>
      </div>
      {pending && (
        <p role="status" className="mt-4 text-sm text-gray-600">
          Loading saved semester references…
        </p>
      )}
      {state.status === 'error' && (
        <div className="mt-4">
          <p role="alert" className="text-sm text-red-700">
            {state.account
              ? 'Your account or curriculum could not be confirmed. Return to saved plans and reload after signing in.'
              : state.unavailable
                ? 'This saved plan is no longer available. Return to saved plans and reload.'
                : state.cursor
                  ? 'This saved semester page is no longer available. Reload saved semesters for the latest references.'
                  : 'Could not confirm the saved semester references. Retry this read or reload the latest references.'}
          </p>
          {!state.account && !state.unavailable && !state.cursor && (
            <Button
              type="button"
              variant="secondary"
              className="mt-3 min-h-11"
              onClick={() => void read(lastRequest.current)}
            >
              Retry saved semesters
            </Button>
          )}
        </div>
      )}
      {state.status === 'ready' && (
        <div className="mt-4 space-y-4">
          <h4 className="break-words font-semibold text-gray-900">{state.page.plan.name}</h4>
          <p className="text-sm text-gray-700">
            {state.page.plan.isActive ? 'Previously marked active' : 'Previous saved plan'} ·{' '}
            {state.page.plan.semesterCount} saved semesters
          </p>
          {state.page.semesters.length === 0 ? (
            <p className="text-sm text-gray-700">
              {state.page.after
                ? 'No older saved semester references are available.'
                : 'No saved semester references for this plan yet.'}
            </p>
          ) : (
            <ul className="divide-y divide-gray-200">
              {state.page.semesters.map((semester, index) => (
                <li key={semester.id} className="space-y-2 py-3 text-sm text-gray-700">
                  <h5 className="font-semibold text-gray-900">
                    {semesterNames[semester.semester]} {semester.year}
                  </h5>
                  <p>Stored credit total: {semester.storedTotalCredits} · not verified</p>
                  <Button
                    type="button"
                    variant="secondary"
                    className="min-h-11"
                    aria-label={`View courses for ${semesterNames[semester.semester]} ${semester.year} (semester ${index + 1})`}
                    onClick={() => {
                      if (!mounted.current || generation.current !== renderGeneration) return;
                      generation.current++;
                      controller.current?.abort();
                      setState({ status: 'selected', semesterId: semester.id });
                    }}
                  >
                    View courses
                  </Button>
                  <p>
                    Saved{' '}
                    <time dateTime={semester.createdAt}>
                      {new Date(semester.createdAt).toLocaleString()}
                    </time>
                  </p>
                  <p>
                    Updated{' '}
                    <time dateTime={semester.updatedAt}>
                      {new Date(semester.updatedAt).toLocaleString()}
                    </time>
                  </p>
                </li>
              ))}
            </ul>
          )}
          {state.page.nextAfter && (
            <Button
              type="button"
              variant="secondary"
              className="min-h-11"
              onClick={() =>
                void read({ after: state.page.nextAfter!, boundary: state.page.semesters.at(-1) })
              }
            >
              Older saved semesters
            </Button>
          )}
          {state.page.after && (
            <Button
              type="button"
              variant="secondary"
              className="min-h-11"
              onClick={() => void read({})}
            >
              Latest saved semesters
            </Button>
          )}
        </div>
      )}
    </section>
  );
}

export function SavedStudyPlanSemestersPanel(props: Props) {
  const ownerId = props.ownerId.toLowerCase();
  const planId = props.planId.toLowerCase();
  const expectedCurriculumId =
    typeof props.expectedCurriculumId === 'string'
      ? props.expectedCurriculumId.toLowerCase()
      : props.expectedCurriculumId;
  return (
    <SavedSemesterBody
      key={JSON.stringify([ownerId, planId, expectedCurriculumId])}
      {...props}
      ownerId={ownerId}
      planId={planId}
      expectedCurriculumId={expectedCurriculumId}
    />
  );
}
