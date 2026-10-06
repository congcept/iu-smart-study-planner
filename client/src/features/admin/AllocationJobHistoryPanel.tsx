import { isAxiosError } from 'axios';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AllocationJobHistorySchema,
  AllocationJobOutcomeSchema,
  ResourceScopeSchema,
  type AllocationJobHistoryDTO,
  type AllocationJobOutcomeDTO,
  type ResourceScopeDTO,
} from '@iu-study-planner/shared';
import { Button } from '@/components/ui';
import { getSession } from '@/lib/api';
import { getAllocationJobOutcome, listAllocationJobs } from '@/lib/allocationJobsApi';

type Props = { userId: string; scope: ResourceScopeDTO };
type PageRequest = { after?: string; boundary?: AllocationJobOutcomeDTO };
class AdminSessionChanged extends Error {}

function sameTerminal(left: AllocationJobOutcomeDTO, right: AllocationJobOutcomeDTO) {
  return (
    left.jobId === right.jobId &&
    left.queuedAt === right.queuedAt &&
    left.status === right.status &&
    left.runId === right.runId &&
    left.completedAt === right.completedAt &&
    left.failureCode === right.failureCode
  );
}

// Preserve sub-millisecond storage precision when checking the immutable paging boundary.
function precedesBoundary(job: AllocationJobOutcomeDTO, boundary: AllocationJobOutcomeDTO) {
  const time = Date.parse(job.queuedAt) - Date.parse(boundary.queuedAt);
  if (time !== 0) return time < 0;
  const left = /\.(\d+)Z$/.exec(job.queuedAt)?.[1] ?? '';
  const right = /\.(\d+)Z$/.exec(boundary.queuedAt)?.[1] ?? '';
  const precision = Math.max(left.length, right.length);
  const comparison = left.padEnd(precision, '0').localeCompare(right.padEnd(precision, '0'));
  return comparison < 0 || (comparison === 0 && job.jobId < boundary.jobId);
}

export function AllocationJobHistoryPanel({ userId, scope }: Props) {
  const owner = userId.toLowerCase();
  const normalizedScope = { ...scope, curriculumId: scope.curriculumId.toLowerCase() };
  const key = JSON.stringify([owner, normalizedScope.curriculumId, scope.semester, scope.year]);
  return <HistoryPanel key={key} userId={owner} scope={normalizedScope} />;
}

