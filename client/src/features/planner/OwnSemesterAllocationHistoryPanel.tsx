import { useCallback, useEffect, useRef, useState } from 'react';
import { isAxiosError } from 'axios';
import {
  OwnSemesterAllocationHistorySchema,
  OwnSemesterAllocationRunV1Schema,
  type ListOwnSemesterAllocationRunsDTO,
  type OwnSemesterAllocationHistoryDTO,
  type OwnSemesterAllocationRunV1DTO,
} from '@iu-study-planner/shared';
import { Button } from '@/components/ui';
import {
  getOwnSemesterAllocationRun,
  listOwnSemesterAllocationRuns,
  OwnSemesterSessionChangedError,
} from '@/lib/ownSemesterAllocationApi';

type ReadRequest =
  | {
      kind: 'page';
      input: ListOwnSemesterAllocationRunsDTO;
      boundary?: OwnSemesterAllocationRunV1DTO;
    }
  | { kind: 'result'; expected: OwnSemesterAllocationRunV1DTO };
type State =
  | { status: 'loading' }
  | { status: 'error'; message: string; retry: boolean }
  | {
      status: 'ready';
      page: OwnSemesterAllocationHistoryDTO;
      selected?: OwnSemesterAllocationRunV1DTO;
    };

const reasons: Record<OwnSemesterAllocationRunV1DTO['result']['reason'], string> = {
  TARGET_REACHED: 'Credit target reached',
  NO_REMAINING_CHOICES: 'No eligible choices left',
  CREDIT_LIMIT: 'Not enough credits remaining',
  RESOURCE_UNKNOWN: 'Resource information unavailable',
  CAPACITY_EXHAUSTED: 'All eligible sections are full',
};
const semesters = { FALL: 'Fall', SPRING: 'Spring', SUMMER: 'Summer' };

function precedes(run: OwnSemesterAllocationRunV1DTO, boundary: OwnSemesterAllocationRunV1DTO) {
  const time = Date.parse(run.createdAt) - Date.parse(boundary.createdAt);
  if (time !== 0) return time < 0;
  const left = /\.(\d+)Z$/.exec(run.createdAt)?.[1] ?? '';
  const right = /\.(\d+)Z$/.exec(boundary.createdAt)?.[1] ?? '';
  const precision = Math.max(left.length, right.length);
  const order = left.padEnd(precision, '0').localeCompare(right.padEnd(precision, '0'));
  return order < 0 || (order === 0 && run.id < boundary.id);
}

function savedTime(run: OwnSemesterAllocationRunV1DTO) {
  return new Date(run.createdAt).toLocaleString();
}

