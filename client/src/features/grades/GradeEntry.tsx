import { isAxiosError } from 'axios';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import {
  AppendGradeAttemptSchema,
  type AppendGradeAttemptDTO,
  type StudentGradesDTO,
} from '@iu-study-planner/shared';
import { Button } from '@/components/ui';
import { appendStudentGrade, getStudentGradeCourses, getStudentGrades } from '@/lib/gradesApi';

type Props = { userId: string; onSaved: (grades: StudentGradesDTO) => void };
type Phase = 'idle' | 'saving' | 'checking' | 'retry' | 'blocked';
type Option = { id: string; code: string; name: string };
const requestKey = (userId: string) => `pending_grade_attempt:${userId}`;

// Remounting at an account boundary also isolates drafts and pending requests.
export function GradeEntry(props: Props) {
  return <GradeEntrySession key={props.userId} {...props} />;
}

function GradeEntrySession({ userId, onSaved }: Props) {
  const [journal] = useState(() => {
    try {
      const raw = sessionStorage.getItem(requestKey(userId));
      const pending = raw ? AppendGradeAttemptSchema.parse(JSON.parse(raw)) : null;
      if (pending?.expectedScope && pending.expectedScope.userId !== userId.toLowerCase())
        throw new Error('Wrong pending grade owner');
      return { pending, error: false };
    } catch {
      return { pending: null, error: true };
    }
  });
  const pending = useRef<AppendGradeAttemptDTO | null>(journal.pending);
  const generation = useRef(0);
  const catalogGeneration = useRef(0);
  const busy = useRef(false);
  const scoreInput = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<Phase>(
    journal.error ? 'blocked' : journal.pending ? 'checking' : 'idle',
  );
  const [message, setMessage] = useState(
    journal.error
      ? 'Browser recovery data is unavailable. Restore access to this tab’s storage before recording another score.'
      : '',
  );
  const [courseId, setCourseId] = useState(journal.pending?.courseId ?? '');
  const [score, setScore] = useState(journal.pending ? String(journal.pending.score) : '');
  const [semester, setSemester] = useState(journal.pending?.semester ?? '');
  const [year, setYear] = useState(journal.pending?.year ? String(journal.pending.year) : '');
  const [courses, setCourses] = useState<Option[]>([]);
  const [catalogStatus, setCatalogStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [curriculumId, setCurriculumId] = useState<string | null>(null);

  const finish = useCallback(
    (grades: StudentGradesDTO) => {
      if (
        (grades.scope && grades.scope.userId !== userId.toLowerCase()) ||
        (pending.current?.expectedScope && !grades.scope)
      )
        throw new Error('Wrong grade owner');
      sessionStorage.removeItem(requestKey(userId));
      pending.current = null;
      busy.current = false;
      setPhase('idle');
      setScore('');
      setMessage('Score saved. Course completion is unchanged.');
      onSaved(grades);
    },
    [onSaved, userId],
  );

  const loadCourses = useCallback(async () => {
    const token = generation.current;
    const catalogToken = ++catalogGeneration.current;
    setCatalogStatus('loading');
    setCourses([]);
    try {
      const response = await getStudentGradeCourses(userId);
      if (token !== generation.current || catalogToken !== catalogGeneration.current) return;
      setCourses([...response.courses].sort((a, b) => a.code.localeCompare(b.code)));
      setCurriculumId(response.scope.curriculumId);
      if (!pending.current)
        setCourseId((current) =>
          response.courses.some(({ id }) => id === current) ? current : '',
        );
      setCatalogStatus('ready');
    } catch {
      if (token === generation.current && catalogToken === catalogGeneration.current)
        setCatalogStatus('error');
    }
  }, [userId]);

  const recover = useCallback(
    async (payload: AppendGradeAttemptDTO, token: number) => {
      busy.current = true;
      setPhase('checking');
      setMessage('Checking whether your score was saved…');
      try {
        const grades = await getStudentGrades();
        if (token !== generation.current) return;
        if (
          (grades.scope && grades.scope.userId !== userId.toLowerCase()) ||
          (payload.expectedScope && !grades.scope)
        )
          throw new Error('Wrong grade owner');
        const saved = grades.attempts.find((attempt) => attempt.requestId === payload.requestId);
        if (saved) {
          if (
            saved.courseId !== payload.courseId ||
            saved.score !== payload.score ||
            saved.semester !== (payload.semester ?? null) ||
            saved.year !== (payload.year ?? null)
          ) {
            setPhase('blocked');
            setMessage(
              'This saved request has different details. Keep the request for review; another score cannot be submitted yet.',
            );
          } else finish(grades);
        } else {
          onSaved(grades);
          if (!payload.expectedScope) {
            setPhase('blocked');
            setMessage(
              'This older pending request has no confirmed curriculum. It is kept for recovery; reload saved grades to check whether it was recorded.',
            );
          } else if (grades.scope?.curriculumId !== payload.expectedScope.curriculumId) {
            void loadCourses();
            setPhase('blocked');
            setMessage(
              'Your curriculum changed. The pending attempt is kept for recovery. Reload saved grades to check it before recording another score.',
            );
          } else {
            setPhase('retry');
            setMessage(
              'The score is not in your saved history. Retry this same attempt to confirm it before recording another score.',
            );
          }
        }
      } catch {
        if (token !== generation.current) return;
        setPhase('blocked');
        setMessage(
          'Could not confirm whether the score was saved. Reload saved grades before recording another attempt.',
        );
      } finally {
        if (token === generation.current) busy.current = false;
      }
    },
    [finish, loadCourses, onSaved, userId],
  );

  useEffect(() => {
    const activeGeneration = generation;
    const activeBusy = busy;
    void loadCourses();
    if (journal.pending) void recover(journal.pending, generation.current);
    return () => {
      activeGeneration.current++;
      activeBusy.current = false;
    };
  }, [journal.pending, loadCourses, recover]);

  useEffect(() => {
    const refresh = () => void loadCourses();
    const refreshVisible = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refreshVisible);
    return () => {
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refreshVisible);
    };
  }, [loadCourses]);

  const send = async (payload: AppendGradeAttemptDTO) => {
    if (busy.current) return;
    const token = generation.current;
    busy.current = true;
    setPhase('saving');
    setMessage('Saving your score…');
    try {
      sessionStorage.setItem(requestKey(userId), JSON.stringify(payload));
    } catch {
      busy.current = false;
      setPhase('blocked');
      setMessage(
        'Could not retain this request in the browser. No score was submitted. Restore storage access and reload this page.',
      );
      return;
    }
    pending.current = payload;
    try {
      const grades = await appendStudentGrade(payload);
      if (token === generation.current) finish(grades);
    } catch (error) {
      if (token !== generation.current) return;
      if (isAxiosError(error) && [400, 401, 403, 404, 422].includes(error.response?.status ?? 0)) {
        try {
          sessionStorage.removeItem(requestKey(userId));
          pending.current = null;
          busy.current = false;
          setPhase('idle');
          setMessage(
            'The server rejected this attempt. Check the course, score and session, then try again.',
          );
        } catch {
          busy.current = false;
          setPhase('blocked');
          setMessage(
            'The server rejected the attempt, but its browser request could not be cleared. Restore storage access and reload.',
          );
        }
      } else await recover(payload, token);
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (phase !== 'idle' || busy.current || catalogStatus !== 'ready') return;
    if (!courses.some(({ id }) => id === courseId)) {
      setMessage('Choose a course from your current grade-entry choices before saving a score.');
      return;
    }
    const parsed = AppendGradeAttemptSchema.safeParse({
      courseId,
      requestId: crypto.randomUUID(),
      expectedScope: { userId, curriculumId },
      score: score.trim() === '' ? Number.NaN : Number(score),
      ...(semester ? { semester } : {}),
      ...(year.trim() ? { year: Number(year) } : {}),
    });
    if (!parsed.success || !courses.some((course) => course.id === parsed.data.courseId)) {
      setMessage(
        'Choose a course, enter a score from 0 to 100, and use a whole year from 2000 to 2100 if supplied.',
      );
      return;
    }
    void send(parsed.data);
  };
  useEffect(() => {
    if (
      phase === 'idle' &&
      catalogStatus === 'ready' &&
      message === 'Score saved. Course completion is unchanged.'
    )
      scoreInput.current?.focus();
  }, [catalogStatus, message, phase]);
  const locked = phase !== 'idle' || catalogStatus !== 'ready' || courses.length === 0;
  const fieldClass =
    'mt-1 min-h-11 w-full min-w-0 rounded-md border border-gray-300 bg-white px-3 text-gray-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-700 disabled:bg-gray-100';
  return (
    <section
      aria-labelledby="grade-entry-title"
      className="rounded-xl border border-gray-200 bg-white p-5"
    >
      <h3 id="grade-entry-title" className="text-lg font-semibold text-gray-900">
        Record a score
      </h3>
      <p className="mt-2 max-w-prose text-sm text-gray-600">
        Enter your actual score out of 100. Retakes stay in your history; recording a score does not
        mark a course completed.
      </p>
      {catalogStatus === 'ready' && curriculumId && (
        <p className="mt-3 max-w-prose text-sm text-gray-600">
          Course choices follow your current reference curriculum. Historical attempts remain in
          grade history even when their courses are outside this curriculum.
        </p>
      )}
      {catalogStatus === 'loading' && (
        <p role="status" className="mt-3 text-sm text-gray-600">
          Loading courses…
        </p>
      )}
      {catalogStatus === 'error' && (
        <div className="mt-3">
          <p role="alert" className="text-red-700">
            Could not load courses.
          </p>
          <Button className="mt-2 min-h-11" onClick={() => void loadCourses()}>
            Reload courses
          </Button>
        </div>
      )}
      {catalogStatus === 'ready' && courses.length === 0 && (
        <p className="mt-3 text-gray-600">No courses are available for grade entry.</p>
      )}
      <form onSubmit={submit} noValidate className="mt-4">
        <fieldset disabled={locked} className="grid min-w-0 gap-4 sm:grid-cols-2">
          <legend className="sr-only">Course score and optional term</legend>
          <label className="min-w-0 text-sm font-medium text-gray-700">
            Course
            <select
              value={courseId}
              onChange={(event) => setCourseId(event.target.value)}
              className={fieldClass}
            >
              <option value="">Choose a course</option>
              {pending.current && !courses.some(({ id }) => id === pending.current?.courseId) && (
                <option value={pending.current.courseId}>Course from pending saved request</option>
              )}
              {courses.map((course) => (
                <option key={course.id} value={course.id}>
                  {course.code} — {course.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm font-medium text-gray-700">
            Score out of 100
            <input
              ref={scoreInput}
              type="number"
              inputMode="decimal"
              min="0"
              max="100"
              step="any"
              value={score}
              onChange={(event) => setScore(event.target.value)}
              className={fieldClass}
            />
          </label>
          <label className="text-sm font-medium text-gray-700">
            Semester (optional)
            <select
              value={semester}
              onChange={(event) => setSemester(event.target.value as typeof semester)}
              className={fieldClass}
            >
              <option value="">Not specified</option>
              <option value="FALL">Fall</option>
              <option value="SPRING">Spring</option>
              <option value="SUMMER">Summer</option>
            </select>
          </label>
          <label className="text-sm font-medium text-gray-700">
            Year (optional)
            <input
              type="number"
              inputMode="numeric"
              min="2000"
              max="2100"
              step="1"
              value={year}
              onChange={(event) => setYear(event.target.value)}
              className={fieldClass}
            />
          </label>
        </fieldset>
        {message && (
          <p
            role={
              phase === 'blocked' ||
              phase === 'retry' ||
              (phase === 'idle' && message.startsWith('Choose'))
                ? 'alert'
                : 'status'
            }
            className={`mt-4 max-w-prose text-sm ${phase === 'blocked' || phase === 'retry' ? 'text-amber-800' : 'text-gray-700'}`}
          >
            {message}
          </p>
        )}
        <div className="mt-4 flex flex-wrap gap-3">
          <Button type="submit" className="min-h-11" disabled={locked || courses.length === 0}>
            {phase === 'saving' ? 'Saving score…' : 'Save score'}
          </Button>
          {phase === 'retry' && (
            <>
              <Button
                type="button"
                className="min-h-11"
                onClick={() => pending.current && void send(pending.current)}
              >
                Retry this attempt
              </Button>
            </>
          )}
          {phase === 'blocked' && pending.current && (
            <Button
              type="button"
              variant="secondary"
              className="min-h-11"
              onClick={() =>
                !busy.current &&
                pending.current &&
                void recover(pending.current, generation.current)
              }
            >
              Reload saved grades
            </Button>
          )}
        </div>
      </form>
    </section>
  );
}
