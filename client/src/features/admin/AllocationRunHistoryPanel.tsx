import { isAxiosError } from 'axios';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AllocationRunHistorySchema,
  AllocationRunV1Schema,
  ResourceScopeSchema,
  type AllocationRunHistoryDTO,
  type AllocationRunV1DTO,
  type ResourceScopeDTO,
} from '@iu-study-planner/shared';
import { Button } from '@/components/ui';
import { getSession } from '@/lib/api';
import { getAllocationRun, listAllocationRuns } from '@/lib/allocationRunsApi';

type Props = { userId: string; scope: ResourceScopeDTO };
type PageRequest = { after?: string; boundary?: AllocationRunV1DTO };
class AdminSessionChanged extends Error {}
const percent = new Intl.NumberFormat(undefined, { style: 'percent', maximumFractionDigits: 1 });

// Preserve sub-millisecond storage precision when checking the immutable paging boundary.
function precedesBoundary(run: AllocationRunV1DTO, boundary: AllocationRunV1DTO) {
  const time = Date.parse(run.createdAt) - Date.parse(boundary.createdAt);
  if (time !== 0) return time < 0;
  const left = /\.(\d+)Z$/.exec(run.createdAt)?.[1] ?? '';
  const right = /\.(\d+)Z$/.exec(boundary.createdAt)?.[1] ?? '';
  const precision = Math.max(left.length, right.length);
  const comparison = left.padEnd(precision, '0').localeCompare(right.padEnd(precision, '0'));
  return comparison < 0 || (comparison === 0 && run.id < boundary.id);
}