function OwnHistoryBody({ ownerId }: { ownerId: string }) {
  const [state, setState] = useState<State>({ status: 'loading' });
  const resultHeading = useRef<HTMLHeadingElement>(null);
  const generation = useRef(0);
  const mounted = useRef(false);
  const busy = useRef(false);
  const confirmedPage = useRef<OwnSemesterAllocationHistoryDTO | null>(null);
  const lastRequest = useRef<ReadRequest>({ kind: 'page', input: {} });

  const read = useCallback(
    async (request: ReadRequest) => {
      if (!mounted.current || busy.current) return;
      busy.current = true;
      const current = ++generation.current;
      lastRequest.current = request;
      // Previous private evidence remains only in refs until this read is confirmed.
      setState({ status: 'loading' });
      const isCurrent = () => mounted.current && generation.current === current;
      try {
        if (request.kind === 'page') {
          const after = request.input.after;
          const boundary =
            request.boundary && OwnSemesterAllocationRunV1Schema.parse(request.boundary);
          const received = await listOwnSemesterAllocationRuns(
            ownerId,
            { ...request.input },
            boundary && OwnSemesterAllocationRunV1Schema.parse(boundary),
          );
          if (!isCurrent()) return;
          const page = OwnSemesterAllocationHistorySchema.parse(received);
          if (
            page.after !== (after ?? null) ||
            (boundary && page.runs.some((run) => !precedes(run, boundary)))
          )
            throw new Error('History does not match its requested boundary');
          confirmedPage.current = page;
          setState({ status: 'ready', page });
        } else {
          const expected = request.expected;
          const immutable = JSON.stringify(expected);
          const received = await getOwnSemesterAllocationRun(
            ownerId,
            expected.id,
            OwnSemesterAllocationRunV1Schema.parse(expected),
          );
          if (!isCurrent()) return;
          const selected = OwnSemesterAllocationRunV1Schema.parse(received);
          const page = confirmedPage.current;
          if (!page || JSON.stringify(selected) !== immutable)
            throw new Error('Result does not match its selected immutable receipt');
          setState({ status: 'ready', page, selected });
        }
      } catch (error) {
        if (!isCurrent()) return;
        const status = isAxiosError(error) ? error.response?.status : undefined;
        const account =
          error instanceof OwnSemesterSessionChangedError || status === 401 || status === 403;
        const unavailable = request.kind === 'result' && status === 404;
        const cursor = request.kind === 'page' && status === 409;
        setState({
          status: 'error',
          message: account
            ? 'Sign in as this account to read your saved simulations.'
            : unavailable
              ? 'This saved result is no longer available. Reload simulation history.'
              : cursor
                ? 'This history page is no longer available. Reload simulation history.'
                : request.kind === 'page'
                  ? 'Could not confirm your saved simulation history. Retry this read or reload the latest results.'
                  : 'Could not confirm your selected simulation result. Retry this read or reload the latest results.',
          retry: !account && !unavailable && !cursor,
        });
      } finally {
        if (isCurrent()) busy.current = false;
      }
    },
    [ownerId],
  );

  const invalidate = useCallback(() => {
    mounted.current = false;
    generation.current++;
    busy.current = false;
  }, []);

  useEffect(() => {
    mounted.current = true;
    busy.current = false;
    void read({ kind: 'page', input: {} });
    return invalidate;
  }, [read, invalidate]);

  useEffect(() => {
    if (state.status === 'ready' && state.selected) resultHeading.current?.focus();
  }, [state]);

  const pending = state.status === 'loading';
  return (
    <section
      aria-label="Your saved semester simulations"
      className="rounded-xl border border-gray-200 bg-white p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="text-lg font-semibold text-gray-900">Your saved semester simulations</h3>
          <p className="mt-2 max-w-prose text-sm text-gray-700">
            Review your own saved outcomes. Credit targets are simulation budgets. These results do
            not validate registration, prerequisites or a timetable, and do not change your course
            selections.
          </p>
        </div>
        <Button
          type="button"
          variant="secondary"
          className="min-h-11"
          disabled={pending}
          onClick={() => void read({ kind: 'page', input: {} })}
        >
          Reload simulation history
        </Button>
      </div>
      {pending && (
        <p role="status" className="mt-4 text-sm text-gray-600">
          Loading your saved semester simulations…
        </p>
      )}
      {state.status === 'error' && (
        <div className="mt-4">
          <p role="alert" className="max-w-prose text-sm text-red-700">
            {state.message}
          </p>
          {state.retry && (
            <Button
              type="button"
              variant="secondary"
              className="mt-3 min-h-11"
              onClick={() => void read(lastRequest.current)}
            >
              {lastRequest.current.kind === 'page' ? 'Retry history read' : 'Retry result read'}
            </Button>
          )}
        </div>
      )}
      {state.status === 'ready' && (
        <div className="mt-4 space-y-4">
          <p role="status" className="sr-only">
            {state.selected
              ? 'Selected simulation result loaded.'
              : `Showing ${state.page.runs.length} saved simulation results.`}
          </p>
          {state.page.runs.length === 0 ? (
            <p className="text-sm text-gray-700">
              {state.page.after
                ? 'No older saved semester simulations are available.'
                : 'No saved semester simulations for your account yet.'}
            </p>
          ) : (
            <ul className="divide-y divide-gray-200">
              {state.page.runs.map((run, index) => (
                <li key={run.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div className="min-w-0 text-sm text-gray-700">
                    <p className="font-semibold text-gray-900">
                      {semesters[run.scope.semester]} {run.scope.year} ·{' '}
                      {run.result.assignedCredits} of {run.result.targetCredits} credits assigned
                    </p>
                    <p className="mt-1">
                      Saved <time dateTime={run.createdAt}>{savedTime(run)}</time>
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="secondary"
                    className="min-h-11"
                    onClick={() =>
                      void read({
                        kind: 'result',
                        expected: OwnSemesterAllocationRunV1Schema.parse(run),
                      })
                    }
                  >
                    View result {index + 1}
                  </Button>
                </li>
              ))}
            </ul>
          )}
          {state.page.nextAfter && (
            <Button
              type="button"
              variant="secondary"
              className="min-h-11"
              onClick={() => {
                const boundary = OwnSemesterAllocationRunV1Schema.parse(state.page.runs.at(-1));
                void read({ kind: 'page', input: { after: state.page.nextAfter! }, boundary });
              }}
            >
              Older results
            </Button>
          )}
          {state.selected && (
            <section aria-label="Your simulation result" className="border-t border-gray-200 pt-4">
              <h4
                ref={resultHeading}
                tabIndex={-1}
                className="text-base font-semibold text-gray-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-700"
              >
                Your simulation result
              </h4>
              <p className="mt-2 text-sm text-gray-700">
                {semesters[state.selected.scope.semester]} {state.selected.scope.year} ·{' '}
                {reasons[state.selected.result.reason]}
              </p>
              <dl className="mt-3 grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
                <div>
                  <dt className="text-gray-600">Target credits</dt>
                  <dd className="font-semibold text-gray-900">
                    {state.selected.result.targetCredits}
                  </dd>
                </div>
                <div>
                  <dt className="text-gray-600">Assigned credits</dt>
                  <dd className="font-semibold text-gray-900">
                    {state.selected.result.assignedCredits}
                  </dd>
                </div>
                <div>
                  <dt className="text-gray-600">Remaining credits</dt>
                  <dd className="font-semibold text-gray-900">
                    {state.selected.result.remainingCredits}
                  </dd>
                </div>
              </dl>
              <p className="mt-4 max-w-prose text-sm text-gray-600">
                Course names were not captured in this saved version. The identifiers and credits
                below are the values stored with your result.
              </p>
              {state.selected.courses.length === 0 ? (
                <p className="mt-2 text-sm text-gray-700">No courses were assigned.</p>
              ) : (
                <ul className="mt-2 space-y-2 text-sm text-gray-700">
                  {state.selected.courses.map((course) => (
                    <li key={course.courseId} className="break-all">
                      {course.courseId} · {course.credits} credits
                    </li>
                  ))}
                </ul>
              )}
              <dl className="mt-4 space-y-2 text-sm text-gray-600">
                <div>
                  <dt>Saved result identifier</dt>
                  <dd className="break-all">{state.selected.id}</dd>
                </div>
                <div>
                  <dt>Curriculum identifier at capture</dt>
                  <dd className="break-all">{state.selected.scope.curriculumId}</dd>
                </div>
                <div>
                  <dt>Source captured</dt>
                  <dd>
                    <time dateTime={state.selected.capturedAt}>
                      {new Date(state.selected.capturedAt).toLocaleString()}
                    </time>
                  </dd>
                </div>
              </dl>
            </section>
          )}
        </div>
      )}
    </section>
  );
}

export function OwnSemesterAllocationHistoryPanel({
  ownerId,
  blocked = false,
}: {
  ownerId: string;
  blocked?: boolean;
}) {
  if (blocked)
    return (
      <section
        aria-label="Your saved semester simulations"
        className="rounded-xl border border-gray-200 bg-white p-5"
      >
        <h3 className="text-lg font-semibold text-gray-900">Your saved semester simulations</h3>
        <p role="alert" className="mt-3 text-sm text-red-700">
          Sign in as this account to read your saved simulations.
        </p>
      </section>
    );
  const owner = ownerId.toLowerCase();
  return <OwnHistoryBody key={owner} ownerId={owner} />;
}
