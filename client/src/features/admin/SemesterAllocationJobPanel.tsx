import { isAxiosError } from 'axios';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  CreateSemesterAllocationJobSchema,
  SemesterAllocationJobSchema,
  SemesterAllocationJobOutcomeSchema,
  SemesterAllocationJobExecutionSchema,
  type ResourceScopeDTO,
  type SemesterAllocationJobDTO,
  type SemesterAllocationJobOutcomeDTO,
} from '@iu-study-planner/shared';
import { Button } from '@/components/ui';
import {
  SemesterJobSessionChangedError,
  enqueueSemesterAllocationJob,
  executeSemesterAllocationJob,
  getSemesterAllocationJob,
  getSemesterAllocationJobOutcome,
} from '@/lib/semesterAllocationJobsApi';
import {
  SemesterAllocationJobRecoveryError,
  confirmSemesterAllocationJobJournal,
  readSemesterAllocationJobJournal,
  writeSemesterAllocationJobJournal,
  type SemesterAllocationJobJournal,
} from './semesterAllocationJobRecovery';

type Props = { userId: string; scope: ResourceScopeDTO };
type Operation = 'queue' | 'read' | 'execute';
type Confirmed = {
  job: SemesterAllocationJobDTO;
  outcome: SemesterAllocationJobOutcomeDTO;
  processed?: boolean;
};
class StaleOperation extends Error {}
const scopeSchema = SemesterAllocationJobSchema.shape.scope;

export function SemesterAllocationJobPanel({ userId, scope }: Props) {
  const owner = userId.toLowerCase();
  const key = JSON.stringify([owner, scope.curriculumId.toLowerCase(), scope.semester, scope.year]);
  return (
    <JobPanel
      key={key}
      userId={owner}
      scope={{ ...scope, curriculumId: scope.curriculumId.toLowerCase() }}
    />
  );
}

