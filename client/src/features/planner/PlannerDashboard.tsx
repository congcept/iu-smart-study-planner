import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui';
import { getCourses, getCurrentStudentProgress } from '@/lib/api';
import type { Course } from '@/types';
import { Recommendations } from '../recommendations/Recommendations';
import { WorkloadAnalyzer } from './WorkloadAnalyzer';

type PlannerState =
  | { ownerId: string; status: 'loading' }
  | { ownerId: string; status: 'error'; missingCourses: boolean }
  | { ownerId: string; status: 'ready'; courses: Course[]; revision: number };

class MissingPlannedCoursesError extends Error {}

export function PlannerDashboard({ userId }: { userId: string }) {
  const [state, setState] = useState<PlannerState>({ ownerId: userId, status: 'loading' });
  const generation = useRef(0);
  const revision = useRef(0);
  const mounted = useRef(false);
  const owner = useRef(userId);
  const pending = useRef<{ ownerId: string; generation: number; promise: Promise<void> } | null>(
    null,
  );
  owner.current = userId;

  const reload = useCallback((): Promise<void> => {
    if (!mounted.current || owner.current !== userId) return Promise.resolve();
    if (pending.current?.ownerId === userId && pending.current.generation === generation.current)
      return pending.current.promise;
    const request = ++generation.current;
    setState({ ownerId: userId, status: 'loading' });
    const isCurrent = () =>
      mounted.current && owner.current === userId && request === generation.current;
    const promise = (async () => {
      try {
        // Read saved selections directly, including on a direct visit to /planner.
        // Browser-cached curriculum state is not evidence of confirmed selections.
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
        const plannedIds = [...new Set(progress.plannedIds)];
        const courses = plannedIds.map((id) => {
          const course = courseById.get(id);
          if (!course) throw new MissingPlannedCoursesError();
          return course;
        });
        setState({ ownerId: userId, status: 'ready', courses, revision: ++revision.current });
      } catch (error) {
        if (isCurrent())
          setState({
            ownerId: userId,
            status: 'error',
            missingCourses: error instanceof MissingPlannedCoursesError,
          });
      } finally {
        if (pending.current?.generation === request) pending.current = null;
      }
    })();
    pending.current = { ownerId: userId, generation: request, promise };
    return promise;
  }, [userId]);

  const invalidatePending = useCallback(() => {
    mounted.current = false;
    generation.current++;
    pending.current = null;
  }, []);

  useEffect(() => {
    mounted.current = true;
    void reload();
    return invalidatePending;
  }, [reload, invalidatePending]);

  const current: PlannerState =
    state.ownerId === userId ? state : { ownerId: userId, status: 'loading' };

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Planner</h2>
          <p className="mt-2 max-w-prose text-sm text-gray-600">
            Review the workload of your saved planned courses and explore personalized course
            suggestions. Suggestions are read-only here. Update your course selections in My
            curriculum.
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
          <Link
            to="/curriculum"
            className="mt-3 inline-flex min-h-11 items-center text-sm font-semibold text-primary-700 underline underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-700"
          >
            Open My curriculum
          </Link>
        </div>
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
    </div>
  );
}