function HistoryPanel({ userId, scope }: Props) {
  const { curriculumId, semester, year } = scope;
  const generation = useRef(0);
  const busy = useRef(false);
  const pageRequest = useRef<PageRequest>({});
  // Keep only this page's verified terminal observations, never accumulate history.
  const terminalObservations = useRef(new Map<string, AllocationJobOutcomeDTO>());
  const [page, setPage] = useState<AllocationJobHistoryDTO | null>(null);
  const [selectedRow, setSelectedRow] = useState<AllocationJobOutcomeDTO | null>(null);
  const [detail, setDetail] = useState<AllocationJobOutcomeDTO | null>(null);
  const [pending, setPending] = useState<'page' | 'detail' | null>('page');
  const [pageError, setPageError] = useState('');
  const [detailError, setDetailError] = useState('');
  const requestedScope = useCallback(
    () => ResourceScopeSchema.parse({ curriculumId, semester, year }),
    [curriculumId, semester, year],
  );
  const matchesScope = useCallback(
    (received: ResourceScopeDTO) => {
      const requested = requestedScope();
      return (
        received.curriculumId === requested.curriculumId &&
        received.semester === requested.semester &&
        received.year === requested.year
      );
    },
    [requestedScope],
  );
  const verifySession = useCallback(async () => {
    const account = await getSession();
    if (!account || account.id.toLowerCase() !== userId || account.role !== 'ADMIN')
      throw new AdminSessionChanged();
  }, [userId]);
  const failureMessage = useCallback((failure: unknown, readingPage: boolean) => {
    if (
      failure instanceof AdminSessionChanged ||
      (isAxiosError(failure) && [401, 403].includes(failure.response?.status ?? 0))
    ) {
      setPage(null);
      setDetail(null);
      return 'Your admin session changed. Sign in as this administrator before retrying.';
    }
    return readingPage
      ? 'Could not verify this history page. Retry the same page or reload request history.'
      : 'Could not verify the selected outcome. Retry its read to check the original request.';
  }, []);

  const readPage = useCallback(
    async (request: PageRequest = {}) => {
      if (busy.current) return;
      busy.current = true;
      const token = ++generation.current;
      pageRequest.current = request;
      setPending('page');
      setPageError('');
      setDetailError('');
      setSelectedRow(null);
      setDetail(null);
      if (!request.after) setPage(null);
      try {
        await verifySession();
        if (token !== generation.current) return;
        const result = AllocationJobHistorySchema.parse(
          await listAllocationJobs({
            ...requestedScope(),
            ...(request.after ? { after: request.after } : {}),
          }),
        );
        if (token !== generation.current) return;
        const boundary = request.boundary;
        if (
          !matchesScope(result.scope) ||
          result.jobs.some((row) => {
            const known = terminalObservations.current.get(row.jobId);
            return known !== undefined && !sameTerminal(row, known);
          }) ||
          (request.after !== undefined &&
            (!boundary ||
              boundary.jobId !== request.after ||
              result.jobs.some(
                (row) => row.jobId === request.after || !precedesBoundary(row, boundary),
              )))
        )
          throw new Error('History page does not match its scenario or paging boundary');
        await verifySession();
        if (token !== generation.current) return;
        terminalObservations.current = new Map(
          result.jobs.filter((row) => row.status !== 'PENDING').map((row) => [row.jobId, row]),
        );
        setPage(result);
      } catch (failure) {
        if (token === generation.current) setPageError(failureMessage(failure, true));
      } finally {
        if (token === generation.current) {
          busy.current = false;
          setPending(null);
        }
      }
    },
    [failureMessage, matchesScope, requestedScope, verifySession],
  );
  useEffect(() => {
    const active = generation;
    const lock = busy;
    void readPage();
    return () => {
      active.current++;
      lock.current = false;
    };
  }, [readPage]);

  const readOutcome = useCallback(
    async (row: AllocationJobOutcomeDTO) => {
      const id = row.jobId;
      if (busy.current) return;
      busy.current = true;
      const token = ++generation.current;
      setPending('detail');
      setSelectedRow(row);
      setDetail(null);
      setDetailError('');
      try {
        await verifySession();
        if (token !== generation.current) return;
        const result = AllocationJobOutcomeSchema.parse(
          await getAllocationJobOutcome(id, requestedScope()),
        );
        if (token !== generation.current) return;
        const known = terminalObservations.current.get(id);
        if (
          result.jobId !== id ||
          !matchesScope(result.scope) ||
          result.queuedAt !== row.queuedAt ||
          (known !== undefined && !sameTerminal(result, known)) ||
          (row.status !== 'PENDING' &&
            (result.status !== row.status ||
              result.runId !== row.runId ||
              result.completedAt !== row.completedAt ||
              result.failureCode !== row.failureCode))
        )
          throw new Error('Outcome does not match the immutable selected request');
        await verifySession();
        if (token !== generation.current) return;
        if (result.status !== 'PENDING') terminalObservations.current.set(id, result);
        setSelectedRow(result);
        setPage((current) =>
          current
            ? {
                ...current,
                jobs: current.jobs.map((entry) => (entry.jobId === id ? result : entry)),
              }
            : current,
        );
        setDetail(result);
      } catch (failure) {
        if (token === generation.current) setDetailError(failureMessage(failure, false));
      } finally {
        if (token === generation.current) {
          busy.current = false;
          setPending(null);
        }
      }
    },
    [failureMessage, matchesScope, requestedScope, verifySession],
  );

  return (
    <section
      aria-label="Simulation request history"
      className="min-w-0 space-y-4 border-t border-gray-200 pt-6"
    >
      <div>
        <h3 className="text-lg font-semibold text-gray-900">Simulation request history</h3>
        <p className="mt-2 max-w-prose text-sm text-gray-600">
          Browse queued requests for {semester} {year}, newest queued first. Each page shows up to
          twenty requests. Loading older requests replaces this page; reload to see newer requests
          and refreshed outcomes. These reads never enqueue or execute a request.
        </p>
      </div>
      <Button
        variant="secondary"
        className="min-h-11"
        disabled={pending !== null}
        onClick={() => void readPage()}
      >
        Reload request history
      </Button>
      {pending === 'page' && (
        <p role="status" className="text-sm text-gray-600">
          Loading request history…
        </p>
      )}
      {pageError && (
        <div className="space-y-2">
          <p role="alert" className="max-w-prose text-sm text-red-700">
            {pageError}
          </p>
          <Button
            variant="secondary"
            className="min-h-11"
            disabled={pending !== null}
            onClick={() => void readPage(pageRequest.current)}
          >
            Retry history page
          </Button>
        </div>
      )}
      {page && (
        <div className="space-y-3">
          <p className="text-sm text-gray-600">
            {page.jobs.length} {page.jobs.length === 1 ? 'request' : 'requests'} on this page.
          </p>
          {page.jobs.length === 0 ? (
            <p className="text-sm text-gray-700">
              No queued simulation requests for this scenario.
            </p>
          ) : (
            <ul
              aria-label="Queued requests"
              className="divide-y divide-gray-200 border-y border-gray-200"
            >
              {page.jobs.map((row) => (
                <li
                  key={row.jobId}
                  className="flex min-w-0 flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0 space-y-1 text-sm">
                    <p className="font-medium text-gray-900">
                      Queued{' '}
                      <time dateTime={row.queuedAt}>{new Date(row.queuedAt).toLocaleString()}</time>
                    </p>
                    <p className="break-all text-gray-600">{row.jobId}</p>
                    <p className="text-gray-700">{statusLabel(row.status)}</p>
                  </div>
                  <Button
                    variant="secondary"
                    className="min-h-11 shrink-0 self-start sm:self-auto"
                    aria-label={`View request outcome ${row.jobId}, queued ${new Date(row.queuedAt).toLocaleString()}`}
                    aria-pressed={selectedRow?.jobId === row.jobId}
                    disabled={pending !== null}
                    onClick={() => void readOutcome(row)}
                  >
                    View request outcome
                  </Button>
                </li>
              ))}
            </ul>
          )}
          {page.nextAfter !== null && !pageError && (
            <Button
              variant="secondary"
              className="min-h-11"
              disabled={pending !== null}
              onClick={() =>
                void readPage({ after: page.nextAfter ?? undefined, boundary: page.jobs.at(-1) })
              }
            >
              Load older requests
            </Button>
          )}
          {page.jobs.length > 0 && page.nextAfter === null && (
            <p className="text-sm text-gray-600">No older requests.</p>
          )}
        </div>
      )}
      {pending === 'detail' && (
        <p role="status" className="text-sm text-gray-600">
          Loading selected outcome…
        </p>
      )}
      {detailError && selectedRow && (
        <div className="space-y-2">
          <p role="alert" className="max-w-prose text-sm text-red-700">
            {detailError}
          </p>
          <Button
            variant="secondary"
            className="min-h-11"
            disabled={pending !== null}
            onClick={() => void readOutcome(selectedRow)}
          >
            Retry selected outcome
          </Button>
        </div>
      )}
      {detail && <RequestOutcome outcome={detail} />}
    </section>
  );
}

