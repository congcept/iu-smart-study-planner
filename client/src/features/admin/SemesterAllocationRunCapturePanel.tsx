import { isAxiosError } from 'axios';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  SemesterAllocationRunV1Schema,
  SemesterAllocationScopeV1Schema,
  type ResourceScopeDTO,
  type SemesterAllocationRunV1DTO,
} from '@iu-study-planner/shared';
import { Button } from '@/components/ui';
import { getSession } from '@/lib/api';
import {
  createSemesterAllocationRun,
  getSemesterAllocationRun,
} from '@/lib/semesterAllocationRunsApi';
import {
  SemesterAllocationRunCaptureRequestSchema,
  SemesterAllocationRunRecoveryError,
  confirmSemesterAllocationRunJournal,
  readSemesterAllocationRunJournal,
  writeSemesterAllocationRunJournal,
  type SemesterAllocationRunJournal,
} from './semesterAllocationRunRecovery';

type Props = { userId: string; scope: ResourceScopeDTO };
class AdminSessionChanged extends Error {}
class StaleRequest extends Error {}

export function SemesterAllocationRunCapturePanel({ userId, scope }: Props) {
  const owner = userId.toLowerCase();
  const key = JSON.stringify([owner, scope.curriculumId.toLowerCase(), scope.semester, scope.year]);
  return <CapturePanel key={key} userId={owner} scope={scope} />;
}

