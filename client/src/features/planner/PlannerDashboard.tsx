import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { isAxiosError } from 'axios';
import type { CurriculumSemesterPreviewDTO, PlanSemesterDTO } from '@iu-study-planner/shared';
import { Button } from '@/components/ui';
import {
  getCourses,
  getCurrentStudentProgress,
  getCurriculumSemesterPreview,
  getSession,
} from '@/lib/api';
import type { Course } from '@/types';
import { Recommendations } from '../recommendations/Recommendations';
import { WorkloadAnalyzer } from './WorkloadAnalyzer';
import { CurriculumPlannerPreview } from './CurriculumPlannerPreview';
import { OwnSemesterAllocationHistoryPanel } from './OwnSemesterAllocationHistoryPanel';

type IntensityMode = PlanSemesterDTO['intensityMode'];
type PlannerIdentity = { ownerId: string; key: string; request: number };
type PlannerState =
  | (PlannerIdentity & { status: 'loading'; assigned: boolean })
  | (PlannerIdentity & { status: 'error'; missingCourses: boolean; assigned: boolean })
  | (PlannerIdentity & { status: 'ready'; kind: 'legacy'; courses: Course[]; revision: number })
  | (PlannerIdentity & { status: 'ready'; kind: 'context'; preview: CurriculumSemesterPreviewDTO });

const curriculumIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

class MissingPlannedCoursesError extends Error {}