function statusLabel(status: AllocationJobOutcomeDTO['status']) {
  return status === 'PENDING'
    ? 'Pending · no terminal outcome committed'
    : status === 'SUCCEEDED'
      ? 'Succeeded · aggregate capture saved'
      : 'Failed · no capture saved';
}

function RequestOutcome({ outcome }: { outcome: AllocationJobOutcomeDTO }) {
  return (
    <section
      aria-label="Selected request outcome"
      className="min-w-0 space-y-3 border-t border-gray-200 pt-4"
    >
      <h4 className="font-semibold text-gray-900">Selected request outcome</h4>
      <p className="break-all text-sm text-gray-700">{outcome.jobId}</p>
      <p role="status" className="max-w-prose text-sm text-gray-700">
        {outcome.status === 'PENDING'
          ? 'No terminal outcome is committed. Another execution may be in progress. Checking this outcome never starts work.'
          : outcome.status === 'SUCCEEDED'
            ? 'Simulation completed. Its aggregate capture is saved; student plans and progress are unchanged.'
            : outcome.failureCode === 'AUTHOR_UNAVAILABLE'
              ? 'This request could not run because its original administrator is no longer available. No capture was saved.'
              : 'This request could not run because the current scenario is unsupported. No capture was saved.'}
      </p>
      <dl className="space-y-2 text-sm text-gray-700">
        <div>
          <dt className="font-medium">Queued</dt>
          <dd>
            <time dateTime={outcome.queuedAt}>{new Date(outcome.queuedAt).toLocaleString()}</time>
          </dd>
        </div>
        {outcome.completedAt && (
          <div>
            <dt className="font-medium">Completed</dt>
            <dd>
              <time dateTime={outcome.completedAt}>
                {new Date(outcome.completedAt).toLocaleString()}
              </time>
            </dd>
          </div>
        )}
      </dl>
      {outcome.runId && (
        <p className="max-w-prose text-sm text-gray-700">
          Saved capture <span className="break-all">{outcome.runId}</span>. Use simulation run
          history below to inspect its historical aggregate result.
        </p>
      )}
    </section>
  );
}
