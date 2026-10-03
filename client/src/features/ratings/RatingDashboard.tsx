import { isAxiosError } from 'axios';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { z } from 'zod';
import { RateCourseSchema, type OwnCourseRatingDTO } from '@iu-study-planner/shared';
import { Button } from '@/components/ui';
import { getCourses, getCurrentStudentProgress } from '@/lib/api';
import { getOwnRatings, rateCourse } from '@/lib/ratingsApi';
import type { Course } from '@/types';
import { CourseRatingBadge } from '../curriculum/CourseRatingBadge';

const PendingVote = RateCourseSchema.extend({ courseId: z.string().uuid() }).strict();
type Vote = z.infer<typeof PendingVote>;
const journalKey = (userId: string) => `pending_course_rating:${userId}`;

export function RatingDashboard({ userId }: { userId: string }) {
  return <RatingSession key={userId} userId={userId} />;
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
  const pending = useRef<Vote | null>(journal.vote);
  const generation = useRef(0);
  const busy = useRef(false);
  const courseSelect = useRef<HTMLSelectElement>(null);
  const [courses, setCourses] = useState<Course[]>([]);
  const [votes, setVotes] = useState<OwnCourseRatingDTO[]>([]);
  const [courseId, setCourseId] = useState(journal.vote?.courseId ?? '');
  const [rating, setRating] = useState(journal.vote ? String(journal.vote.rating) : '');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [phase, setPhase] = useState<'idle' | 'saving' | 'retry' | 'blocked'>(
    journal.error ? 'blocked' : journal.vote ? 'retry' : 'idle',
  );
  const [message, setMessage] = useState(
    journal.error
      ? 'Browser recovery data is unavailable. Restore this tab’s storage before saving a rating.'
      : journal.vote
        ? 'A previous save is unconfirmed. Retry the same rating before making another change.'
        : '',
  );

  const load = useCallback(async () => {
    const token = ++generation.current;
    setLoading(true);
    setLoadError(false);
    try {
      const [catalog, progress, ownVotes] = await Promise.all([
        getCourses(),
        getCurrentStudentProgress(),
        getOwnRatings(),
      ]);
      if (token !== generation.current) return;
      if (!catalog.success || !catalog.data) throw new Error('No catalog');
      setCourses(
        catalog.data.filter((course) =>
          Object.prototype.hasOwnProperty.call(progress.completedIds, course.id),
        ),
      );
      setVotes(ownVotes);
    } catch {
      if (token === generation.current) setLoadError(true);
    } finally {
      if (token === generation.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    const activeGeneration = generation;
    void load();
    return () => {
      activeGeneration.current++;
    };
  }, [load]);

  useEffect(() => {
    if (phase === 'idle' && !loading && message.startsWith('Rating saved'))
      courseSelect.current?.focus();
  }, [phase, loading, message]);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (busy.current || phase === 'blocked') return;
    const parsed = PendingVote.safeParse(
      pending.current ?? { courseId, rating: rating === '' ? NaN : Number(rating) },
    );
    if (!parsed.success) {
      setMessage('Choose a completed course and a difficulty from 1 to 5.');
      return;
    }
    if (!pending.current && !courses.some((course) => course.id === parsed.data.courseId)) {
      setMessage('This course is no longer completed. Reload your courses.');
      return;
    }
    const payload = parsed.data;
    try {
      sessionStorage.setItem(journalKey(userId), JSON.stringify(payload));
    } catch {
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
    try {
      const saved = await rateCourse(payload.courseId, { rating: payload.rating });
      if (token !== generation.current) return;
      sessionStorage.removeItem(journalKey(userId));
      pending.current = null;
      setVotes((previous) => [
        ...previous.filter((vote) => vote.courseId !== payload.courseId),
        { courseId: payload.courseId, rating: saved.yourRating },
      ]);
      setCourses((previous) =>
        previous.map((course) =>
          course.id === payload.courseId
            ? {
                ...course,
                avgRating: saved.average,
                ratingCount: saved.count,
                ratingDifficulty: saved.difficulty,
                ratingPriorMean: saved.priorMean,
                ratingPriorSource: saved.priorSource,
              }
            : course,
        ),
      );
      setPhase('idle');
      setMessage('Rating saved. Saving again updates your one vote for this course.');
      // Refresh other estimates too: a changed vote can alter the shared prior.
      void load();
    } catch (error) {
      if (token !== generation.current) return;
      setPhase('retry');
      if (isAxiosError(error) && error.response?.status === 429) {
        const seconds = Number(error.response.headers?.['retry-after']);
        setMessage(
          Number.isFinite(seconds) && seconds > 0
            ? `Hourly rating limit reached. Retry this same rating in ${Math.ceil(seconds / 60)} minutes.`
            : 'Hourly rating limit reached. Retry this same rating after the next hour.',
        );
      } else if (
        isAxiosError(error) &&
        [400, 401, 403, 404, 422].includes(error.response?.status ?? 0)
      ) {
        setMessage(
          'The server rejected this rating. Check your session and course completion, then reload and retry the same rating.',
        );
      } else
        setMessage(
          'Could not confirm the save. Retry this same rating; it will update your existing vote rather than add another.',
        );
    } finally {
      if (token === generation.current || pending.current === null) busy.current = false;
    }
  };
  const selected = courses.find((course) => course.id === courseId);
  const yourRating = votes.find((vote) => vote.courseId === courseId)?.rating;
  const locked = phase !== 'idle';
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
      {loading ? (
        <p role="status" className="text-gray-600">
          Loading your completed courses and ratings…
        </p>
      ) : loadError ? (
        <div>
          <p role="alert" className="text-red-700">
            Could not load your courses and saved ratings. Check your connection and reload.
          </p>
          <Button className="mt-3 min-h-11" onClick={() => void load()}>
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
                  const own = votes.find((vote) => vote.courseId === id);
                  setRating(own ? String(own.rating) : '');
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
                  The estimate combines course votes with a shared mean. A small vote count means
                  less course-specific evidence.
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
                disabled={phase === 'blocked'}
              >
                {phase === 'retry' ? 'Retry same rating' : 'Save rating'}
              </Button>
              {phase === 'retry' && (
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
