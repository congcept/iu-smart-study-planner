import { isAxiosError } from 'axios';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AllocationJobSchema,
  AllocationJobOutcomeSchema,
  AllocationJobExecutionSchema,
  CreateAllocationJobSchema,
  type AllocationJobDTO,
  type AllocationJobOutcomeDTO,
  type ResourceScopeDTO,
} from '@iu-study-planner/shared';
import { Button } from '@/components/ui';
import { getSession } from '@/lib/api';
import {
  enqueueAllocationJob,
  getAllocationJob,
  getAllocationJobOutcome,
  executeAllocationJob,
} from '@/lib/allocationJobsApi';
import {
  AllocationJobRecoveryError,
  readAllocationJobJournal,
  writeAllocationJobJournal,
  type AllocationJobJournal,
} from './allocationJobRecovery';

type Props = { userId: string; scope: ResourceScopeDTO };
class AdminSessionChanged extends Error {}
type Operation = 'queue' | 'read' | 'execute';
const ScopeSchema = CreateAllocationJobSchema.omit({ requestId: true, expectedActorId: true });

export function AllocationJobPanel({ userId, scope }: Props) {
  const owner = userId.toLowerCase();
  const key = JSON.stringify([owner, scope.curriculumId.toLowerCase(), scope.semester, scope.year]);
  return <JobPanel key={key} userId={owner} scope={scope} />;
}

