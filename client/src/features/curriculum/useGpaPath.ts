import { useCallback, useEffect, useRef, useState } from 'react';
import { getStudentGrades } from '@/lib/gradesApi';

type GpaMode = 'above' | 'below';
type GpaPathState = {
  ownerId: string | null;
  status: 'loading' | 'error' | 'ready';
  mode: GpaMode | null;
  manual: boolean;
  gpa100: number | null;
  missingGradeCount: number;
};
type GpaSnapshot = { mode: GpaMode | null; gpa100: number | null; missingGradeCount: number };

function initialState(ownerId: string | null): GpaPathState {
  return {
    ownerId,
    status: ownerId ? 'loading' : 'ready',
    mode: ownerId ? null : 'above',
    manual: ownerId === null,
    gpa100: null,
    missingGradeCount: 0,
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseSnapshot(value: unknown): GpaSnapshot {
  if (!isObject(value) || !isObject(value.summary)) throw new Error('Invalid GPA summary');
  const { gpaPath, gpa100, gradedCredits, gradedCourseCount } = value.summary;
  if (
    (gpaPath !== null && gpaPath !== 'THESIS' && gpaPath !== 'ALTERNATIVE') ||
    (gpa100 !== null &&
      (typeof gpa100 !== 'number' || !Number.isFinite(gpa100) || gpa100 < 0 || gpa100 > 100)) ||
    typeof gradedCredits !== 'number' ||
    !Number.isSafeInteger(gradedCredits) ||
    gradedCredits < 0 ||
    typeof gradedCourseCount !== 'number' ||
    !Number.isSafeInteger(gradedCourseCount) ||
    gradedCourseCount < 0 ||
    (gpaPath === null
      ? gpa100 !== null || gradedCredits !== 0 || gradedCourseCount !== 0
      : gpa100 === null || gradedCredits === 0 || gradedCourseCount === 0)
  ) {
    throw new Error('Invalid GPA summary');
  }
  const missing = value.completedCoursesWithoutNumericGrades;
  if (
    !Array.isArray(missing) ||
    !missing.every((id: unknown) => typeof id === 'string' && id.length > 0) ||
    new Set(missing).size !== missing.length
  ) {
    throw new Error('Invalid grade coverage');
  }
  return {
    // A serialized number can round to 70 even when the server's exact decimal
    // result is above it. Eligibility comes from the server path, never this number.
    mode: gpaPath === null ? null : gpaPath === 'THESIS' ? 'above' : 'below',
    gpa100,
    missingGradeCount: missing.length,
  };
}

export function useGpaPath(userId?: string) {
  const ownerId = userId ?? null;
  const [state, setState] = useState<GpaPathState>(() => initialState(ownerId));
  const generation = useRef(0);
  const owner = useRef(ownerId);
  const mounted = useRef(false);
  const pending = useRef<{ ownerId: string; generation: number; promise: Promise<void> } | null>(
    null,
  );
  // Update the guard during rendering: an old promise must not apply even in
  // the interval between an account change and effect cleanup.
  owner.current = ownerId;

  const reload = useCallback((): Promise<void> => {
    if (!userId || !mounted.current || owner.current !== userId) return Promise.resolve();
    if (pending.current?.ownerId === userId && pending.current.generation === generation.current)
      return pending.current.promise;
    const request = ++generation.current;
    setState((current) => ({
      ...initialState(userId),
      // Keep the last manual choice internally during a reload, but hide it until
      // a fresh explicit null confirms that manual choice is still appropriate.
      mode: current.ownerId === userId && current.manual ? current.mode : null,
      manual: current.ownerId === userId && current.manual,
    }));
    const isCurrent = () =>
      mounted.current && owner.current === userId && generation.current === request;
    const promise = (async () => {
      try {
        // Defer invocation so even a synchronous adapter failure cannot settle
        // before the pending-request reference is installed.
        const snapshot = parseSnapshot(await Promise.resolve().then(getStudentGrades));
        if (isCurrent())
          setState((current) => ({
            ownerId: userId,
            status: 'ready',
            mode:
              snapshot.mode ??
              (current.ownerId === userId && current.manual ? (current.mode ?? 'above') : 'above'),
            manual: snapshot.mode === null,
            gpa100: snapshot.gpa100,
            missingGradeCount: snapshot.missingGradeCount,
          }));
      } catch {
        if (isCurrent()) setState({ ...initialState(userId), status: 'error' });
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
    if (userId) void reload();
    else setState((current) => (current.ownerId === null ? current : initialState(null)));
    const refresh = () => {
      void reload();
    };
    const refreshVisible = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    if (userId) {
      window.addEventListener('focus', refresh);
      document.addEventListener('visibilitychange', refreshVisible);
    }
    return () => {
      invalidatePending();
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refreshVisible);
    };
  }, [userId, reload, invalidatePending]);

  const selectManual = useCallback(
    (mode: GpaMode) => {
      if (!mounted.current || owner.current !== ownerId) return;
      setState((current) =>
        current.ownerId === ownerId && current.status === 'ready' && current.manual
          ? { ...current, mode }
          : current,
      );
    },
    [ownerId],
  );

  const visible = state.ownerId === ownerId ? state : initialState(ownerId);
  return {
    status: visible.status,
    mode: visible.status === 'ready' ? visible.mode : null,
    manual: visible.status === 'ready' && visible.manual,
    gpa100: visible.status === 'ready' ? visible.gpa100 : null,
    missingGradeCount: visible.status === 'ready' ? visible.missingGradeCount : 0,
    reload,
    selectManual,
  };
}
