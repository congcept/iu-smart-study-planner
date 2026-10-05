import { isAxiosError } from 'axios';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AllocationRunV1Schema,
  ResourceScopeSchema,
  type AllocationRunV1DTO,
  type ResourceScopeDTO,
} from '@iu-study-planner/shared';
import { Button } from '@/components/ui';
import { getSession } from '@/lib/api';
import { createAllocationRun, getAllocationRun } from '@/lib/allocationRunsApi';
import {
  AllocationRunCaptureRequestSchema,
  AllocationRunRecoveryError,
  readAllocationRunJournal,
  writeAllocationRunJournal,
  type AllocationRunJournal,
} from './allocationRunRecovery';

type Props = { userId: string; scope: ResourceScopeDTO };
class AdminSessionChanged extends Error {}
const percent = new Intl.NumberFormat(undefined, { style: 'percent', maximumFractionDigits: 1 });

export function AllocationRunCapturePanel({ userId, scope }: Props) {
  const owner = userId.toLowerCase();
  const key = JSON.stringify([owner, scope.curriculumId.toLowerCase(), scope.semester, scope.year]);
  return <CapturePanel key={key} userId={owner} scope={scope} />;
}

function CapturePanel({ userId, scope }: Props) {
  const { curriculumId, semester, year } = scope;
  const generation = useRef(0);
  const busy = useRef(false);
  const journalRef = useRef<AllocationRunJournal | null>(null);
  const [journal, setJournal] = useState<AllocationRunJournal | null>(null);
  const [run, setRun] = useState<AllocationRunV1DTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [blocked, setBlocked] = useState(false);
  const [error, setError] = useState('');
  const requestedScope = useCallback(
    () => ResourceScopeSchema.parse({ curriculumId, semester, year }),
    [curriculumId, semester, year],
  );
  const verifySession = useCallback(async () => {
    const account = await getSession();
    if (!account || account.id.toLowerCase() !== userId || account.role !== 'ADMIN')
      throw new AdminSessionChanged();
  }, [userId]);
  const checkedRun = useCallback(
    (input: unknown, id?: string) => {
      const result = AllocationRunV1Schema.parse(input);
      const requested = requestedScope();
      const received = result.result.scope;
      if (
        received.curriculumId !== requested.curriculumId ||
        received.semester !== requested.semester ||
        received.year !== requested.year ||
        (id !== undefined && result.id !== id)
      )
        throw new Error('Saved capture does not match its receipt or scenario');
      return result;
    },
    [requestedScope],
  );
  const reportFailure = useCallback((failure: unknown, reading: boolean) => {
    if (failure instanceof AllocationRunRecoveryError) {
      setBlocked(true);
      setError(
        'This tab’s capture recovery cannot be verified. Capture is blocked. Restore session storage or use a new tab, then retry recovery.',
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
          ? 'Could not verify the last saved capture. Retry recovery to load the original receipt.'
          : 'Could not confirm the simulation capture. Retry uses the same request key and cannot create a duplicate run.',
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
      const saved = readAllocationRunJournal(userId, requestedScope());
      journalRef.current = saved;
      setJournal(saved);
      if (saved?.runId) {
        await verifySession();
        if (token !== generation.current) return;
        const result = checkedRun(
          await getAllocationRun(saved.runId, requestedScope()),
          saved.runId,
        );
        if (token !== generation.current) return;
        await verifySession();
        if (token !== generation.current) return;
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
  }, [checkedRun, reportFailure, requestedScope, userId, verifySession]);
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
    try {
      await verifySession();
      if (token !== generation.current) return;
      const previous = journalRef.current;
      const pending: AllocationRunJournal =
        previous && !previous.runId
          ? previous
          : {
              version: 1,
              ownerId: userId,
              request: AllocationRunCaptureRequestSchema.parse({
                ...requestedScope(),
                requestId: crypto.randomUUID(),
                expectedActorId: userId,
              }),
            };
      // Even a retry must verify that the durable key is still present before issuing POST.
      const saved = writeAllocationRunJournal(pending, previous);
      journalRef.current = saved;
      setJournal(saved);
      const result = checkedRun(await createAllocationRun(saved.request));
      if (token !== generation.current) return;
      await verifySession();
      if (token !== generation.current) return;
      setRun(result);
      try {
        const receipt = writeAllocationRunJournal({ ...saved, runId: result.id }, saved);
        journalRef.current = receipt;
        setJournal(receipt);
      } catch {
        setError(
          'The server confirmed this capture, but its receipt could not be saved in this tab. Retry with the original request key to recover the same run.',
        );
      }
    } catch (failure) {
      if (token === generation.current) reportFailure(failure, false);
    } finally {
      if (token === generation.current) {
        busy.current = false;
        setLoading(false);
      }
    }
  }, [blocked, checkedRun, reportFailure, requestedScope, userId, verifySession]);

  const pendingCapture = journal !== null && journal.runId === undefined;
  const receiptNeedsRecovery = journal?.runId !== undefined && run === null;
  const recoveryAction = blocked || receiptNeedsRecovery;
  const result = run?.result;
  return (
    <section
      aria-label="Saved simulation capture"
      className="space-y-4 border-t border-gray-200 pt-6"
    >
      <div>
        <h3 className="text-lg font-semibold text-gray-900">Saved simulation capture</h3>
        <p className="mt-2 max-w-prose text-sm text-gray-600">
          Capture a new aggregate run from saved resource settings and the current cohort. Unsaved
          resource edits are excluded. No student assignments are saved.
        </p>
      </div>
      <Button
        variant="secondary"
        className="min-h-11"
        disabled={loading}
        onClick={() => void (recoveryAction ? recover() : capture())}
      >
        {recoveryAction
          ? 'Retry capture recovery'
          : pendingCapture
            ? 'Retry simulation capture'
            : run
              ? 'Capture another run'
              : 'Capture simulation run'}
      </Button>
      {loading && (
        <p role="status" className="text-sm text-gray-600">
          Checking simulation capture…
        </p>
      )}
      {error && (
        <p role="alert" className="max-w-prose text-sm text-red-700">
          {error}
        </p>
      )}
      {!loading && pendingCapture && !run && (
        <p className="max-w-prose text-sm text-gray-600">
          An earlier capture is unconfirmed in this tab. Retry explicitly to recover it with the
          original request key; no capture is sent automatically.
        </p>
      )}
      {run && result && (
        <div className="space-y-4">
          <h4 className="font-semibold text-gray-900">Last capture in this tab</h4>
          <p role="status" className="max-w-prose text-sm text-gray-700">
            Aggregate snapshot saved. {result.curriculum.name} · {result.scope.semester}{' '}
            {result.scope.year}. This is a historical capture; current settings and cohort changes
            do not update it.
          </p>
          <dl className="grid grid-cols-1 gap-x-8 gap-y-3 text-sm sm:grid-cols-2">
            {[
              ['Students in captured cohort', result.cohortStudentCount],
              ['Assigned in simulation', result.assignedStudentCount],
              ['No eligible choices', result.noChoicesStudentCount],
              ['Unresolved without resource settings', result.resourceUnknownStudentCount],
              ['Unassigned after capacity is exhausted', result.capacityExhaustedStudentCount],
              ['Unresolved numeric GPA path', result.unresolvedGpaStudentCount],
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
            {result.resources
              ? `Captured resource revision ${result.resources.resourceRevision}. ${result.usedSections} of ${result.resources.sharedSectionCeiling} shared classroom/staff sections opened.`
              : 'No resource settings were saved when this run was captured. Capacity remains unknown.'}{' '}
            One course per student in one simulated round; no full-semester allocation or student
            assignments are stored.
          </p>
          <p className="max-w-prose text-sm text-gray-600">
            Captured student utility: Bayesian difficulty fit{' '}
            {percent.format(result.utilityPolicy.difficultyFitWeight)}, immediate prerequisite
            unlocks {percent.format(result.utilityPolicy.immediateUnlockWeight)}. Allocation
            weights: student utility {percent.format(result.allocationPolicy.studentUtilityWeight)},
            resource fit {percent.format(result.allocationPolicy.resourceFitWeight)}, fairness{' '}
            {percent.format(result.allocationPolicy.fairnessWeight)}; congestion threshold{' '}
            {percent.format(result.allocationPolicy.congestionThreshold)}.
          </p>
          <p className="max-w-prose text-sm text-gray-600">
            Category, grade-fit and graduation-timeline personalization remain unavailable. Labs,
            course overrides, professor availability and qualifications, timetable and official
            offerings remain unverified. Only the last receipt in this tab is shown; a full run
            history is not available here yet.
          </p>
        </div>
      )}
    </section>
  );
}