export function AllocationRunHistoryPanel({ userId, scope }: Props) {
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
  const [page, setPage] = useState<AllocationRunHistoryDTO | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [run, setRun] = useState<AllocationRunV1DTO | null>(null);
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
      setRun(null);
      return 'Your admin session changed. Sign in as this administrator before retrying.';
    }
    return readingPage
      ? 'Could not verify this history page. Retry the same page or reload simulation history.'
      : 'Could not verify the selected capture. Retry its read to inspect the saved result.';
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
      setSelectedId(null);
      setRun(null);
      if (!request.after) setPage(null);
      try {
        await verifySession();
        if (token !== generation.current) return;
        const result = AllocationRunHistorySchema.parse(
          await listAllocationRuns({
            ...requestedScope(),
            ...(request.after ? { after: request.after } : {}),
          }),
        );
        if (token !== generation.current) return;
        const boundary = request.boundary;
        if (
          !matchesScope(result.scope) ||
          (request.after !== undefined &&
            (!boundary ||
              boundary.id !== request.after ||
              result.runs.some(
                (row) => row.id === request.after || !precedesBoundary(row, boundary),
              )))
        )
          throw new Error('History page does not match its scenario or paging boundary');
        await verifySession();
        if (token !== generation.current) return;
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

  const readRun = useCallback(
    async (id: string) => {
      if (busy.current) return;
      busy.current = true;
      const token = ++generation.current;
      setPending('detail');
      setSelectedId(id);
      setRun(null);
      setDetailError('');
      try {
        await verifySession();
        if (token !== generation.current) return;
        const result = AllocationRunV1Schema.parse(await getAllocationRun(id, requestedScope()));
        if (token !== generation.current) return;
        if (result.id !== id || !matchesScope(result.result.scope))
          throw new Error('Capture does not match the selected run and scenario');
        await verifySession();
        if (token !== generation.current) return;
        setRun(result);
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
      aria-label="Simulation run history"
      className="min-w-0 space-y-4 border-t border-gray-200 pt-6"
    >
      <div>
        <h3 className="text-lg font-semibold text-gray-900">Simulation run history</h3>
        <p className="mt-2 max-w-prose text-sm text-gray-600">
          Browse saved aggregate captures for {semester} {year}, newest stored first. Each page
          shows up to twenty captures. Loading older captures replaces this page; reload to see
          newer captures.
        </p>
      </div>
      <Button
        variant="secondary"
        className="min-h-11"
        disabled={pending !== null}
        onClick={() => void readPage()}
      >
        Reload simulation history
      </Button>
      {pending === 'page' && (
        <p role="status" className="text-sm text-gray-600">
          Loading simulation history…
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
            {page.runs.length} saved {page.runs.length === 1 ? 'capture' : 'captures'} on this page.
          </p>
          {page.runs.length === 0 ? (
            <p className="text-sm text-gray-700">No saved simulation captures for this scenario.</p>
          ) : (
            <ul
              aria-label="Saved captures"
              className="divide-y divide-gray-200 border-y border-gray-200"
            >
              {page.runs.map((row) => (
                <li
                  key={row.id}
                  className="flex min-w-0 flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0 space-y-1 text-sm">
                    <p className="font-medium text-gray-900">
                      Stored{' '}
                      <time dateTime={row.createdAt}>
                        {new Date(row.createdAt).toLocaleString()}
                      </time>
                    </p>
                    <p className="text-gray-600">
                      {row.result.resources
                        ? `Resource revision ${row.result.resources.resourceRevision}`
                        : 'Resource settings unknown'}{' '}
                      · {row.result.cohortStudentCount} students · {row.result.assignedStudentCount}{' '}
                      assigned in simulation
                    </p>
                    <p className="text-gray-600">
                      {row.result.noChoicesStudentCount} without choices ·{' '}
                      {row.result.capacityExhaustedStudentCount} capacity exhausted ·{' '}
                      {row.result.resourceUnknownStudentCount} unresolved resources
                    </p>
                  </div>
                  <Button
                    variant="secondary"
                    className="min-h-11 shrink-0 self-start sm:self-auto"
                    aria-label={`View capture stored ${new Date(row.createdAt).toLocaleString()}`}
                    aria-pressed={selectedId === row.id}
                    disabled={pending !== null}
                    onClick={() => void readRun(row.id)}
                  >
                    View capture
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
                void readPage({ after: page.nextAfter ?? undefined, boundary: page.runs.at(-1) })
              }
            >
              Load older captures
            </Button>
          )}
          {page.runs.length > 0 && page.nextAfter === null && (
            <p className="text-sm text-gray-600">No older captures.</p>
          )}
        </div>
      )}
      {pending === 'detail' && (
        <p role="status" className="text-sm text-gray-600">
          Loading selected capture…
        </p>
      )}
      {detailError && selectedId && (
        <div className="space-y-2">
          <p role="alert" className="max-w-prose text-sm text-red-700">
            {detailError}
          </p>
          <Button
            variant="secondary"
            className="min-h-11"
            disabled={pending !== null}
            onClick={() => void readRun(selectedId)}
          >
            Retry selected capture
          </Button>
        </div>
      )}
      {run && <CaptureDetail run={run} />}
    </section>
  );
}

function CaptureDetail({ run }: { run: AllocationRunV1DTO }) {
  const result = run.result;
  const resources = result.resources;
  return (
    <section
      aria-label="Selected simulation capture"
      className="min-w-0 space-y-4 border-t border-gray-200 pt-4"
    >
      <h4 className="font-semibold text-gray-900">Selected simulation capture</h4>
      <p className="max-w-prose text-sm text-gray-700">
        {result.curriculum.name} · {result.scope.semester} {result.scope.year}. Saved historical
        results; current settings and cohort changes do not update this capture.
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
        {resources
          ? `Captured resource revision ${resources.resourceRevision}. Professors: ${resources.professors}; classrooms: ${resources.classrooms}; lab rooms: ${resources.labRooms}; students per section: ${resources.maxStudentsPerSection}. Classroom blocks: ${resources.classroomTimeBlocks}; sections per professor: ${resources.sectionsPerProfessor}. ${result.usedSections} of ${resources.sharedSectionCeiling} shared sections opened, with a ${resources.sharedSeatCeiling}-seat ceiling.`
          : 'No resource settings were saved when this run was captured. Capacity remains unknown.'}
      </p>
      <p className="max-w-prose text-sm text-gray-600">
        Captured student utility: Bayesian difficulty fit{' '}
        {percent.format(result.utilityPolicy.difficultyFitWeight)}, immediate prerequisite unlocks{' '}
        {percent.format(result.utilityPolicy.immediateUnlockWeight)}. Allocation weights: student
        utility {percent.format(result.allocationPolicy.studentUtilityWeight)}, resource fit{' '}
        {percent.format(result.allocationPolicy.resourceFitWeight)}, fairness{' '}
        {percent.format(result.allocationPolicy.fairnessWeight)}; congestion threshold{' '}
        {percent.format(result.allocationPolicy.congestionThreshold)}. Recommendation limits:{' '}
        {result.recommendationPolicy.maxCredits} credits and{' '}
        {result.recommendationPolicy.maxDifficulty} difficulty.
      </p>
      <div className="space-y-2">
        <h5 className="text-sm font-semibold text-gray-900">Captured course outcomes</h5>
        {result.courses.length === 0 ? (
          <p className="text-sm text-gray-600">No course demand in this capture.</p>
        ) : (
          <ul className="divide-y divide-gray-200 text-sm">
            {result.courses.map((course) => (
              <li key={course.id} className="space-y-1 py-2">
                <p className="break-words font-medium text-gray-900">
                  {course.code} · {course.name}
                </p>
                <p className="text-gray-600">
                  {course.demandStudentCount} students with demand · {course.assignedStudentCount}{' '}
                  assigned in simulation · {course.openedSections} sections · {course.seatCapacity}{' '}
                  seats ·{' '}
                  {course.seatUtilization === null
                    ? 'seat utilization unknown'
                    : `${percent.format(course.seatUtilization)} seat utilization`}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
      <p className="max-w-prose text-sm text-gray-600">
        One course per student in one simulated round; no full-semester allocation or student
        assignments are stored. Category, grade-fit and graduation-timeline personalization remain
        unavailable. Labs, course overrides, professor availability and qualifications, timetable
        and official offerings remain unverified.
      </p>
    </section>
  );
}
