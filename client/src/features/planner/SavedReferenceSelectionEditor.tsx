import { useCallback, useEffect, useRef, useState } from 'react';
import { isAxiosError } from 'axios';
import { z } from 'zod';
import {
  OwnStudyPlanReferenceSelectionBodySchema,
  OwnStudyPlanReferenceSelectionStateSchema,
  type OwnStudyPlanCoursesDTO,
  type OwnStudyPlanReferenceSelectionBodyDTO,
  type OwnStudyPlanReferenceSelectionStateDTO,
  type OwnStudyPlanReferenceSelectionReceiptDTO,
} from '@iu-study-planner/shared';
import { Button } from '@/components/ui';
import { SavedStudyPlanCoursesSessionChangedError } from '@/lib/savedStudyPlanCoursesApi';
import {
  getSavedReferenceSelection,
  saveReferenceSelection,
  type ReferenceSelectionScope,
} from '@/lib/savedStudyPlanReferenceSelectionApi';

type Props = ReferenceSelectionScope & {
  onInvalidated: (kind: 'account' | 'unavailable') => void;
  onSnapshot: (snapshot: OwnStudyPlanCoursesDTO) => void;
};
type Draft = { year: string; semester: string; courseIds: string[] };
type Phase = 'idle' | 'loading' | 'ready' | 'saving' | 'uncertain' | 'error' | 'blocked';
const normalizedUuid = z
  .string()
  .length(36)
  .uuid()
  .transform((id) => id.toLowerCase());
const recoveryEnvelope = z
  .object({
    planId: normalizedUuid,
    semesterId: normalizedUuid,
    body: OwnStudyPlanReferenceSelectionBodySchema,
  })
  .strict();
const referenceSelectionRequestKey = (ownerId: string, planId: string, semesterId: string) =>
  `pending_reference_selection:${ownerId}:${planId}:${semesterId}`;

