import { useCallback, useEffect, useRef, useState } from 'react';
import { isAxiosError } from 'axios';
import {
  OwnStudyPlansSchema,
  type OwnStudyPlanMetadataDTO,
  type OwnStudyPlansDTO,
} from '@iu-study-planner/shared';
import { Button, Card, EmptyState, ErrorBanner, PaginationFooter } from '@/components/ui';
import { useFocusAfterDisable } from '@/lib/useFocusAfterDisable';
import {
  isOlderSavedStudyPlan,
  listSavedStudyPlans,
  SavedStudyPlansSessionChangedError,
} from '@/lib/savedStudyPlansApi';
import { SavedStudyPlanSemestersPanel } from './SavedStudyPlanSemestersPanel';

type Request = { after?: string; boundary?: OwnStudyPlanMetadataDTO; curriculumId?: string | null };
type State =
  | { status: 'loading' }
  | { status: 'error'; account: boolean; cursor: boolean }
  | { status: 'selected'; planId: string; curriculumId: string | null }
  | { status: 'ready'; page: OwnStudyPlansDTO };

function SavedStudyPlansBody({ ownerId }: { ownerId: string }) {
  const [state, setState] = useState<State>({ status: 'loading' });
  const generation = useRef(0);
  const mounted = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const lastRequest = useRef<Request>({});
  const heading = useRef<HTMLHeadingElement>(null);
  const focusOnReturn = useRef(false);
  const rememberFocus = useFocusAfterDisable(state.status === 'loading');
  const isSelected = state.status === 'selected';

  useEffect(() => {
    if (!isSelected && focusOnReturn.current) {
      heading.current?.focus();
      focusOnReturn.current = false;
    }
  }, [isSelected]);

  const read = useCallback(
    async (input: Request) => {
      if (!mounted.current) return;
      // Snapshot the confirmed cursor before awaiting any session or network work.
      const request: Request = JSON.parse(JSON.stringify(input)) as Request;
      lastRequest.current = request;
      controller.current?.abort();
      const active = new AbortController();
      controller.current = active;
      const current = ++generation.current;
      const isCurrent = () =>
        mounted.current && generation.current === current && !active.signal.aborted;
      setState({ status: 'loading' });
      try {
        const received = await listSavedStudyPlans(
          ownerId,
          request.after ? { after: request.after } : {},
          {
            boundary: request.boundary,
            expectedCurriculumId: request.curriculumId,
            signal: active.signal,
          },
        );
        if (!isCurrent()) return;
        const page = OwnStudyPlansSchema.parse(received);
        if (
          page.scope.userId !== ownerId ||
          page.after !== (request.after ?? null) ||
          (request.curriculumId !== undefined &&
            page.scope.curriculumId !== request.curriculumId) ||
          (request.boundary &&
            page.plans.some((plan) => !isOlderSavedStudyPlan(plan, request.boundary!)))
        )
          throw new Error('Saved study plan page does not match the requested scope');
        setState({ status: 'ready', page });
      } catch (error) {
        if (!isCurrent()) return;
        const status = isAxiosError(error) ? error.response?.status : undefined;
        setState({
          status: 'error',
          account:
            error instanceof SavedStudyPlansSessionChangedError || status === 401 || status === 403,
          cursor: status === 409,
        });
      }
    },
    [ownerId],
  );

  const invalidate = useCallback(() => {
    mounted.current = false;
    generation.current++;
    controller.current?.abort();
  }, []);

  useEffect(() => {
    mounted.current = true;
    void read({});
    const refresh = () => void read({});
    const visible = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', visible);
    return () => {
      invalidate();
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [read, invalidate]);

  const returnToList = useCallback(() => {
    focusOnReturn.current = true;
    void read({});
  }, [read]);

  const renderGeneration = generation.current;

  if (state.status === 'selected')
    return (
      <SavedStudyPlanSemestersPanel
        ownerId={ownerId}
        planId={state.planId}
        expectedCurriculumId={state.curriculumId}
        onBack={returnToList}
      />
    );

  const pending = state.status === 'loading';
  return (
    <Card as="section" variant="panel" aria-label="Your saved study plans">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h3 ref={heading} tabIndex={-1} className="text-lg font-semibold text-gray-900">
            Your saved study plans
          </h3>
          <p className="mt-2 max-w-prose text-sm text-gray-700">
            Saved references from your account, newest first. Their courses and semesters have not
            been verified against your current curriculum, prerequisites, GPA or a timetable. A
            previous active choice does not confirm a valid schedule.
          </p>
        </div>
        <Button
          type="button"
          variant="secondary"
          className="min-h-11"
          disabled={pending}
          onClick={() => {
            rememberFocus();
            void read({});
          }}
        >
          Reload saved plans
        </Button>
      </div>
      {pending && (
        <p role="status" className="mt-4 text-sm text-gray-600">
          Loading your saved study plans…
        </p>
      )}
      {state.status === 'error' && (
        <div className="mt-4">
          <ErrorBanner>
            {state.account
              ? 'Your account or curriculum could not be confirmed. Sign in to this account and reload saved plans.'
              : state.cursor
                ? 'This saved-plan page is no longer available. Reload saved plans to return to the latest references.'
                : 'Could not confirm your saved study plans. Retry this read or reload the latest references.'}
          </ErrorBanner>
          {!state.account && !state.cursor && (
            <Button
              type="button"
              variant="secondary"
              className="mt-3 min-h-11"
              onClick={() => void read(lastRequest.current)}
            >
              Retry saved plans
            </Button>
          )}
        </div>
      )}
      {state.status === 'ready' && (
        <div className="mt-4 space-y-4">
          {state.page.plans.length === 0 ? (
            <EmptyState>
              {state.page.after
                ? 'No older saved study plans are available.'
                : 'No saved study plans for your account yet.'}
            </EmptyState>
          ) : (
            <ul className="divide-y divide-gray-200">
              {state.page.plans.map((plan, index) => (
                <li key={plan.id} className="space-y-2 py-3 text-sm text-gray-700">
                  <h4 className="break-words font-semibold text-gray-900">{plan.name}</h4>
                  {plan.description && (
                    <p className="whitespace-pre-wrap break-words">{plan.description}</p>
                  )}
                  <p>
                    {plan.isActive ? 'Previously marked active' : 'Previous saved plan'} ·{' '}
                    {plan.semesterCount} saved {plan.semesterCount === 1 ? 'semester' : 'semesters'}
                  </p>
                  <p>
                    Saved{' '}
                    <time dateTime={plan.createdAt}>
                      {new Date(plan.createdAt).toLocaleString()}
                    </time>
                  </p>
                  <p>
                    Updated{' '}
                    <time dateTime={plan.updatedAt}>
                      {new Date(plan.updatedAt).toLocaleString()}
                    </time>
                  </p>
                  <Button
                    type="button"
                    variant="secondary"
                    className="min-h-11"
                    aria-label={`View semesters for ${plan.name || 'Unnamed saved plan'} (plan ${index + 1})`}
                    onClick={() => {
                      if (!mounted.current || generation.current !== renderGeneration) return;
                      generation.current++;
                      controller.current?.abort();
                      setState({
                        status: 'selected',
                        planId: plan.id,
                        curriculumId: state.page.scope.curriculumId,
                      });
                    }}
                  >
                    View semesters
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <PaginationFooter
            next={
              state.page.nextAfter
                ? {
                    label: 'Older saved plans',
                    onClick: () =>
                      void read({
                        after: state.page.nextAfter!,
                        boundary: state.page.plans.at(-1),
                        curriculumId: state.page.scope.curriculumId,
                      }),
                  }
                : undefined
            }
          />
          {state.page.after && (
            <Button
              type="button"
              variant="secondary"
              className="min-h-11"
              onClick={() => void read({})}
            >
              Latest saved plans
            </Button>
          )}
        </div>
      )}
    </Card>
  );
}

export function SavedStudyPlansPanel({
  ownerId,
  blocked = false,
}: {
  ownerId: string;
  blocked?: boolean;
}) {
  if (blocked)
    return (
      <Card as="section" variant="panel" aria-label="Your saved study plans">
        <h3 className="text-lg font-semibold text-gray-900">Your saved study plans</h3>
        <ErrorBanner className="mt-3 text-sm text-red-700">
          Sign in as this account to read your saved study plans.
        </ErrorBanner>
      </Card>
    );
  return <SavedStudyPlansBody key={ownerId.toLowerCase()} ownerId={ownerId.toLowerCase()} />;
}