export function PlannerDashboard({ userId }: { userId: string }) {
  const [invalidOwner, setInvalidOwner] = useState<string | null>(null);
  const [intensityMode, setIntensityMode] = useState<IntensityMode>('normal');
  const requestKey = JSON.stringify([userId, intensityMode]);
  const [state, setState] = useState<PlannerState>({
    ownerId: userId,
    key: requestKey,
    request: 0,
    status: 'loading',
    assigned: false,
  });
  const generation = useRef(0);
  const revision = useRef(0);
  const mounted = useRef(false);
  const owner = useRef(userId);
  const identity = useRef(requestKey);
  const assignedOwner = useRef<string | null>(null);
  const pending = useRef<{ key: string; generation: number; promise: Promise<void> } | null>(null);
  if (owner.current !== userId) assignedOwner.current = null;
  owner.current = userId;
  if (identity.current !== requestKey) {
    identity.current = requestKey;
    generation.current++;
    pending.current = null;
  }

  const reload = useCallback((): Promise<void> => {
    if (!mounted.current || identity.current !== requestKey) return Promise.resolve();
    if (pending.current?.key === requestKey && pending.current.generation === generation.current)
      return pending.current.promise;
    const request = ++generation.current;
    setState({
      ownerId: userId,
      key: requestKey,
      request,
      status: 'loading',
      assigned: assignedOwner.current === userId,
    });
    const isCurrent = () =>
      mounted.current && identity.current === requestKey && request === generation.current;
    const promise = (async () => {
      let checkingAccount = true;
      try {
        // Cached session metadata cannot choose the scope of a fresh planner read.
        const session = await Promise.resolve().then(() => getSession());
        if (!isCurrent()) return;
        if (!session || session.id !== userId) {
          setInvalidOwner(userId);
          throw new Error('Session owner unavailable');
        }
        checkingAccount = false;
        setInvalidOwner(null);
        if (
          !session ||
          session.id !== userId ||
          !(
            session.curriculumId === null ||
            (typeof session.curriculumId === 'string' &&
              curriculumIdPattern.test(session.curriculumId))
          )
        ) {
          throw new Error('Session scope unavailable');
        }
        if (session.curriculumId !== null) {
          assignedOwner.current = userId;
          setState({
            ownerId: userId,
            key: requestKey,
            request,
            status: 'loading',
            assigned: true,
          });
          const preview = await getCurriculumSemesterPreview(intensityMode, session.curriculumId);
          if (!isCurrent()) return;
          setState({
            ownerId: userId,
            key: requestKey,
            request,
            status: 'ready',
            kind: 'context',
            preview,
          });
          return;
        }
        assignedOwner.current = null;
        // Anonymous browser selections are never evidence of confirmed account selections.
        const [progress, catalog] = await Promise.all([
          Promise.resolve().then(() => getCurrentStudentProgress()),
          Promise.resolve().then(() => getCourses()),
        ]);
        if (!isCurrent()) return;
        if (
          !catalog.success ||
          !Array.isArray(catalog.data) ||
          !Array.isArray(progress.plannedIds) ||
          !progress.plannedIds.every((id: unknown) => typeof id === 'string' && id.length > 0)
        )
          throw new Error('Planner data unavailable');
        const courseById = new Map<string, Course>();
        for (const course of catalog.data) {
          if (typeof course.id !== 'string' || !course.id || courseById.has(course.id))
            throw new Error('Ambiguous course catalog');
          courseById.set(course.id, course);
        }
        const courses = [...new Set(progress.plannedIds)].map((id) => {
          const course = courseById.get(id);
          if (!course) throw new MissingPlannedCoursesError();
          return course;
        });
        setState({
          ownerId: userId,
          key: requestKey,
          request,
          status: 'ready',
          kind: 'legacy',
          courses,
          revision: ++revision.current,
        });
      } catch (error) {
        if (
          isCurrent() &&
          checkingAccount &&
          isAxiosError(error) &&
          (error.response?.status === 401 || error.response?.status === 403)
        )
          setInvalidOwner(userId);
        if (isCurrent())
          setState({
            ownerId: userId,
            key: requestKey,
            request,
            status: 'error',
            missingCourses: error instanceof MissingPlannedCoursesError,
            assigned: assignedOwner.current === userId,
          });
      } finally {
        if (pending.current?.generation === request) pending.current = null;
      }
    })();
    pending.current = { key: requestKey, generation: request, promise };
    return promise;
  }, [userId, intensityMode, requestKey]);

  const invalidatePending = useCallback(() => {
    mounted.current = false;
    generation.current++;
    pending.current = null;
  }, []);

  useEffect(() => {
    mounted.current = true;
    void reload();
    const onFocus = () => void reload();
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void reload();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
      invalidatePending();
    };
  }, [reload, invalidatePending]);

  const current: PlannerState =
    state.ownerId === userId && state.key === requestKey && state.request === generation.current
      ? state
      : {
          ownerId: userId,
          key: requestKey,
          request: generation.current,
          status: 'loading',
          assigned: assignedOwner.current === userId,
        };
  const assigned = current.status === 'ready' ? current.kind === 'context' : current.assigned;
  const changeIntensity = (value: string) => {
    if (
      current.status === 'loading' ||
      !mounted.current ||
      identity.current !== requestKey ||
      !(value === 'low' || value === 'normal' || value === 'high' || value === 'max') ||
      value === intensityMode
    )
      return;
    generation.current++;
    pending.current = null;
    setIntensityMode(value);
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Planner</h2>
          <p className="mt-2 max-w-prose text-sm text-gray-600">
            {assigned
              ? 'Review your saved planned courses in the assigned reference curriculum. This preview is read-only.'
              : 'Review the workload of your saved planned courses and explore personalized course suggestions. Suggestions are read-only here. Update your course selections in My curriculum.'}
          </p>
        </div>
        <Button
          type="button"
          variant="secondary"
          className="min-h-11"
          disabled={current.status === 'loading'}
          onClick={() => void reload()}
        >
          Reload planner
        </Button>
      </header>
      {assigned && (
        <div className="flex flex-wrap items-center gap-3">
          <label htmlFor="planner-intensity" className="text-sm font-semibold text-gray-900">
            Planning intensity
          </label>
          <select
            id="planner-intensity"
            value={intensityMode}
            disabled={current.status === 'loading'}
            onChange={(event) => changeIntensity(event.target.value)}
            className="min-h-11 max-w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-base text-gray-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-700 disabled:opacity-50"
          >
            <option value="low">Low · up to 9 credits per slot</option>
            <option value="normal">Normal · up to 15 credits per slot</option>
            <option value="high">High · up to 21 credits per slot</option>
            <option value="max">Maximum · up to 24 credits per slot</option>
          </select>
        </div>
      )}
      {current.status === 'loading' ? (
        <p role="status" className="text-gray-600">
          Loading your saved planned courses…
        </p>
      ) : current.status === 'error' ? (
        <div>
          <p role="alert" className="text-red-700">
            {current.missingCourses
              ? 'Some saved planned courses are missing from the current catalog. Reload the planner to try again, or review your selections in My curriculum.'
              : 'Could not load your saved planned courses. Check your connection and reload the planner.'}
          </p>
          {!assigned && (
            <Link
              to="/curriculum"
              className="mt-3 inline-flex min-h-11 items-center text-sm font-semibold text-primary-700 underline underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-700"
            >
              Open My curriculum
            </Link>
          )}
        </div>
      ) : current.kind === 'context' ? (
        <CurriculumPlannerPreview preview={current.preview} />
      ) : (
        <>
          {current.courses.length === 0 ? (
            <section
              aria-label="Saved planned courses"
              className="rounded-xl border border-gray-200 bg-white p-5"
            >
              <h3 className="text-lg font-semibold text-gray-900">No courses are planned yet</h3>
              <p className="mt-2 text-sm text-gray-700">
                Mark courses as planned in My curriculum, then return here to estimate their
                combined workload.
              </p>
              <Link
                to="/curriculum"
                className="mt-3 inline-flex min-h-11 items-center text-sm font-semibold text-primary-700 underline underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-700"
              >
                Open My curriculum
              </Link>
            </section>
          ) : (
            <WorkloadAnalyzer
              key={`workload:${userId}:${current.revision}`}
              selectedCourses={current.courses}
            />
          )}
          <Recommendations key={`recommendations:${userId}:${current.revision}`} userId={userId} />
        </>
      )}
      <OwnSemesterAllocationHistoryPanel ownerId={userId} blocked={invalidOwner === userId} />
    </div>
  );
}