function EditorBody(props: Props) {
  const { ownerId, planId, semesterId, expectedCurriculumId, onInvalidated, onSnapshot } = props;
  const storageKey = referenceSelectionRequestKey(ownerId, planId, semesterId);
  const [journal] = useState(() => {
    try {
      const raw = sessionStorage.getItem(storageKey);
      const envelope = raw ? recoveryEnvelope.parse(JSON.parse(raw)) : null;
      if (
        envelope &&
        (envelope.body.expectedScope.userId !== ownerId ||
          envelope.planId !== planId ||
          envelope.semesterId !== semesterId)
      )
        throw new Error('Wrong pending owner or semester');
      return { body: envelope?.body ?? null, error: false };
    } catch {
      return { body: null, error: true };
    }
  });
  const pending = useRef(journal.body);
  const resolution = useRef<'accepted' | 'rejected' | null>(null);
  const acknowledgement = useRef<OwnStudyPlanReferenceSelectionReceiptDTO | null>(null);
  const [receipt, setReceipt] = useState<OwnStudyPlanReferenceSelectionReceiptDTO | null>(null);
  const [opened, setOpened] = useState(false);
  const [phase, setPhase] = useState<Phase>('idle');
  const [state, setState] = useState<OwnStudyPlanReferenceSelectionStateDTO | null>(null);
  const [message, setMessage] = useState('');
  const [draft, setDraft] = useState<Draft>({ year: '', semester: '', courseIds: [] });
  const currentDraft = useRef(draft);
  const [choice, setChoice] = useState('');
  const choiceRef = useRef('');
  const alive = useRef(false);
  const busy = useRef(false);
  const generation = useRef(0);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    const activeAlive = alive;
    const activeGeneration = generation;
    const activeController = controller;
    activeAlive.current = true;
    return () => {
      activeAlive.current = false;
      activeGeneration.current++;
      activeController.current?.abort();
    };
  }, []);
  const invalidate = useCallback(
    (error: unknown) => {
      const status = isAxiosError(error) ? error.response?.status : undefined;
      if (
        error instanceof SavedStudyPlanCoursesSessionChangedError ||
        status === 401 ||
        status === 403
      ) {
        onInvalidated('account');
        return true;
      }
      if (status === 404) {
        onInvalidated('unavailable');
        return true;
      }
      return false;
    },
    [onInvalidated],
  );
  const installDraft = useCallback((value: Draft) => {
    currentDraft.current = value;
    setDraft(value);
    choiceRef.current = '';
    setChoice('');
  }, []);
  const read = useCallback(async () => {
    if (!alive.current || busy.current) return;
    busy.current = true;
    const version = ++generation.current;
    const active = new AbortController();
    controller.current?.abort();
    controller.current = active;
    const current = () => alive.current && generation.current === version && !active.signal.aborted;
    setPhase('loading');
    setMessage('Loading the latest saved selection…');
    try {
      const received = await getSavedReferenceSelection(
        { ownerId, planId, semesterId, expectedCurriculumId },
        active.signal,
      );
      if (!current()) return;
      const next = OwnStudyPlanReferenceSelectionStateSchema.parse(received);
      if (
        next.snapshot.scope.userId !== ownerId ||
        next.snapshot.scope.curriculumId !== expectedCurriculumId ||
        next.snapshot.plan.id !== planId ||
        next.snapshot.semester.id !== semesterId
      )
        throw new SavedStudyPlanCoursesSessionChangedError();
      if (
        resolution.current === 'accepted' &&
        (!acknowledgement.current || next.revision < acknowledgement.current.savedRevision)
      )
        throw new Error('Read predates the acknowledged save');
      if (resolution.current) {
        // A receipt is historical acknowledgement. The fresh read supplies displayed state.
        sessionStorage.removeItem(storageKey);
        pending.current = null;
        if (resolution.current === 'accepted') {
          setReceipt(acknowledgement.current);
          setMessage('Selection saved. The latest saved courses are shown below.');
        } else {
          setMessage(
            'The save could not be confirmed. The latest saved courses have been reloaded; review the academic slot and prerequisites before trying again.',
          );
        }
        resolution.current = null;
      } else {
        setMessage(
          pending.current
            ? 'A previous save is unresolved. Retry the same saved request to confirm its outcome before editing.'
            : 'Changes are saved only when you choose Save course selection.',
        );
      }
      setState(next);
      if (pending.current) {
        installDraft({
          year: String(pending.current.academicYear),
          semester: String(pending.current.academicSemester),
          courseIds: [...pending.current.courseIds],
        });
      } else {
        const entries =
          next.snapshot.courseReferences.status === 'RECOGNIZED'
            ? next.snapshot.courseReferences.entries
            : [];
        installDraft({
          year: '',
          semester: '',
          courseIds: entries.map(({ courseId }) => courseId),
        });
      }
      onSnapshot(next.snapshot);
      setPhase(journal.error ? 'blocked' : pending.current ? 'uncertain' : 'ready');
    } catch (error) {
      if (!current()) return;
      setState(null);
      if (!invalidate(error)) {
        setPhase(pending.current ? 'uncertain' : 'error');
        setMessage(
          'Could not confirm the latest selection. Reload it before editing. Any pending save has been retained.',
        );
      }
    } finally {
      if (current()) busy.current = false;
    }
  }, [
    ownerId,
    planId,
    semesterId,
    expectedCurriculumId,
    storageKey,
    installDraft,
    onSnapshot,
    journal.error,
    invalidate,
  ]);
  const send = async (body: OwnStudyPlanReferenceSelectionBodyDTO) => {
    if (!alive.current || busy.current) return;
    busy.current = true;
    const version = ++generation.current;
    const active = new AbortController();
    controller.current?.abort();
    controller.current = active;
    const current = () => alive.current && generation.current === version && !active.signal.aborted;
    try {
      sessionStorage.setItem(storageKey, JSON.stringify({ planId, semesterId, body }));
    } catch {
      busy.current = false;
      setPhase('blocked');
      setMessage(
        'Browser recovery storage is unavailable. No new request was submitted. Restore access to this tab’s storage and reload before saving.',
      );
      return;
    }
    pending.current = body;
    setPhase('saving');
    setMessage('Saving course selection…');
    try {
      const result = await saveReferenceSelection(
        { ownerId, planId, semesterId, expectedCurriculumId },
        body,
        active.signal,
      );
      if (!current()) return;
      acknowledgement.current = result.receipt;
      resolution.current = 'accepted';
    } catch (error) {
      if (!current()) return;
      if (invalidate(error)) return;
      const status = isAxiosError(error) ? error.response?.status : undefined;
      if (status === 400 || status === 409) {
        resolution.current = 'rejected';
      } else {
        setPhase('uncertain');
        setMessage(
          'Could not confirm whether this selection was saved. Keep this tab’s recovery data. Retry the same request to confirm it; no new selection can be submitted yet.',
        );
        return;
      }
    } finally {
      if (current()) busy.current = false;
    }
    if (current()) await read();
  };
  const locked =
    phase !== 'ready' || pending.current !== null || state?.editing.status !== 'AVAILABLE';
  const change = (next: Draft) => {
    if (!alive.current || busy.current || locked || currentDraft.current !== draft) return;
    installDraft(next);
    setReceipt(null);
    setMessage('Unsaved selection. Choose an academic slot and save when ready.');
  };
  const parsed = OwnStudyPlanReferenceSelectionBodySchema.safeParse({
    requestId: '00000000-0000-4000-8000-000000000001',
    expectedScope: { userId: ownerId, curriculumId: expectedCurriculumId },
    expectedRevision: state?.revision,
    academicYear: draft.year.trim() ? Number(draft.year) : Number.NaN,
    academicSemester: draft.semester ? Number(draft.semester) : Number.NaN,
    courseIds: draft.courseIds,
  });
  const fieldClass =
    'mt-1 block min-h-11 w-full min-w-0 rounded border border-gray-300 bg-white p-2 disabled:bg-gray-100';
  const options = state?.editing.status === 'AVAILABLE' ? state.editing.courses : [];
  return (
    <section
      aria-label="Edit saved course selection"
      className="mt-6 border-t border-gray-200 pt-5"
    >
      <h4 className="font-semibold text-gray-900">Edit saved course selection</h4>
      <p className="mt-2 max-w-prose text-sm text-gray-700">
        Save a course selection for a chosen year within the degree and semester. The server checks
        current placements, numeric GPA and mandatory prerequisites recorded as completed. Saved
        courses do not satisfy each other’s prerequisites. This does not activate a plan or confirm
        a timetable or degree plan.
      </p>
      <p className="mt-2 max-w-prose text-sm text-gray-600">
        Unsaved edits remain only while this view stays open. Returning to this tab, changing
        windows or reloading can refresh the view and discard them. Sent save requests are retained
        in this tab for recovery.
      </p>
      {!opened ? (
        <Button
          type="button"
          variant="secondary"
          className="mt-3 min-h-11"
          onClick={() => {
            if (!alive.current || busy.current) return;
            setOpened(true);
            void read();
          }}
        >
          Edit saved course selection
        </Button>
      ) : (
        <div className="mt-4 space-y-4">
          <p
            role={
              phase === 'error' || phase === 'uncertain' || phase === 'blocked' ? 'alert' : 'status'
            }
            className="max-w-prose text-sm text-gray-700"
          >
            {journal.error
              ? 'Browser recovery data is unavailable or invalid. Restore this tab’s storage before saving; no new request can be sent.'
              : message}
          </p>
          <div className="flex flex-wrap gap-3">
            <Button
              type="button"
              variant="secondary"
              className="min-h-11"
              disabled={phase === 'loading' || phase === 'saving'}
              onClick={() => void read()}
            >
              Reload selection for editing
            </Button>
            {pending.current && !resolution.current && (
              <Button
                type="button"
                className="min-h-11"
                disabled={phase === 'loading' || phase === 'saving' || !state || journal.error}
                onClick={() => {
                  if (!alive.current || busy.current || !pending.current || !state) return;
                  void send(pending.current);
                }}
              >
                Retry the same save
              </Button>
            )}
          </div>
          {state?.editing.status === 'UNAVAILABLE' && (
            <p className="text-sm text-gray-700">
              {state.editing.reason === 'NO_ASSIGNED_CURRICULUM'
                ? 'No curriculum is assigned. Course selection editing is unavailable.'
                : 'This saved course list cannot be safely edited in its current format or size. Its contents are preserved.'}
            </p>
          )}
          {state && (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                if (
                  locked ||
                  busy.current ||
                  !alive.current ||
                  currentDraft.current !== draft ||
                  !parsed.success
                )
                  return;
                const body = { ...parsed.data, requestId: crypto.randomUUID() };
                void send(body);
              }}
            >
              <fieldset disabled={locked} className="space-y-4">
                <legend className="sr-only">Saved reference selection</legend>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="text-sm">
                    Selection academic year
                    <input
                      type="number"
                      min="1"
                      step="1"
                      value={draft.year}
                      className={fieldClass}
                      onChange={(event) => change({ ...draft, year: event.target.value })}
                    />
                  </label>
                  <label className="text-sm">
                    Selection academic semester
                    <select
                      value={draft.semester}
                      className={fieldClass}
                      onChange={(event) => change({ ...draft, semester: event.target.value })}
                    >
                      <option value="">Choose semester</option>
                      <option value="1">Semester 1</option>
                      <option value="2">Semester 2</option>
                      <option value="3">Semester 3</option>
                    </select>
                  </label>
                </div>
                <p className="text-sm text-gray-700">
                  Selected courses: {draft.courseIds.length} of 100. Existing order is retained;
                  newly added courses follow it.
                </p>
                {draft.courseIds.length === 0 && (
                  <p className="text-sm">
                    The selection is empty. Saving will store an empty course list.
                  </p>
                )}
                <ol className="space-y-3">
                  {draft.courseIds.map((id, index) => {
                    const option = options.find((course) => course.id === id);
                    const entry =
                      state.snapshot.courseReferences.status === 'RECOGNIZED'
                        ? state.snapshot.courseReferences.entries.find(
                            (course) => course.courseId === id,
                          )
                        : null;
                    const catalog = option ?? entry?.catalog;
                    return (
                      <li
                        key={id}
                        className="flex flex-wrap items-center justify-between gap-3 rounded border border-gray-200 p-3"
                      >
                        <div className="min-w-0 flex-1 break-words text-sm">
                          {catalog
                            ? `${catalog.code} — ${catalog.name}`
                            : `Saved reference ${index + 1}: catalog entry unavailable`}
                          {!option && (
                            <p className="mt-1 text-amber-800">
                              Not available in current curriculum choices. Remove it before saving.
                            </p>
                          )}
                        </div>
                        <Button
                          type="button"
                          variant="secondary"
                          className="min-h-11"
                          onClick={() =>
                            change({
                              ...draft,
                              courseIds: draft.courseIds.filter((courseId) => courseId !== id),
                            })
                          }
                          aria-label={`Remove selected course ${index + 1}`}
                        >
                          Remove
                        </Button>
                      </li>
                    );
                  })}
                </ol>
                <div className="flex flex-wrap items-end gap-3">
                  <label className="min-w-0 flex-1 text-sm">
                    Add a current curriculum course
                    <select
                      value={choice}
                      className={fieldClass}
                      onChange={(event) => {
                        if (locked || busy.current || currentDraft.current !== draft) return;
                        choiceRef.current = event.target.value;
                        setChoice(event.target.value);
                      }}
                    >
                      <option value="">Choose a course</option>
                      {options
                        .filter(({ id }) => !draft.courseIds.includes(id))
                        .map((course) => (
                          <option key={course.id} value={course.id}>
                            {course.code} — {course.name}
                          </option>
                        ))}
                    </select>
                  </label>
                  <Button
                    type="button"
                    variant="secondary"
                    className="min-h-11"
                    disabled={!choice || draft.courseIds.length >= 100}
                    onClick={() => {
                      if (
                        choice !== choiceRef.current ||
                        !options.some(({ id }) => id === choice) ||
                        draft.courseIds.includes(choice) ||
                        draft.courseIds.length >= 100
                      )
                        return;
                      change({ ...draft, courseIds: [...draft.courseIds, choice] });
                    }}
                  >
                    Add course
                  </Button>
                </div>
                <Button
                  type="submit"
                  className="min-h-11"
                  disabled={
                    !parsed.success ||
                    draft.courseIds.some((id) => !options.some((course) => course.id === id))
                  }
                >
                  Save course selection
                </Button>
              </fieldset>
            </form>
          )}
          {receipt && (
            <p className="text-sm text-gray-700">
              Last acknowledged save: {receipt.courseIds.length} courses,{' '}
              {receipt.storedTotalCredits} stored credits, academic year{' '}
              {receipt.referenceSlot.academicYear}, semester{' '}
              {receipt.referenceSlot.academicSemester}. This acknowledgement describes that save;
              the current list comes from the latest read.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
export function SavedReferenceSelectionEditor(props: Props) {
  const normalized = {
    ...props,
    ownerId: props.ownerId.toLowerCase(),
    planId: props.planId.toLowerCase(),
    semesterId: props.semesterId.toLowerCase(),
    expectedCurriculumId: props.expectedCurriculumId?.toLowerCase() ?? null,
  };
  return (
    <EditorBody
      key={JSON.stringify([
        normalized.ownerId,
        normalized.planId,
        normalized.semesterId,
        normalized.expectedCurriculumId,
      ])}
      {...normalized}
    />
  );
}
