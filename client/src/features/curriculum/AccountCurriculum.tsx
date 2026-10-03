import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { CurriculumDetailDTO } from '@iu-study-planner/shared';
import { Button } from '@/components/ui';
import { getSession } from '@/lib/api';
import { getCurriculumReference } from '@/lib/curriculumApi';
import { CurriculumProgressMap } from './CurriculumProgressMap';
import { CurriculumReference } from './CurriculumReference';

type State = { ownerId: string; request: number } & (
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; curriculum: CurriculumDetailDTO | null }
);

/** Only an explicit, fresh null account context can mount the legacy editable map. */
export function AccountCurriculum({ userId }: { userId: string }) {
  const [state, setState] = useState<State>({ ownerId: userId, request: 0, status: 'loading' });
  const generation = useRef(0);
  const owner = useRef(userId);
  const mounted = useRef(false);
  const pending = useRef<{ request: number; ownerId: string; promise: Promise<void> } | null>(null);
  if (owner.current !== userId) {
    generation.current++;
    pending.current = null;
  }
  owner.current = userId;

  const reload = useCallback((): Promise<void> => {
    if (!mounted.current || owner.current !== userId) return Promise.resolve();
    if (pending.current?.ownerId === userId && pending.current.request === generation.current)
      return pending.current.promise;
    const request = ++generation.current;
    setState({ ownerId: userId, request, status: 'loading' });
    const current = () =>
      mounted.current && owner.current === userId && generation.current === request;
    const promise = (async () => {
      try {
        const session = await Promise.resolve().then(getSession);
        if (!current()) return;
        if (
          session.id !== userId ||
          !(
            session.curriculumId === null ||
            (typeof session.curriculumId === 'string' &&
              /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
                session.curriculumId,
              ))
          )
        )
          throw new Error('Current curriculum scope unavailable');
        const curriculum =
          session.curriculumId === null ? null : await getCurriculumReference(session.curriculumId);
        if (!current()) return;
        if (curriculum && curriculum.id.toLowerCase() !== session.curriculumId?.toLowerCase())
          throw new Error('Wrong curriculum reference');
        // An account/context change during the public reference read must not publish old data.
        if (curriculum) {
          const confirmed = await getSession();
          if (!current()) return;
          if (
            confirmed.id !== userId ||
            confirmed.curriculumId?.toLowerCase() !== curriculum.id.toLowerCase()
          )
            throw new Error('Curriculum scope changed');
        }
        setState({ ownerId: userId, request, status: 'ready', curriculum });
      } catch {
        if (current()) setState({ ownerId: userId, request, status: 'error' });
      } finally {
        if (pending.current?.request === request) pending.current = null;
      }
    })();
    pending.current = { ownerId: userId, request, promise };
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
    const refresh = () => void reload();
    const refreshVisible = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refreshVisible);
    return () => {
      invalidatePending();
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refreshVisible);
    };
  }, [reload, invalidatePending]);

  const visible =
    state.ownerId === userId && state.request === generation.current
      ? state
      : { ownerId: userId, request: generation.current, status: 'loading' as const };
  if (visible.status === 'ready' && visible.curriculum === null)
    return <CurriculumProgressMap key={`${userId}:${visible.request}`} userId={userId} />;
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">My curriculum</h2>
          <p className="mt-2 max-w-prose text-sm text-gray-600">
            Review the reference curriculum attached to your account.
          </p>
        </div>
        <Button
          variant="secondary"
          className="min-h-11"
          disabled={visible.status === 'loading'}
          onClick={() => void reload()}
        >
          Reload curriculum
        </Button>
      </header>
      {visible.status === 'loading' ? (
        <p role="status" className="text-gray-600">
          Loading your curriculum…
        </p>
      ) : visible.status === 'error' ? (
        <p role="alert" className="text-red-700">
          Could not confirm your curriculum. Check your connection and reload.
        </p>
      ) : (
        <>
          {visible.curriculum && <CurriculumReference curriculum={visible.curriculum} />}
          <Link
            to="/planner"
            className="inline-flex min-h-11 items-center font-semibold text-primary-700 underline"
          >
            Review saved courses in Planner
          </Link>
        </>
      )}
    </div>
  );
}
