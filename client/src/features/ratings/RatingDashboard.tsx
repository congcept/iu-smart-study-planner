import { isAxiosError } from 'axios';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { z } from 'zod';
import {
  RateCourseSchema,
  RatingCourseChoicesSchema,
  ScopedOwnCourseRatingsSchema,
  type AccountWriteScopeDTO,
  type RatingCourseChoiceDTO,
} from '@iu-study-planner/shared';
import { Button } from '@/components/ui';
import { getRatingCourseChoices, getScopedOwnRatings, rateCourse } from '@/lib/ratingsApi';
import { CourseRatingBadge } from '../curriculum/CourseRatingBadge';

const PendingVote = RateCourseSchema.extend({
  courseId: z
    .string()
    .uuid()
    .transform((id) => id.toLowerCase()),
}).strict();
type Vote = z.infer<typeof PendingVote>;
const journalKey = (userId: string) => `pending_course_rating:${userId}`;
const sameScope = (
  left: AccountWriteScopeDTO | null | undefined,
  right: AccountWriteScopeDTO | null | undefined,
) => !!left && !!right && left.userId === right.userId && left.curriculumId === right.curriculumId;
class RatingScopeChanged extends Error {}

export function RatingDashboard({ userId }: { userId: string }) {
  const owner = userId.toLowerCase();
  return <RatingSession key={owner} userId={owner} />;
}
function RatingSession({ userId }: { userId: string }) {
  const [journal] = useState(() => {
    try {
      const raw = sessionStorage.getItem(journalKey(userId));
      return { vote: raw ? PendingVote.parse(JSON.parse(raw)) : null, error: false };
    } catch {
      return { vote: null, error: true };
    }
  });
  const invalidJournal = useRef(journal.error);
  const pending = useRef<Vote | null>(journal.vote);
  const scope = useRef<AccountWriteScopeDTO | null>(null);
  const generation = useRef(0);
  const busy = useRef(false);
  const courseSelect = useRef<HTMLSelectElement>(null);
  const [courses, setCourses] = useState<RatingCourseChoiceDTO[]>([]);
  const [courseId, setCourseId] = useState(journal.vote?.courseId ?? '');
  const [rating, setRating] = useState(journal.vote ? String(journal.vote.rating) : '');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [phase, setPhase] = useState<'idle' | 'saving' | 'retry' | 'blocked'>(
    journal.error ? 'blocked' : journal.vote ? 'retry' : 'idle',
  );
  const [message, setMessage] = useState(
    journal.error
      ? 'Browser recovery data is unavailable. Clear this tab’s pending retry before saving a rating.'
      : journal.vote
        ? 'A previous save is unconfirmed. Check the saved rating or retry the same request.'
        : '',
  );

  const load = useCallback(async () => {
    if (busy.current) return;
    const token = ++generation.current;
    scope.current = null;
    setCourses([]);
    setLoading(true);
    setLoadError(false);
    try {
      const snapshot = RatingCourseChoicesSchema.parse(await getRatingCourseChoices(userId));
      if (token !== generation.current) return;
      if (snapshot.scope.userId !== userId) throw new Error('Wrong owner');
      const vote = pending.current;
      if (
        invalidJournal.current ||
        (vote && (!vote.expectedScope || vote.expectedScope.userId !== userId))
      ) {
        setPhase('blocked');
        setMessage(
          'This tab’s pending retry has no verified account context. Clear the pending retry before starting a new rating.',
        );
        return;
      }
      if (vote && !sameScope(vote.expectedScope, snapshot.scope)) {
        setPhase('blocked');
        setMessage(
          'Your curriculum context changed. The previous rating has not been retried. Check its saved status or clear this tab’s pending retry.',
        );
        return;
      }
      scope.current = snapshot.scope;
      setCourses(snapshot.courses);
      if (vote) {
        const eligible = snapshot.courses.some((course) => course.id === vote.courseId);
        setPhase(eligible ? 'retry' : 'blocked');
        if (!eligible)
          setMessage(
            'This course is no longer completed. Check whether the previous rating was saved, or clear this tab’s pending retry.',
          );
      } else setPhase('idle');
    } catch {
      if (token === generation.current) setLoadError(true);
    } finally {
      if (token === generation.current) setLoading(false);
    }
  }, [userId]);
  useEffect(() => {
    const activeGeneration = generation;
    void load();
    const refresh = () => {
      if (document.visibilityState !== 'hidden') void load();
    };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      activeGeneration.current++;
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [load]);
  useEffect(() => {
    if (phase === 'idle' && !loading && message.startsWith('Rating saved'))
      courseSelect.current?.focus();
  }, [phase, loading, message]);

  const confirm = async (payload: Vote, token: number) => {
    const saved = ScopedOwnCourseRatingsSchema.parse(await getScopedOwnRatings(userId));
    if (token !== generation.current) return false;
    if (saved.scope.userId !== userId || !sameScope(payload.expectedScope, saved.scope))
      throw new RatingScopeChanged();
    if (
      !saved.ratings.some(
        (vote) => vote.courseId === payload.courseId && vote.rating === payload.rating,
      )
    )
      return false;
    sessionStorage.removeItem(journalKey(userId));
    pending.current = null;
    invalidJournal.current = false;
    scope.current = null;
    setCourses([]);
    setPhase('idle');
    setMessage('Rating saved. Saving again updates your one vote for this course.');
    return true;
  };
  const scopeChanged = () => {
    scope.current = null;
    setCourses([]);
    setPhase('blocked');
    setMessage(
      'Your curriculum context changed. The previous rating has not been retried. Check its saved status or clear this tab’s pending retry.',
    );
  };
  const checkSaved = async () => {
    const payload = pending.current;
    if (busy.current || !payload?.expectedScope || payload.expectedScope.userId !== userId) return;
    busy.current = true;
    setPhase('saving');
    setMessage('Checking your saved rating…');
    const token = generation.current;
    let refresh = false;
    try {
      refresh = await confirm(payload, token);
      if (token !== generation.current) return;
      if (!refresh) {
        setPhase(
          scope.current &&
            sameScope(scope.current, payload.expectedScope) &&
            courses.some((course) => course.id === payload.courseId)
            ? 'retry'
            : 'blocked',
        );
        setMessage('The requested rating is not confirmed. The pending retry is preserved.');
      }
    } catch (error) {
      if (token !== generation.current) return;
      if (error instanceof RatingScopeChanged) {
        scopeChanged();
        refresh = true;
      } else {
        scope.current = null;
        setCourses([]);
        setPhase('blocked');
        refresh = true;
        setMessage(
          'Could not confirm the saved rating or clear its recovery data. Reload or check the saved rating again.',
        );
      }
    } finally {
      if (token === generation.current) {
        busy.current = false;
        if (refresh) void load();
      }
    }
  };
  const clearPending = () => {
    if (busy.current) return;
    try {
      sessionStorage.removeItem(journalKey(userId));
      pending.current = null;
      invalidJournal.current = false;
      scope.current = null;
      setCourses([]);
      setCourseId('');
      setRating('');
      setPhase('idle');
      setMessage(
        'This tab’s pending retry was cleared. Any saved server rating remains unchanged.',
      );
      void load();
    } catch {
      setPhase('blocked');
      setMessage('Could not clear this tab’s pending retry. Restore storage and try again.');
    }
  };
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (busy.current || loading || loadError || phase === 'blocked' || !scope.current) return;
    const parsed = PendingVote.safeParse(
      pending.current ?? {
        courseId,
        rating: rating === '' ? NaN : Number(rating),
        expectedScope: scope.current,
      },
    );
    if (!parsed.success) {
      setMessage('Choose a completed course and a difficulty from 1 to 5.');
      return;
    }
    const payload = parsed.data;
    if (
      !sameScope(payload.expectedScope, scope.current) ||
      payload.expectedScope?.userId !== userId
    ) {
      scopeChanged();
      return;
    }
    if (!courses.some((course) => course.id === payload.courseId)) {
      setPhase('blocked');
      setMessage(
        'This course is no longer completed. Check the saved rating or reload your courses.',
      );
      return;
    }
    try {
      sessionStorage.setItem(journalKey(userId), JSON.stringify(payload));
    } catch {
      invalidJournal.current = true;
      setPhase('blocked');
      setMessage(
        'Could not preserve this request for recovery. Restore this tab’s storage before saving.',
      );
      return;
    }
    pending.current = payload;
    busy.current = true;
    setPhase('saving');
    setMessage('Saving your rating…');
    const token = generation.current;
    let refresh = false;
    let postError: unknown;
    try {
      try {
        await rateCourse(payload.courseId, {
          rating: payload.rating,
          expectedScope: payload.expectedScope,
        });
      } catch (error) {
        postError = error;
      }
      if (token !== generation.current) return;
      if (isAxiosError(postError) && postError.response?.status === 409) {
        scopeChanged();
        setMessage(
          'The server could not accept this rating in the current account context. Check its saved status or reload your courses.',
        );
        refresh = true;
        return;
      }
      refresh = await confirm(payload, token);
      if (token !== generation.current || refresh) return;
      setPhase('retry');
      if (isAxiosError(postError) && postError.response?.status === 429) {
        const seconds = Number(postError.response.headers?.['retry-after']);
        setMessage(
          Number.isFinite(seconds) && seconds > 0
            ? `Hourly rating limit reached. Retry this same rating in ${Math.ceil(seconds / 60)} minutes.`
            : 'Hourly rating limit reached. Retry this same rating after the next hour.',
        );
      } else if (
        isAxiosError(postError) &&
        [400, 401, 403, 404, 422].includes(postError.response?.status ?? 0)
      )
        setMessage(
          'The server rejected this rating. Check your session and course completion, then reload and retry the same rating.',
        );
      else
        setMessage(
          'Could not confirm the save. Check the saved rating or retry this same request.',
        );
    } catch (error) {
      if (token !== generation.current) return;
      if (error instanceof RatingScopeChanged) {
        scopeChanged();
        refresh = true;
      } else {
        scope.current = null;
        setCourses([]);
        setPhase('blocked');
        refresh = true;
        setMessage(
          'Could not confirm the save or clear recovery data. Check the saved rating or retry this same request.',
        );
      }
    } finally {
      if (token === generation.current) {
        busy.current = false;
        if (refresh) void load();
      }
    }
  };
  const selected = courses.find((course) => course.id === courseId);
  const yourRating = selected?.yourRating ?? undefined;
  const locked = phase !== 'idle' || loading || loadError || !scope.current;
  const fieldClass =
    'mt-2 min-h-11 w-full rounded-md border border-gray-300 bg-white px-3 text-gray-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-700 disabled:bg-gray-100';

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header>
        <h2 className="text-2xl font-bold text-gray-900">Course ratings</h2>
        <p className="mt-2 max-w-prose text-sm text-gray-600">
          Rate the difficulty of a course you have completed: 1 means very easy and 5 means very
          difficult. Each account has one vote per course; saving again replaces it.
        </p>
      </header>
      {message && (
        <p
          role={phase === 'retry' || phase === 'blocked' ? 'alert' : 'status'}
          className="text-sm text-gray-700"
        >
          {message}
        </p>
      )}
      {(pending.current || invalidJournal.current) && phase !== 'saving' && (
        <div className="space-y-3">
          <p className="text-sm text-gray-600">
            The rating may already be saved. Clearing the pending retry only removes this tab’s
            recovery request.
          </p>
          <div className="flex flex-wrap gap-3">
            {pending.current?.expectedScope?.userId === userId && (
              <Button
                variant="secondary"
                className="min-h-11"
                onClick={() => void checkSaved()}
                disabled={loading}
              >
                Check saved rating
              </Button>
            )}
            <Button
              variant="secondary"
              className="min-h-11"
              onClick={clearPending}
              disabled={loading}
            >
              Clear pending retry
            </Button>
          </div>
        </div>
      )}
      {loading ? (
        <p role="status" className="text-gray-600">
          Loading your completed courses and ratings…
        </p>
      ) : loadError ? (
        <div>
          <p role="alert" className="text-red-700">
            Could not load your courses and saved ratings. Check your connection and reload.
          </p>
          <Button
            className="mt-3 min-h-11"
            disabled={phase === 'saving'}
            onClick={() => void load()}
          >
            Reload courses
          </Button>
        </div>
      ) : courses.length === 0 && !pending.current ? (
        <p className="text-gray-600">Complete a course in My curriculum before rating it.</p>
      ) : (
        <section
          aria-label="Rate a completed course"
          className="rounded-xl border border-gray-200 bg-white p-5"
        >
          <form onSubmit={(event) => void save(event)}>
            <label className="block text-sm font-medium text-gray-900">
              Course
              <select
                ref={courseSelect}
                className={fieldClass}
                value={courseId}
                disabled={locked}
                onChange={(event) => {
                  const id = event.target.value;
                  setCourseId(id);
                  const own = courses.find((course) => course.id === id)?.yourRating;
                  setRating(own == null ? '' : String(own));
                  setMessage('');
                }}
              >
                <option value="">Choose a completed course</option>
                {pending.current &&
                  !courses.some((course) => course.id === pending.current?.courseId) && (
                    <option value={pending.current.courseId}>Previous pending course</option>
                  )}
                {courses.map((course) => (
                  <option key={course.id} value={course.id}>
                    {course.code} — {course.name}
                  </option>
                ))}
              </select>
            </label>
            {selected && (
              <div className="mt-3" aria-label="Selected course rating">
                <CourseRatingBadge course={selected} />
                <p className="mt-2 text-sm text-gray-700">
                  {yourRating === undefined
                    ? 'You have not rated this course yet.'
                    : `Your saved rating: ${yourRating} / 5`}
                </p>
                <p className="mt-1 text-sm text-gray-600">
                  {selected.membership === 'CURRENT_CURRICULUM'
                    ? 'The estimate combines course votes with your curriculum’s mean.'
                    : selected.membership === 'OTHER_HISTORY'
                      ? 'This completed course is outside your current curriculum. Its estimate uses the global mean.'
                      : 'The estimate combines course votes with the global mean.'}{' '}
                  A small vote count means less course-specific evidence.
                </p>
              </div>
            )}
            <label className="mt-5 block text-sm font-medium text-gray-900">
              Your difficulty rating
              <select
                className={fieldClass}
                value={rating}
                disabled={locked}
                onChange={(event) => {
                  setRating(event.target.value);
                  setMessage('');
                }}
              >
                <option value="">Choose 1 to 5</option>
                <option value="1">1 — Very easy</option>
                <option value="2">2 — Easy</option>
                <option value="3">3 — Moderate</option>
                <option value="4">4 — Difficult</option>
                <option value="5">5 — Very difficult</option>
              </select>
            </label>
            <div className="mt-5 flex flex-wrap gap-3">
              <Button
                type="submit"
                className="min-h-11"
                isLoading={phase === 'saving'}
                disabled={phase === 'blocked' || loading || loadError || !scope.current}
              >
                {pending.current ? 'Retry same rating' : 'Save rating'}
              </Button>
              {pending.current && phase !== 'saving' && (
                <Button
                  type="button"
                  variant="secondary"
                  className="min-h-11"
                  onClick={() => void load()}
                >
                  Reload courses
                </Button>
              )}
            </div>
          </form>
        </section>
      )}
    </div>
  );
}
