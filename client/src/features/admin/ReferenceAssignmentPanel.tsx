import { isAxiosError } from 'axios';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { AdminStudentSummaryDTO, CurriculumSummaryDTO } from '@iu-study-planner/shared';
import { Button, ErrorBanner } from '@/components/ui';
import { useFocusAfterDisable } from '@/lib/useFocusAfterDisable';
import { getCurriculumReferences } from '@/lib/curriculumApi';
import { assignReferenceCurriculum, listAssignableStudents } from '@/lib/adminUsersApi';
import { AdminSessionChanged, useVerifyAdminSession } from './adminSession';

const NO_ASSIGNMENT = '';

type Props = { userId: string };

type Pending = {
  studentId: string;
  curriculumId: string | null;
  expectedCurriculumId: string | null;
};

export function ReferenceAssignmentPanel({ userId }: Props) {
  return <Assignment key={userId.toLowerCase()} userId={userId.toLowerCase()} />;
}

function Assignment({ userId }: Props) {
  const generation = useRef(0);
  const busy = useRef(false);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [students, setStudents] = useState<AdminStudentSummaryDTO[]>([]);
  const [nextAfter, setNextAfter] = useState<string | null>(null);
  const [curricula, setCurricula] = useState<CurriculumSummaryDTO[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [choice, setChoice] = useState<string>(NO_ASSIGNMENT);
  const [saving, setSaving] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const rememberFocus = useFocusAfterDisable(saving);
  const verifySession = useVerifyAdminSession(userId, { requireUuid: true });

  const selected = students.find(({ id }) => id === selectedId) ?? null;
  const dirty =
    selected !== null &&
    (choice === NO_ASSIGNMENT ? selected.curriculumId !== null : selected.curriculumId !== choice);

  const load = useCallback(
    async (after?: string) => {
      if (busy.current) return;
      busy.current = true;
      const token = ++generation.current;
      setStatus('loading');
      setError('');
      setNotice('');
      try {
        await verifySession();
        if (token !== generation.current) return;
        const [page, references] = await Promise.all([
          listAssignableStudents(after),
          after === undefined ? getCurriculumReferences() : Promise.resolve(null),
        ]);
        if (token !== generation.current) return;
        await verifySession();
        if (token !== generation.current) return;
        if (references) setCurricula(references);
        setStudents((current) =>
          after === undefined ? page.students : [...current, ...page.students],
        );
        setNextAfter(page.nextAfter);
        setStatus('ready');
      } catch (failure) {
        if (token !== generation.current) return;
        setStatus('error');
        setStudents([]);
        setNextAfter(null);
        setError(
          failure instanceof AdminSessionChanged ||
            (isAxiosError(failure) && [401, 403].includes(failure.response?.status ?? 0))
            ? 'Your admin session changed. Sign in again before managing assignments.'
            : 'Could not load student accounts. Reload to try again.',
        );
      } finally {
        if (token === generation.current) {
          busy.current = false;
          setStatus((current) => (current === 'loading' ? 'ready' : current));
        }
      }
    },
    [verifySession],
  );

  useEffect(() => {
    const active = generation;
    const loading = busy;
    void load();
    return () => {
      active.current++;
      loading.current = false;
    };
  }, [load]);

  function selectStudent(studentId: string) {
    const student = students.find(({ id }) => id === studentId);
    setSelectedId(studentId);
    setChoice(student?.curriculumId ?? NO_ASSIGNMENT);
    setPending(null);
    setError('');
    setNotice('');
  }

  async function save() {
    if (!selected || !dirty || saving) return;
    const request: Pending = {
      studentId: selected.id,
      curriculumId: choice === NO_ASSIGNMENT ? null : choice,
      expectedCurriculumId: selected.curriculumId,
    };
    const token = ++generation.current;
    setPending(request);
    setSaving(true);
    setError('');
    setNotice('');
    rememberFocus();
    try {
      await verifySession();
      if (token !== generation.current) return;
      const reply = await assignReferenceCurriculum(request.studentId, {
        curriculumId: request.curriculumId,
        expectedCurriculumId: request.expectedCurriculumId,
      });
      if (token !== generation.current) return;
      await verifySession();
      if (token !== generation.current) return;
      const reference =
        reply.curriculumId === null
          ? null
          : (curricula.find(({ id }) => id === reply.curriculumId) ?? null);
      setStudents((current) =>
        current.map((student) =>
          student.id === reply.userId
            ? { ...student, curriculumId: reply.curriculumId, curriculum: reference }
            : student,
        ),
      );
      setPending(null);
      setNotice(
        reply.changed
          ? reply.curriculumId === null
            ? 'The reference curriculum was removed from this account.'
            : 'The reference curriculum was attached to this account.'
          : 'This account already holds that assignment. Nothing was changed.',
      );
      setStatus('ready');
    } catch (failure) {
      if (token !== generation.current) return;
      try {
        await verifySession();
      } catch {
        setStatus('error');
        setStudents([]);
        setPending(null);
        setError('Your admin session changed. Sign in again before managing assignments.');
        return;
      }
      if (token !== generation.current) return;
      setError(
        isAxiosError(failure) && failure.response?.status === 409
          ? 'This account changed since the list was read. Reload before assigning it again.'
          : 'Could not confirm the assignment. Retry the same request, or reload the list.',
      );
    } finally {
      if (token === generation.current) setSaving(false);
    }
  }

  const applyLabel = choice === NO_ASSIGNMENT ? 'Remove assignment' : 'Attach reference curriculum';

  return (
    <section
      aria-label="Reference curriculum assignment"
      className="space-y-4 border-t border-gray-200 pt-6"
    >
      <div>
        <h3 className="text-lg font-semibold text-gray-900">Reference curriculum assignment</h3>
        <p className="mt-2 max-w-prose text-sm text-gray-600">
          Attach a reference curriculum to a student account for demonstration. This does not
          activate a verified cohort, does not validate graduation or elective rules, and does not
          make the assigned curriculum editable. Existing records are preserved; courses outside the
          assigned curriculum remain visible as history.
        </p>
        <p className="mt-2 max-w-prose text-sm text-gray-600">
          An assigned account loses access to the legacy editable curriculum map, and its progress
          store becomes read-only.
        </p>
      </div>

      {status === 'loading' ? (
        <p role="status" className="text-sm text-gray-600">
          Loading student accounts…
        </p>
      ) : status === 'error' ? (
        <>
          <ErrorBanner>{error}</ErrorBanner>
          <Button
            variant="secondary"
            className="min-h-11"
            disabled={saving}
            onClick={() => void load()}
          >
            Reload student accounts
          </Button>
        </>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label
                htmlFor="reference-student"
                className="block text-sm font-medium text-gray-900"
              >
                Student account
              </label>
              <select
                id="reference-student"
                className="mt-2 min-h-11 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
                value={selectedId}
                disabled={saving}
                onChange={(event) => selectStudent(event.target.value)}
              >
                <option value="">Select a student</option>
                {students.map((student) => (
                  <option key={student.id} value={student.id}>
                    {student.studentId} · {student.name}
                    {student.curriculum ? ` · ${student.curriculum.code}` : ' · no assignment'}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label
                htmlFor="reference-curriculum"
                className="block text-sm font-medium text-gray-900"
              >
                Reference curriculum
              </label>
              <select
                id="reference-curriculum"
                className="mt-2 min-h-11 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
                value={choice}
                disabled={saving || !selected}
                onChange={(event) => setChoice(event.target.value)}
              >
                <option value={NO_ASSIGNMENT}>No assignment</option>
                {curricula.map((reference) => (
                  <option key={reference.id} value={reference.id}>
                    {reference.code} · {reference.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {selected && (
            <p className="max-w-prose text-sm text-gray-700">
              {selected.studentId} currently holds{' '}
              {selected.curriculum
                ? `the ${selected.curriculum.code} reference`
                : 'no reference curriculum'}
              . This assignment is a simulation reference, not a verified cohort.
            </p>
          )}

          {students.length === 0 && (
            <p className="text-sm text-gray-600">No student accounts exist yet.</p>
          )}

          <div className="flex flex-wrap gap-3">
            <Button
              className="min-h-11"
              disabled={!selected || !dirty || saving}
              onClick={() => void save()}
            >
              {saving ? 'Saving…' : applyLabel}
            </Button>
            {nextAfter !== null && (
              <Button
                variant="secondary"
                className="min-h-11"
                disabled={saving}
                onClick={() => void load(nextAfter)}
              >
                Load more student accounts
              </Button>
            )}
          </div>

          {notice && (
            <p role="status" className="max-w-prose text-sm text-gray-700">
              {notice}
            </p>
          )}
          {error && <ErrorBanner>{error}</ErrorBanner>}
          {pending && error && (
            <p className="max-w-prose text-sm text-gray-600">
              The unconfirmed request targets{' '}
              {pending.curriculumId === null
                ? 'no curriculum'
                : (curricula.find(({ id }) => id === pending.curriculumId)?.code ??
                  pending.curriculumId)}
              . Retrying sends the same request; reloading replaces it.
            </p>
          )}
        </>
      )}
    </section>
  );
}