function CapturePanel({ userId, scope }: Props) {
  const { curriculumId, semester, year } = scope;
  const generation = useRef(0);
  const busy = useRef(false);
  const journalRef = useRef<SemesterAllocationRunJournal | null>(null);
  const [journal, setJournal] = useState<SemesterAllocationRunJournal | null>(null);
  const [run, setRun] = useState<SemesterAllocationRunV1DTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [blocked, setBlocked] = useState(false);
  const [error, setError] = useState('');
  const requestedScope = useCallback(
    () => SemesterAllocationScopeV1Schema.parse({ curriculumId, semester, year }),
    [curriculumId, semester, year],
  );
  const verifySession = useCallback(async () => {
    const account = await getSession();
    if (!account || account.id.toLowerCase() !== userId || account.role !== 'ADMIN')
      throw new AdminSessionChanged();
  }, [userId]);
  const underSession = useCallback(
    async (operation: () => Promise<unknown>, token: number) => {
      await verifySession();
      if (token !== generation.current) throw new StaleRequest();
      let outcome: { success: true; value: unknown } | { success: false; failure: unknown };
      try {
        outcome = { success: true, value: await operation() };
      } catch (failure) {
        outcome = { success: false, failure };
      }
      if (token !== generation.current) throw new StaleRequest();
      await verifySession();
      if (token !== generation.current) throw new StaleRequest();
      if (!outcome.success) throw outcome.failure;
      return outcome.value;
    },
    [verifySession],
  );
  const checkedRun = useCallback(
    (input: unknown, id?: string) => {
      const result = SemesterAllocationRunV1Schema.parse(input);
      const requested = requestedScope();
      const received = result.result.scope;
      if (
        received.curriculumId !== requested.curriculumId ||
        received.semester !== requested.semester ||
        received.year !== requested.year ||
        (id !== undefined && result.id !== id)
      )
        throw new Error('Saved semester capture does not match its receipt or scenario');
      return result;
    },
    [requestedScope],
  );
  const reportFailure = useCallback((failure: unknown, reading: boolean) => {
    if (failure instanceof SemesterAllocationRunRecoveryError) {
      setBlocked(true);
      setError(
        'This tab’s semester capture recovery cannot be verified. Capture is blocked. Restore session storage or use a new tab, then retry recovery.',
      );
    } else if (
      failure instanceof AdminSessionChanged ||
      (isAxiosError(failure) && [401, 403].includes(failure.response?.status ?? 0))
    ) {
      setRun(null);
      setError('Your admin session changed. Sign in as this administrator before retrying.');
    } else {
      setError(
        reading
          ? 'Could not verify the last saved semester capture. Retry recovery to load the original receipt.'
          : journalRef.current && !journalRef.current.runId
            ? 'Could not confirm the semester capture. Retry uses the same request key and cannot create a duplicate run.'
            : 'Could not start the semester capture. No new capture request was sent. Try again after restoring your admin session.',
      );
    }
  }, []);
  const recover = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    const token = ++generation.current;
    setLoading(true);
    setBlocked(false);
    setError('');
    setRun(null);
    try {
      const saved = readSemesterAllocationRunJournal(userId, requestedScope());
      journalRef.current = saved;
      setJournal(saved);
      if (saved?.runId) {
        const savedRunId = saved.runId;
        const received = await underSession(
          () => getSemesterAllocationRun(savedRunId, requestedScope()),
          token,
        );
        if (token !== generation.current) return;
        const result = checkedRun(received, savedRunId);
        const confirmed = confirmSemesterAllocationRunJournal(saved, userId, requestedScope());
        journalRef.current = confirmed;
        setJournal(confirmed);
        setRun(result);
      }
    } catch (failure) {
      if (token === generation.current) reportFailure(failure, true);
    } finally {
      if (token === generation.current) {
        busy.current = false;
        setLoading(false);
      }
    }
  }, [checkedRun, reportFailure, requestedScope, underSession, userId]);
  useEffect(() => {
    const active = generation;
    const pending = busy;
    void recover();
    return () => {
      active.current++;
      pending.current = false;
    };
  }, [recover]);

  const capture = useCallback(async () => {
    if (busy.current || blocked) return;
    busy.current = true;
    const token = ++generation.current;
    setLoading(true);
    setError('');
    setRun(null);
    let reading = false;
    try {
      const previous = journalRef.current;
      if (previous?.runId) {
        reading = true;
        const previousRunId = previous.runId;
        const received = await underSession(
          () => getSemesterAllocationRun(previousRunId, requestedScope()),
          token,
        );
        if (token !== generation.current) return;
        checkedRun(received, previousRunId);
        reading = false;
      }
      const pending: SemesterAllocationRunJournal =
        previous && !previous.runId
          ? previous
          : {
              version: 1,
              ownerId: userId,
              request: SemesterAllocationRunCaptureRequestSchema.parse({
                ...requestedScope(),
                requestId: crypto.randomUUID(),
                expectedActorId: userId,
              }),
            };
      const sent: { journal: SemesterAllocationRunJournal | null } = { journal: null };
      const received = await underSession(() => {
        // Persist and confirm the retry key synchronously after the fresh session preflight.
        const saved = writeSemesterAllocationRunJournal(pending, previous);
        sent.journal = saved;
        journalRef.current = saved;
        setJournal(saved);
        return createSemesterAllocationRun(saved.request);
      }, token);
      if (token !== generation.current) return;
      const result = checkedRun(received);
      const saved = sent.journal;
      if (saved === null) throw new SemesterAllocationRunRecoveryError();
      setRun(result);
      try {
        const receipt = writeSemesterAllocationRunJournal({ ...saved, runId: result.id }, saved);
        journalRef.current = receipt;
        setJournal(receipt);
      } catch {
        setBlocked(true);
        setError(
          'The server confirmed this semester capture, but its receipt could not be verified in this tab. Retry recovery before using the original request key again.',
        );
      }
    } catch (failure) {
      if (token === generation.current) reportFailure(failure, reading);
    } finally {
      if (token === generation.current) {
        busy.current = false;
        setLoading(false);
      }
    }
  }, [blocked, checkedRun, reportFailure, requestedScope, underSession, userId]);

  const pendingCapture = journal !== null && journal.runId === undefined;
  const receiptNeedsRecovery = journal?.runId !== undefined && run === null;
  const recoveryAction = blocked || receiptNeedsRecovery;
  const result = run?.result;
  return (
    <section
      aria-label="Saved semester simulation"
      className="space-y-4 border-t border-gray-200 pt-6"
    >
      <div>
        <h3 className="text-lg font-semibold text-gray-900">Saved semester simulation</h3>
        <p className="mt-2 max-w-prose text-sm text-gray-600">
          Explicitly save a semester simulation from the current cohort and saved resource settings.
          Private per-student simulation outcomes are stored; this administrator view shows their
          aggregate only. Academic plans, progress, grades and resource settings remain unchanged.
          Unsaved resource edits are excluded.
        </p>
      </div>
      <Button
        variant="secondary"
        className="min-h-11"
        disabled={loading}
        onClick={() => void (recoveryAction ? recover() : capture())}
      >
        {recoveryAction
          ? 'Retry semester capture recovery'
          : pendingCapture
            ? 'Retry semester capture'
            : run
              ? 'Capture another semester run'
              : 'Capture semester simulation'}
      </Button>
      {loading && (
        <p role="status" className="text-sm text-gray-600">
          Checking semester capture…
        </p>
      )}
      {error && (
        <p role="alert" className="max-w-prose text-sm text-red-700">
          {error}
        </p>
      )}
      {!loading && pendingCapture && !run && (
        <p className="max-w-prose text-sm text-gray-600">
          An earlier semester capture is unconfirmed in this tab. Retry explicitly with the original
          request key; no capture is sent automatically.
        </p>
      )}
      {run && result && (
        <div className="space-y-4">
          <h4 className="font-semibold text-gray-900">Last semester capture in this tab</h4>
          <p role="status" className="max-w-prose text-sm text-gray-700">
            Semester snapshot and private simulation assignments saved. {result.curriculum.name} ·{' '}
            {result.scope.semester} {result.scope.year}. This is a historical capture; changes to
            the current cohort, course metadata or settings do not update it.
          </p>
          <dl className="grid grid-cols-1 gap-x-8 gap-y-3 text-sm sm:grid-cols-2">
            {[
              ['Students in captured cohort', result.studentCount],
              ['Students with assignments', result.assignedStudentCount],
              ['Course assignments', result.assignedCourseCount],
              ['Total reference target credits', result.totalTargetCredits],
              ['Assigned credits', result.totalAssignedCredits],
              ['Credits left unassigned', result.totalRemainingCredits],
              ['Simulated rounds', result.rounds],
              ['Reached reference target', result.stopReasonCounts.TARGET_REACHED],
              ['No remaining eligible choices', result.stopReasonCounts.NO_REMAINING_CHOICES],
              ['Choices exceed remaining credit budget', result.stopReasonCounts.CREDIT_LIMIT],
              ['Resource settings missing', result.stopReasonCounts.RESOURCE_UNKNOWN],
              ['Shared capacity exhausted', result.stopReasonCounts.CAPACITY_EXHAUSTED],
            ].map(([label, value]) => (
              <div
                key={label}
                className="flex items-baseline justify-between gap-4 border-b border-gray-200 pb-2"
              >
                <dt className="text-gray-700">{label}</dt>
                <dd className="font-semibold tabular-nums text-gray-900">{value}</dd>
              </div>
            ))}
          </dl>
          <dl className="space-y-2 text-sm text-gray-700">
            <div>
              <dt className="font-medium">Capture completed</dt>
              <dd>
                <time dateTime={run.capturedAt}>{new Date(run.capturedAt).toLocaleString()}</time>
              </dd>
            </div>
            <div>
              <dt className="font-medium">Stored on server</dt>
              <dd>
                <time dateTime={run.createdAt}>{new Date(run.createdAt).toLocaleString()}</time>
              </dd>
            </div>
          </dl>
          <p className="max-w-prose text-sm text-gray-600">
            {result.envelope.envelope
              ? `Captured resource revision ${result.envelope.resourceRevision}. ${result.usedSections} of ${result.envelope.envelope.sharedSectionCeiling} shared classroom/staff sections opened across all rounds.`
              : 'No resource settings were saved when this run was captured. Capacity remains unknown.'}{' '}
            Credit targets are captured reference budgets; they do not establish requested or
            registered course loads.
          </p>
          <p className="max-w-prose text-sm text-gray-600">
            Academic plans remain unchanged. Official eligibility, registration, timetables, labs,
            staff availability and qualifications remain unverified. Category, grade-fit and
            graduation-timeline personalization are unavailable. Only the last semester receipt in
            this tab is shown; no semester history browser is available here.
          </p>
        </div>
      )}
    </section>
  );
}