function JobPanel({ userId, scope }: Props) {
  const { curriculumId, semester, year } = scope;
  const generation = useRef(0);
  const busy = useRef(false);
  const journalRef = useRef<AllocationJobJournal | null>(null);
  const [journal, setJournal] = useState<AllocationJobJournal | null>(null);
  const [job, setJob] = useState<AllocationJobDTO | null>(null);
  const [outcome, setOutcome] = useState<AllocationJobOutcomeDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [blocked, setBlocked] = useState(false);
  const [error, setError] = useState('');
  const requestedScope = useCallback(
    () => ScopeSchema.parse({ curriculumId, semester, year }),
    [curriculumId, semester, year],
  );
  const verifySession = useCallback(async () => {
    const account = await getSession();
    if (!account || account.id.toLowerCase() !== userId || account.role !== 'ADMIN')
      throw new AdminSessionChanged();
  }, [userId]);
  const checkedJob = useCallback(
    (input: unknown, id?: string) => {
      const receipt = AllocationJobSchema.parse(input);
      const expected = requestedScope();
      if (
        receipt.scope.curriculumId !== expected.curriculumId ||
        receipt.scope.semester !== expected.semester ||
        receipt.scope.year !== expected.year ||
        (id !== undefined && receipt.id !== id)
      )
        throw new Error('Simulation receipt does not match the selected request');
      return receipt;
    },
    [requestedScope],
  );
  const checkedOutcome = useCallback((input: unknown, receipt: AllocationJobDTO) => {
    const result = AllocationJobOutcomeSchema.parse(input);
    if (
      result.jobId !== receipt.id ||
      result.queuedAt !== receipt.queuedAt ||
      result.scope.curriculumId !== receipt.scope.curriculumId ||
      result.scope.semester !== receipt.scope.semester ||
      result.scope.year !== receipt.scope.year
    )
      throw new Error('Simulation outcome does not match its immutable receipt');
    return result;
  }, []);
  const begin = useCallback(() => {
    if (busy.current) return null;
    busy.current = true;
    setLoading(true);
    setError('');
    return ++generation.current;
  }, []);
  const finish = useCallback((token: number) => {
    if (token !== generation.current) return;
    busy.current = false;
    setLoading(false);
  }, []);
  const report = useCallback((failure: unknown, operation: Operation) => {
    if (failure instanceof AllocationJobRecoveryError) {
      setBlocked(true);
      setError(
        'This tab’s request recovery cannot be verified. Restore session storage and retry recovery before sending a request.',
      );
    } else if (
      failure instanceof AdminSessionChanged ||
      (isAxiosError(failure) && [401, 403].includes(failure.response?.status ?? 0))
    ) {
      setJob(null);
      setOutcome(null);
      setError('Your admin session changed. Sign in as this administrator before retrying.');
    } else {
      setError(
        operation === 'queue'
          ? 'Could not confirm the queued request. Retry uses the original request key; no replacement request is sent automatically.'
          : operation === 'execute'
            ? 'Could not confirm execution. Check the request outcome before retrying the same job.'
            : 'Could not verify this request and its outcome. Retry recovery to check the original job.',
      );
    }
  }, []);
  const loadOutcome = useCallback(
    async (receipt: AllocationJobDTO, token: number) => {
      await verifySession();
      if (token !== generation.current) return;
      const result = checkedOutcome(
        await getAllocationJobOutcome(receipt.id, requestedScope()),
        receipt,
      );
      if (token !== generation.current) return;
      await verifySession();
      if (token !== generation.current) return;
      setOutcome(result);
    },
    [checkedOutcome, requestedScope, verifySession],
  );
  const recover = useCallback(async () => {
    const token = begin();
    if (token === null) return;
    setBlocked(false);
    setJob(null);
    setOutcome(null);
    try {
      const saved = readAllocationJobJournal(userId, requestedScope());
      journalRef.current = saved;
      setJournal(saved);
      if (saved?.jobId) {
        await verifySession();
        if (token !== generation.current) return;
        const receipt = checkedJob(
          await getAllocationJob(saved.jobId, requestedScope()),
          saved.jobId,
        );
        if (token !== generation.current) return;
        await verifySession();
        if (token !== generation.current) return;
        setJob(receipt);
        await loadOutcome(receipt, token);
      }
    } catch (failure) {
      if (token === generation.current) report(failure, 'read');
    } finally {
      finish(token);
    }
  }, [begin, checkedJob, finish, loadOutcome, report, requestedScope, userId, verifySession]);
  useEffect(() => {
    const active = generation;
    const pending = busy;
    void recover();
    return () => {
      active.current++;
      pending.current = false;
    };
  }, [recover]);

  const queue = useCallback(async () => {
    if (blocked || (journalRef.current?.jobId && (!outcome || outcome.status === 'PENDING')))
      return;
    const token = begin();
    if (token === null) return;
    setJob(null);
    setOutcome(null);
    try {
      await verifySession();
      if (token !== generation.current) return;
      const previous = journalRef.current;
      const pending: AllocationJobJournal =
        previous && !previous.jobId
          ? previous
          : {
              version: 1,
              ownerId: userId,
              request: CreateAllocationJobSchema.parse({
                ...requestedScope(),
                expectedActorId: userId,
                requestId: crypto.randomUUID(),
              }),
            };
      // A conditional, confirmed storage write always precedes even an enqueue retry.
      const saved = writeAllocationJobJournal(pending, previous);
      journalRef.current = saved;
      setJournal(saved);
      const receipt = checkedJob(await enqueueAllocationJob(saved.request));
      if (token !== generation.current) return;
      await verifySession();
      if (token !== generation.current) return;
      const confirmed = writeAllocationJobJournal({ ...saved, jobId: receipt.id }, saved);
      journalRef.current = confirmed;
      setJournal(confirmed);
      setJob(receipt);
      await loadOutcome(receipt, token);
    } catch (failure) {
      if (token === generation.current)
        report(failure, journalRef.current?.jobId ? 'read' : 'queue');
    } finally {
      finish(token);
    }
  }, [
    begin,
    blocked,
    checkedJob,
    finish,
    loadOutcome,
    outcome,
    report,
    requestedScope,
    userId,
    verifySession,
  ]);

  const execute = useCallback(async () => {
    if (blocked || !job || outcome?.status !== 'PENDING' || journalRef.current?.jobId !== job.id)
      return;
    const token = begin();
    if (token === null) return;
    setOutcome(null);
    try {
      const current = readAllocationJobJournal(userId, requestedScope());
      if (JSON.stringify(current) !== JSON.stringify(journalRef.current))
        throw new AllocationJobRecoveryError('Request recovery changed before execution');
      await verifySession();
      if (token !== generation.current) return;
      // Authorization yields to other mounted views; verify the same receipt again before POST.
      const authorized = readAllocationJobJournal(userId, requestedScope());
      if (JSON.stringify(authorized) !== JSON.stringify(journalRef.current))
        throw new AllocationJobRecoveryError('Request recovery changed during authorization');
      const result = AllocationJobExecutionSchema.parse(
        await executeAllocationJob(job.id, { ...requestedScope(), expectedActorId: userId }),
      );
      const verified = checkedOutcome(result.outcome, job);
      if (token !== generation.current) return;
      await verifySession();
      if (token !== generation.current) return;
      setOutcome(verified);
    } catch (failure) {
      if (token === generation.current) report(failure, 'execute');
    } finally {
      finish(token);
    }
  }, [
    begin,
    blocked,
    checkedOutcome,
    finish,
    job,
    outcome,
    report,
    requestedScope,
    userId,
    verifySession,
  ]);

  const pendingReceipt = journal !== null && !journal.jobId;
  const terminal = outcome !== null && outcome.status !== 'PENDING';
  const queueBlocked = blocked || (!!journal?.jobId && !terminal);
  return (
    <section
      aria-label="Queued simulation request"
      className="space-y-4 border-t border-gray-200 pt-6"
    >
      <div>
        <h3 className="text-lg font-semibold text-gray-900">Simulation request</h3>
        <p className="mt-2 max-w-prose text-sm text-gray-600">
          Queue a request for this scenario, then explicitly run its one-course allocation round.
          Inputs are captured when execution begins, using saved settings and the current cohort.
          Unsaved edits are excluded. No student assignments are saved.
        </p>
      </div>
      <div className="flex flex-wrap gap-3">
        <Button
          variant="secondary"
          className="min-h-11"
          disabled={loading || queueBlocked}
          onClick={() => void queue()}
        >
          {pendingReceipt
            ? 'Retry queued request'
            : terminal
              ? 'Queue another request'
              : 'Queue simulation request'}
        </Button>
        {(journal || blocked || error) && (
          <Button
            variant="secondary"
            className="min-h-11"
            disabled={loading}
            onClick={() => void recover()}
          >
            {blocked || (!job && journal?.jobId)
              ? 'Retry request recovery'
              : 'Check request outcome'}
          </Button>
        )}
        {job && outcome?.status === 'PENDING' && (
          <Button className="min-h-11" disabled={loading || blocked} onClick={() => void execute()}>
            Execute selected request
          </Button>
        )}
      </div>
      {loading && (
        <p role="status" className="text-sm text-gray-600">
          Checking simulation request…
        </p>
      )}
      {error && (
        <p role="alert" className="max-w-prose text-sm text-red-700">
          {error}
        </p>
      )}
      {!loading && pendingReceipt && (
        <p className="max-w-prose text-sm text-gray-600">
          This tab has an unconfirmed enqueue request. Retry explicitly with the original key to
          recover its receipt.
        </p>
      )}
      {job && (
        <dl className="space-y-2 text-sm text-gray-700">
          <div>
            <dt className="font-medium">Selected request</dt>
            <dd className="break-all">{job.id}</dd>
          </div>
          <div>
            <dt className="font-medium">Queued</dt>
            <dd>{new Date(job.queuedAt).toLocaleString()}</dd>
          </div>
        </dl>
      )}
      {outcome && (
        <div className="space-y-2 text-sm text-gray-700">
          <p role="status" className="max-w-prose">
            {outcome.status === 'PENDING'
              ? 'No terminal outcome is committed. Another execution may be in progress; checking the outcome never starts work.'
              : outcome.status === 'SUCCEEDED'
                ? 'Simulation completed. Its aggregate capture is saved; student plans and progress are unchanged.'
                : outcome.failureCode === 'AUTHOR_UNAVAILABLE'
                  ? 'This request could not run because its original administrator is no longer available. No capture was saved.'
                  : 'This request could not run because the current scenario is unsupported. No capture was saved. Review the scenario before queuing another request.'}
          </p>
          {outcome.completedAt && <p>Completed {new Date(outcome.completedAt).toLocaleString()}</p>}
          {outcome.runId && (
            <p className="max-w-prose">
              Saved capture <span className="break-all">{outcome.runId}</span>. Reload simulation
              run history below to inspect this historical result.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
