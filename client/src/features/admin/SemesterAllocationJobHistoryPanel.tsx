import { isAxiosError } from 'axios';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ListSemesterAllocationJobsSchema,
  SemesterAllocationJobHistorySchema,
  SemesterAllocationJobSchema,
  SemesterAllocationJobOutcomeSchema,
  type ListSemesterAllocationJobsDTO,
  type ResourceScopeDTO,
  type SemesterAllocationJobDTO,
  type SemesterAllocationJobHistoryDTO,
  type SemesterAllocationJobOutcomeDTO,
} from '@iu-study-planner/shared';
import { Button, EmptyState, ErrorBanner, MetricList, StatusPill } from '@/components/ui';
import {
  SemesterJobSessionChangedError,
  getSemesterAllocationJob,
  getSemesterAllocationJobOutcome,
  listSemesterAllocationJobs,
} from '@/lib/semesterAllocationJobsApi';

type Props = { userId: string; scope: ResourceScopeDTO };
type PageRequest = { input: ListSemesterAllocationJobsDTO; boundary?: SemesterAllocationJobDTO };
type Selected = { job: SemesterAllocationJobDTO; outcome: SemesterAllocationJobOutcomeDTO };
class StaleRead extends Error {}

function beforeBoundary(job: SemesterAllocationJobDTO, boundary: SemesterAllocationJobDTO) {
  const time = Date.parse(job.queuedAt) - Date.parse(boundary.queuedAt);
  if (time !== 0) return time < 0;
  const left = /\.(\d+)Z$/.exec(job.queuedAt)?.[1] ?? '';
  const right = /\.(\d+)Z$/.exec(boundary.queuedAt)?.[1] ?? '';
  const precision = Math.max(left.length, right.length);
  const comparison = left.padEnd(precision, '0').localeCompare(right.padEnd(precision, '0'));
  return comparison < 0 || (comparison === 0 && job.id < boundary.id);
}

export function SemesterAllocationJobHistoryPanel({ userId, scope }: Props) {
  const owner = userId.toLowerCase();
  const normalized = { ...scope, curriculumId: scope.curriculumId.toLowerCase() };
  const key = JSON.stringify([owner, normalized.curriculumId, scope.semester, scope.year]);
  return <HistoryPanel key={key} userId={owner} scope={normalized} />;
}