function JobPanel({ userId, scope }: Props) {
  const { curriculumId, semester, year } = scope;
  const generation = useRef(0);
  const mounted = useRef(false);
  const busy = useRef(false);
  const journalRef = useRef<SemesterAllocationJobJournal | null>(null);
  const priorOutcome = useRef<SemesterAllocationJobOutcomeDTO | undefined>();
  const [journal, setJournal] = useState<SemesterAllocationJobJournal | null>(null);
  const [confirmed, setConfirmed] = useState<Confirmed | null>(null);
  const [loading, setLoading] = useState(true);
  const [blocked, setBlocked] = useState(false);
  const [error, setError] = useState('');
  const rendered = useRef({ confirmed, blocked });
  rendered.current = { confirmed, blocked };
  const requestedScope = useCallback(
    () => scopeSchema.parse({ curriculumId, semester, year }),
    [curriculumId, semester, year],
  );
  const active = useCallback((token: number) => {
    if (!mounted.current || !busy.current || generation.current !== token)
      throw new StaleOperation();
  }, []);
  const begin = useCallback(() => {
    if (!mounted.current || busy.current) return null;
    busy.current = true;
    setLoading(true);
    setConfirmed(null);
    setError('');
    return ++generation.current;
  }, []);
  const finish = useCallback((token: number) => {
    if (!mounted.current || generation.current !== token) return;
    busy.current = false;
    setLoading(false);
  }, []);
  const checkedReceipt = useCallback(
    (input: unknown, expected?: SemesterAllocationJobDTO) => {
      const receipt = SemesterAllocationJobSchema.parse(input);
      const requested = requestedScope();
      if (
        receipt.scope.curriculumId !== requested.curriculumId ||
        receipt.scope.semester !== requested.semester ||
        receipt.scope.year !== requested.year ||
        (expected !== undefined && JSON.stringify(receipt) !== JSON.stringify(expected))
      )
        throw new Error(
          'Semester receipt does not match the selected scenario or immutable request',
        );
      return receipt;
    },
    [requestedScope],
  );
  const checkedOutcome = useCallback((input: unknown, receipt: SemesterAllocationJobDTO) => {
    const outcome = SemesterAllocationJobOutcomeSchema.parse(input);
    const previous = priorOutcome.current;
    if (
      outcome.jobId !== receipt.id ||
      outcome.model !== receipt.model ||
      outcome.queuedAt !== receipt.queuedAt ||
      JSON.stringify(outcome.scope) !== JSON.stringify(receipt.scope) ||
      (previous &&
        previous.jobId === receipt.id &&
        previous.status !== 'PENDING' &&
        JSON.stringify(outcome) !== JSON.stringify(previous))
    )
      throw new Error('Semester outcome does not match its immutable receipt or terminal result');
    return outcome;
  }, []);
  const failed = useCallback((failure: unknown, operation: Operation) => {
    setConfirmed(null);
    if (failure instanceof SemesterAllocationJobRecoveryError) {
      setBlocked(true);
      setError(
        'This tab’s semester request recovery cannot be verified. Restore session storage and retry recovery before sending a request.',
      );
    } else if (
      failure instanceof SemesterJobSessionChangedError ||
      (isAxiosError(failure) && [401, 403].includes(failure.response?.status ?? 0))
    ) {
      setError(
        'Your admin session changed. Sign in as this administrator before recovering the semester request.',
      );
    } else {
      setError(
        operation === 'queue' && journalRef.current === null
          ? 'Could not start the semester request. No enqueue request was sent. Restore your admin session or connection and try again.'
          : operation === 'queue' && journalRef.current?.job === null
            ? 'Could not confirm the queued semester request. Retry uses the original request key; no replacement request is sent automatically.'
            : operation === 'execute'
              ? 'Could not confirm execution. Check the original semester request outcome before explicitly retrying the same job.'
              : 'Could not verify the semester request and its outcome. Retry recovery to check the original job.',
      );
    }
  }, []);
  const readConfirmed = useCallback(
    async (expected: SemesterAllocationJobJournal, token: number) => {
      if (expected.job === null) throw new SemesterAllocationJobRecoveryError();
      const receipt = checkedReceipt(expected.job);
      const received = await getSemesterAllocationJob(
        userId,
        SemesterAllocationJobSchema.parse(receipt),
      );
      active(token);
      const job = checkedReceipt(received, receipt);
      const previous =
        priorOutcome.current?.jobId === job.id
          ? SemesterAllocationJobOutcomeSchema.parse(priorOutcome.current)
          : undefined;
      const value = await getSemesterAllocationJobOutcome(
        userId,
        SemesterAllocationJobSchema.parse(job),
        previous,
      );
      active(token);
      const outcome = checkedOutcome(value, job);
      const saved = confirmSemesterAllocationJobJournal(expected, userId, requestedScope());
      if (saved?.job === null || saved === null) throw new SemesterAllocationJobRecoveryError();
      journalRef.current = saved;
      setJournal(saved);
      priorOutcome.current = outcome;
      return { job, outcome };
    },
    [active, checkedOutcome, checkedReceipt, requestedScope, userId],
  );
  const recover = useCallback(async () => {
    const token = begin();
    if (token === null) return;
    setBlocked(false);
    try {
      const previous = journalRef.current;
      const saved = readSemesterAllocationJobJournal(userId, requestedScope());
      if (
        previous &&
        (saved === null ||
          JSON.stringify(saved.request) !== JSON.stringify(previous.request) ||
          (previous.job !== null && JSON.stringify(saved.job) !== JSON.stringify(previous.job)))
      )
        throw new SemesterAllocationJobRecoveryError();
      journalRef.current = saved;
      setJournal(saved);
      if (saved?.job) {
        const result = await readConfirmed(saved, token);
        active(token);
        setConfirmed(result);
      }
    } catch (failure) {
      if (mounted.current && generation.current === token) failed(failure, 'read');
    } finally {
      finish(token);
    }
  }, [active, begin, failed, finish, readConfirmed, requestedScope, userId]);
  useEffect(() => {
    const activeGeneration = generation;
    const activeMounted = mounted;
    const activeBusy = busy;
    mounted.current = true;
    void recover();
    return () => {
      activeMounted.current = false;
      activeGeneration.current++;
      activeBusy.current = false;
    };
  }, [recover]);

  const queue = useCallback(async () => {
    if (rendered.current.confirmed !== confirmed || rendered.current.blocked !== blocked) return;
    if (
      blocked ||
      (journalRef.current?.job &&
        confirmed?.outcome.status !== 'SUCCEEDED' &&
        confirmed?.outcome.status !== 'FAILED')
    )
      return;
    const token = begin();
    if (token === null) return;
    try {
      const previous = journalRef.current;
      if (previous?.job) {
        const latest = await readConfirmed(previous, token);
        active(token);
        if (latest.outcome.status === 'PENDING') throw new Error('Request is not terminal');
      }
      const next: SemesterAllocationJobJournal =
        previous?.job === null
          ? previous
          : {
              version: 1,
              ownerId: userId,
              request: CreateSemesterAllocationJobSchema.parse({
                ...requestedScope(),
                expectedActorId: userId,
                requestId: crypto.randomUUID(),
              }),
              job: null,
            };
      const sent: { journal: SemesterAllocationJobJournal | null } = { journal: null };
      const received = await enqueueSemesterAllocationJob(
        CreateSemesterAllocationJobSchema.parse(next.request),
        () => {
          active(token);
          const durable = writeSemesterAllocationJobJournal(next, previous);
          sent.journal = durable;
          journalRef.current = durable;
          setJournal(durable);
          if (previous?.request.requestId !== durable.request.requestId)
            priorOutcome.current = undefined;
          return undefined;
        },
      );
      active(token);
      const receipt = checkedReceipt(received);
      const pending = sent.journal;
      if (pending === null) throw new SemesterAllocationJobRecoveryError();
      const saved = writeSemesterAllocationJobJournal({ ...pending, job: receipt }, pending);
      journalRef.current = saved;
      setJournal(saved);
      const result = await readConfirmed(saved, token);
      active(token);
      setConfirmed(result);
    } catch (failure) {
      if (mounted.current && generation.current === token) failed(failure, 'queue');
    } finally {
      finish(token);
    }
  }, [
    active,
    begin,
    blocked,
    checkedReceipt,
    confirmed,
    failed,
    finish,
    readConfirmed,
    requestedScope,
    userId,
  ]);

  const execute = useCallback(async () => {
    if (rendered.current.confirmed !== confirmed || rendered.current.blocked !== blocked) return;
    if (blocked || confirmed?.outcome.status !== 'PENDING') return;
    const expected = journalRef.current;
    if (!expected?.job || JSON.stringify(expected.job) !== JSON.stringify(confirmed.job)) return;
    const selection = confirmed;
    const token = begin();
    if (token === null) return;
    try {
      const reply = await executeSemesterAllocationJob(
        userId,
        SemesterAllocationJobSchema.parse(selection.job),
        SemesterAllocationJobOutcomeSchema.parse(selection.outcome),
        () => {
          active(token);
          confirmSemesterAllocationJobJournal(expected, userId, requestedScope());
          return undefined;
        },
      );
      active(token);
      const result = SemesterAllocationJobExecutionSchema.parse(reply);
      const outcome = checkedOutcome(result.outcome, selection.job);
      const saved = confirmSemesterAllocationJobJournal(expected, userId, requestedScope());
      journalRef.current = saved;
      setJournal(saved);
      priorOutcome.current = outcome;
      setConfirmed({ job: selection.job, outcome, processed: result.processed });
    } catch (failure) {
      if (mounted.current && generation.current === token) failed(failure, 'execute');
    } finally {
      finish(token);
    }
  }, [active, begin, blocked, checkedOutcome, confirmed, failed, finish, requestedScope, userId]);

  const uncertain = journal !== null && journal.job === null;
  const terminal = confirmed !== null && confirmed.outcome.status !== 'PENDING';
  const queueBlocked = blocked || (journal?.job !== null && journal !== null && !terminal);
  return (
    <section
      aria-label="Queued semester simulation request"
      className="min-w-0 space-y-4 border-t border-gray-200 pt-6"
    >
      <div>
        <h3 className="text-lg font-semibold text-gray-900">Semester simulation request</h3>
        <p className="mt-2 max-w-prose text-sm text-gray-600">
          Queue a semester simulation. When you run it, it uses the current cohort and saved
          resource settings. Unsaved edits are excluded.
        </p>
      </div>
      <div className="flex flex-wrap gap-3">
        <Button
          variant="secondary"
          className="min-h-11"
          disabled={loading || queueBlocked}
          onClick={() => void queue()}
        >
          {uncertain
            ? 'Retry semester queue'
            : terminal
              ? 'Queue another semester request'
              : 'Queue semester request'}
        </Button>
        {(journal || blocked || error) && (
          <Button
            variant="secondary"
            className="min-h-11"
            disabled={loading}
            onClick={() => void recover()}
          >
            {blocked || (!confirmed && journal?.job)
              ? 'Retry semester request recovery'
              : 'Check semester request outcome'}
          </Button>
        )}
        {confirmed?.outcome.status === 'PENDING' && (
          <Button className="min-h-11" disabled={loading || blocked} onClick={() => void execute()}>
            Execute selected semester request
          </Button>
        )}
      </div>
      {loading && (
        <p role="status" className="text-sm text-gray-600">
          Checking semester request…
        </p>
      )}
      {error && (
        <p role="alert" className="max-w-prose text-sm text-red-700">
          {error}
        </p>
      )}
      {!loading && uncertain && (
        <p className="max-w-prose text-sm text-gray-600">
          This tab has an unconfirmed semester enqueue request. Retry explicitly with its original
          key; no request is sent automatically.
        </p>
      )}
      {confirmed && (
        <div className="space-y-4">
          <dl className="space-y-2 text-sm text-gray-700">
            <div>
              <dt className="font-medium">Selected semester request</dt>
              <dd className="break-words [overflow-wrap:anywhere]">{confirmed.job.id}</dd>
            </div>
            <div>
              <dt className="font-medium">Scenario</dt>
              <dd>
                {confirmed.job.scope.semester} {confirmed.job.scope.year} · curriculum{' '}
                <span className="break-words [overflow-wrap:anywhere]">
                  {confirmed.job.scope.curriculumId}
                </span>
              </dd>
            </div>
            <div>
              <dt className="font-medium">Queued</dt>
              <dd>
                <time dateTime={confirmed.job.queuedAt}>
                  {new Date(confirmed.job.queuedAt).toLocaleString()}
                </time>
              </dd>
            </div>
          </dl>
          <p role="status" className="max-w-prose text-sm text-gray-700">
            {confirmed.outcome.status === 'PENDING'
              ? 'No terminal outcome is committed. Another execution may be in progress. Checking the outcome never starts work.'
              : confirmed.outcome.status === 'SUCCEEDED'
                ? confirmed.processed === false
                  ? 'This semester simulation was already completed. Student results are saved.'
                  : 'Semester simulation completed. Student results are saved.'
                : confirmed.outcome.failureCode === 'AUTHOR_UNAVAILABLE'
                  ? 'This request could not run because its original administrator is no longer available. No capture was saved.'
                  : 'This request could not run because the current scenario is unsupported. No capture was saved. Review the scenario before queuing another request.'}
          </p>
          {confirmed.outcome.completedAt && (
            <p className="text-sm text-gray-700">
              Completed{' '}
              <time dateTime={confirmed.outcome.completedAt}>
                {new Date(confirmed.outcome.completedAt).toLocaleString()}
              </time>
            </p>
          )}
          {confirmed.outcome.runId && (
            <p className="max-w-prose text-sm text-gray-700">
              Saved semester result{' '}
              <span className="break-words [overflow-wrap:anywhere]">
                {confirmed.outcome.runId}
              </span>
              . Participating students can review their own result in Planner.
            </p>
          )}
          <p className="max-w-prose text-sm text-gray-600">
            Simulation only. Official eligibility, registration, timetables, labs and staff
            suitability remain unverified. Academic records remain unchanged. This tab shows your
            latest semester request.
          </p>
        </div>
      )}
    </section>
  );
}