function HistoryPanel({ userId, scope }: Props) {
  const { curriculumId, semester, year } = scope;
  const mounted = useRef(false);
  const generation = useRef(0);
  const busy = useRef(false);
  const confirmedPage = useRef<SemesterAllocationJobHistoryDTO | null>(null);
  const lastPageRequest = useRef<PageRequest | null>(null);
  const selectedRequest = useRef<Selected | null>(null);
  // Observations are bounded to requests on the last confirmed page.
  const terminalObservations = useRef(new Map<string, SemesterAllocationJobOutcomeDTO>());
  const focusSelected = useRef(false);
  const [page, setPage] = useState<SemesterAllocationJobHistoryDTO | null>(null);
  const [selected, setSelected] = useState<Selected | null>(null);
  const [pending, setPending] = useState<'page' | 'detail' | null>('page');
  const [failure, setFailure] = useState<{ kind: 'page' | 'detail'; message: string } | null>(null);
  const intent = generation.current;
  const requestedScope = useCallback(
    () => SemesterAllocationJobSchema.shape.scope.parse({ curriculumId, semester, year }),
    [curriculumId, semester, year],
  );
  const sameScope = useCallback(
    (received: ResourceScopeDTO) => {
      const expected = requestedScope();
      return (
        received.curriculumId === expected.curriculumId &&
        received.semester === expected.semester &&
        received.year === expected.year
      );
    },
    [requestedScope],
  );
  const active = useCallback((token: number) => {
    if (!mounted.current || !busy.current || generation.current !== token) throw new StaleRead();
  }, []);
  const begin = useCallback((expectedIntent: number, kind: 'page' | 'detail') => {
    if (!mounted.current || busy.current || generation.current !== expectedIntent) return null;
    busy.current = true;
    setPage(null);
    setSelected(null);
    setFailure(null);
    setPending(kind);
    focusSelected.current = false;
    return ++generation.current;
  }, []);
  const finish = useCallback((token: number) => {
    if (!mounted.current || generation.current !== token) return;
    busy.current = false;
    setPending(null);
  }, []);
  const report = useCallback((error: unknown, kind: 'page' | 'detail') => {
    const status = isAxiosError(error) ? error.response?.status : undefined;
    setFailure({
      kind,
      message:
        error instanceof SemesterJobSessionChangedError || status === 401 || status === 403
          ? 'Your admin session changed. Sign in as this administrator before reading request history.'
          : kind === 'page' && status === 409
            ? 'This history continuation is unavailable. Reload semester request history to start from the latest requests.'
            : kind === 'detail' && status === 404
              ? 'The selected semester request is unavailable. Reload semester request history to check available requests.'
              : kind === 'page'
                ? 'Could not verify this history page. Retry the same page or reload semester request history.'
                : 'Could not verify the selected outcome. Retry its read to check the original semester request.',
    });
  }, []);
  const readPage = useCallback(
    async (request: PageRequest, expectedIntent: number) => {
      const token = begin(expectedIntent, 'page');
      if (token === null) return;
      try {
        SemesterAllocationJobSchema.shape.id.parse(userId);
        const input = ListSemesterAllocationJobsSchema.parse(request.input);
        const boundary =
          request.boundary === undefined
            ? undefined
            : SemesterAllocationJobSchema.parse(request.boundary);
        if (
          !sameScope(input) ||
          (input.after !== undefined &&
            (!boundary || boundary.id !== input.after || !sameScope(boundary.scope))) ||
          (input.after === undefined && boundary !== undefined)
        )
          throw new Error('History request does not match its original page boundary');
        lastPageRequest.current = { input, ...(boundary ? { boundary } : {}) };
        selectedRequest.current = null;
        const received = await listSemesterAllocationJobs(
          userId,
          ListSemesterAllocationJobsSchema.parse(input),
          boundary === undefined ? undefined : SemesterAllocationJobSchema.parse(boundary),
        );
        active(token);
        const result = SemesterAllocationJobHistorySchema.parse(received);
        if (
          !sameScope(result.scope) ||
          result.after !== (input.after ?? null) ||
          result.requests.some(({ job, outcome }) => {
            const terminal = terminalObservations.current.get(job.id);
            return (
              (boundary !== undefined && !beforeBoundary(job, boundary)) ||
              (terminal !== undefined && JSON.stringify(terminal) !== JSON.stringify(outcome))
            );
          })
        )
          throw new Error(
            'History reply does not match its scenario, boundary or terminal observations',
          );
        confirmedPage.current = result;
        terminalObservations.current = new Map(
          result.requests
            .filter(({ outcome }) => outcome.status !== 'PENDING')
            .map(({ job, outcome }) => [job.id, outcome]),
        );
        setPage(result);
      } catch (error) {
        if (mounted.current && generation.current === token) report(error, 'page');
      } finally {
        finish(token);
      }
    },
    [active, begin, finish, report, sameScope, userId],
  );
  useEffect(() => {
    const activeMounted = mounted;
    const activeGeneration = generation;
    const lock = busy;
    mounted.current = true;
    void readPage({ input: { curriculumId, semester, year } }, generation.current);
    return () => {
      activeMounted.current = false;
      activeGeneration.current++;
      lock.current = false;
    };
  }, [curriculumId, readPage, semester, year]);

  const readSelected = useCallback(
    async (request: Selected, expectedIntent: number) => {
      const token = begin(expectedIntent, 'detail');
      if (token === null) return;
      try {
        SemesterAllocationJobSchema.shape.id.parse(userId);
        const job = SemesterAllocationJobSchema.parse(request.job);
        const supplied = SemesterAllocationJobOutcomeSchema.parse(request.outcome);
        const prior = terminalObservations.current.get(job.id) ?? supplied;
        if (
          !sameScope(job.scope) ||
          prior.jobId !== job.id ||
          prior.queuedAt !== job.queuedAt ||
          JSON.stringify(prior.scope) !== JSON.stringify(job.scope)
        )
          throw new Error('Selected history request does not match its receipt');
        selectedRequest.current = { job, outcome: SemesterAllocationJobOutcomeSchema.parse(prior) };
        const receivedJob = await getSemesterAllocationJob(
          userId,
          SemesterAllocationJobSchema.parse(job),
        );
        active(token);
        const actual = SemesterAllocationJobSchema.parse(receivedJob);
        if (JSON.stringify(actual) !== JSON.stringify(job))
          throw new Error('The selected queued receipt changed');
        const received = await getSemesterAllocationJobOutcome(
          userId,
          SemesterAllocationJobSchema.parse(job),
          SemesterAllocationJobOutcomeSchema.parse(prior),
        );
        active(token);
        const outcome = SemesterAllocationJobOutcomeSchema.parse(received);
        if (
          outcome.jobId !== job.id ||
          outcome.queuedAt !== job.queuedAt ||
          outcome.model !== job.model ||
          JSON.stringify(outcome.scope) !== JSON.stringify(job.scope) ||
          (prior.status !== 'PENDING' && JSON.stringify(outcome) !== JSON.stringify(prior))
        )
          throw new Error('The selected request outcome changed its immutable terminal result');
        if (outcome.status !== 'PENDING') terminalObservations.current.set(job.id, outcome);
        const detail = { job, outcome };
        // Exact confirmation can advance a pending row to its terminal outcome. Keep the
        // restored page consistent with that result without rereading unrelated rows.
        const previousPage = confirmedPage.current;
        const updatedPage = previousPage
          ? SemesterAllocationJobHistorySchema.parse({
              ...previousPage,
              requests: previousPage.requests.map((entry) =>
                entry.job.id === job.id ? detail : entry,
              ),
            })
          : null;
        confirmedPage.current = updatedPage;
        selectedRequest.current = detail;
        focusSelected.current = true;
        setPage(updatedPage);
        setSelected(detail);
      } catch (error) {
        if (mounted.current && generation.current === token) report(error, 'detail');
      } finally {
        finish(token);
      }
    },
    [active, begin, finish, report, sameScope, userId],
  );
  const focusHeading = useCallback((heading: HTMLHeadingElement | null) => {
    if (heading && focusSelected.current) {
      focusSelected.current = false;
      heading.focus();
    }
  }, []);
  return (
    <section
      aria-label="Semester request history"
      className="min-w-0 space-y-4 border-t border-gray-200 pt-6"
    >
      <div>
        <h3 className="text-lg font-semibold text-gray-900">Semester request history</h3>
        <p className="mt-2 max-w-prose text-sm text-gray-600">
          Browse up to five requests for {semester} {year}, newest queued first. History reflects
          its last check. Check a request for its latest outcome.
        </p>
      </div>
      <Button
        variant="secondary"
        className="min-h-11"
        disabled={pending !== null}
        onClick={() => void readPage({ input: requestedScope() }, intent)}
      >
        Reload semester request history
      </Button>
      {pending && (
        <p role="status" className="text-sm text-gray-600">
          {pending === 'page'
            ? 'Loading semester request history…'
            : 'Checking selected semester outcome…'}
        </p>
      )}
      {failure && (
        <div className="space-y-2">
          <ErrorBanner className="max-w-prose text-sm text-red-700">{failure.message}</ErrorBanner>
          {failure.kind === 'page' && lastPageRequest.current && (
            <Button
              variant="secondary"
              className="min-h-11"
              disabled={pending !== null}
              onClick={() =>
                lastPageRequest.current && void readPage(lastPageRequest.current, intent)
              }
            >
              Retry semester history page
            </Button>
          )}
          {failure.kind === 'detail' && selectedRequest.current && (
            <Button
              variant="secondary"
              className="min-h-11"
              disabled={pending !== null}
              onClick={() =>
                selectedRequest.current && void readSelected(selectedRequest.current, intent)
              }
            >
              Retry selected semester outcome
            </Button>
          )}
        </div>
      )}
      {page && (
        <div className="space-y-3">
          {page.requests.length === 0 ? (
            <EmptyState>
              {page.after === null
                ? 'No semester requests have been queued for this scenario.'
                : 'No older semester requests.'}
            </EmptyState>
          ) : (
            <ul
              aria-label="Semester requests on this page"
              className="divide-y divide-gray-200 border-y border-gray-200"
            >
              {page.requests.map((entry) => (
                <li
                  key={entry.job.id}
                  className="flex min-w-0 flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0 space-y-1 text-sm">
                    <p className="font-medium text-gray-900">
                      Queued{' '}
                      <time dateTime={entry.job.queuedAt}>
                        {new Date(entry.job.queuedAt).toLocaleString()}
                      </time>
                    </p>
                    <p className="break-words text-gray-600 [overflow-wrap:anywhere]">
                      {entry.job.id}
                    </p>
                    <p className="text-gray-700">
                      {entry.outcome.status === 'PENDING'
                        ? 'Pending · no terminal outcome committed'
                        : entry.outcome.status === 'SUCCEEDED'
                          ? 'Completed · student results saved'
                          : 'Failed · no result saved'}
                    </p>
                    <StatusPill status={entry.outcome.status} />
                  </div>
                  <Button
                    variant="secondary"
                    className="min-h-11 shrink-0 self-start sm:self-auto"
                    aria-label={`Check semester request outcome ${entry.job.id}`}
                    aria-pressed={selected?.job.id === entry.job.id}
                    disabled={pending !== null}
                    onClick={() => void readSelected(entry, intent)}
                  >
                    Check request outcome
                  </Button>
                </li>
              ))}
            </ul>
          )}
          {page.nextAfter !== null && (
            <Button
              variant="secondary"
              className="min-h-11"
              disabled={pending !== null}
              onClick={() =>
                void readPage(
                  {
                    input: { ...requestedScope(), after: page.nextAfter ?? undefined },
                    boundary: page.requests.at(-1)?.job,
                  },
                  intent,
                )
              }
            >
              Load older semester requests
            </Button>
          )}
          {page.requests.length > 0 && page.nextAfter === null && (
            <p className="text-sm text-gray-600">No older semester requests.</p>
          )}
        </div>
      )}
      {selected && (
        <section
          aria-label="Selected semester request outcome"
          className="min-w-0 space-y-3 border-t border-gray-200 pt-4"
        >
          <h4
            ref={focusHeading}
            tabIndex={-1}
            className="font-semibold text-gray-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-700"
          >
            Selected semester request outcome
          </h4>
          <StatusPill status={selected.outcome.status} />
          <p className="break-words text-sm text-gray-700 [overflow-wrap:anywhere]">
            {selected.job.id}
          </p>
          <p role="status" className="max-w-prose text-sm text-gray-700">
            {selected.outcome.status === 'PENDING'
              ? 'No terminal outcome is committed. Another execution may be in progress. Checking this outcome never starts work.'
              : selected.outcome.status === 'SUCCEEDED'
                ? 'Semester simulation completed. Student results are saved.'
                : selected.outcome.failureCode === 'AUTHOR_UNAVAILABLE'
                  ? 'The original administrator was unavailable when execution was attempted. No result was saved.'
                  : 'The simulation preview could not be produced when execution was attempted. No result was saved.'}
          </p>
          <MetricList
            items={[
              {
                key: 'scenario',
                label: 'Scenario',
                value: (
                  <>
                    {selected.job.scope.semester} {selected.job.scope.year} · curriculum{' '}
                    <span className="break-words [overflow-wrap:anywhere]">
                      {selected.job.scope.curriculumId}
                    </span>
                  </>
                ),
              },
              {
                key: 'queued',
                label: 'Queued',
                value: (
                  <time dateTime={selected.job.queuedAt}>
                    {new Date(selected.job.queuedAt).toLocaleString()}
                  </time>
                ),
              },
              ...(selected.outcome.completedAt
                ? [
                    {
                      key: 'completed',
                      label: 'Completed',
                      value: (
                        <time dateTime={selected.outcome.completedAt}>
                          {new Date(selected.outcome.completedAt).toLocaleString()}
                        </time>
                      ),
                    },
                  ]
                : []),
            ]}
          />
          {selected.outcome.runId && (
            <p className="max-w-prose text-sm text-gray-700">
              Saved semester result{' '}
              <span className="break-words [overflow-wrap:anywhere]">{selected.outcome.runId}</span>
              . Participating students can review their own result in Planner.
            </p>
          )}
        </section>
      )}
      <p className="max-w-prose text-sm text-gray-600">
        Simulation only. These checks never queue or execute requests. Academic records remain
        unchanged.
      </p>
    </section>
  );
}
