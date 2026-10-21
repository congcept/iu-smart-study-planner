import { useCallback, useEffect, useRef, useState } from 'react';
import { isAxiosError } from 'axios';
import {
  OwnStudyPlanReferenceReviewSchema,
  type OwnStudyPlanReferenceReviewDTO,
} from '@iu-study-planner/shared';
import { Button, ErrorBanner } from '@/components/ui';
import { useFocusAfterDisable } from '@/lib/useFocusAfterDisable';
import { reviewSavedStudyPlanSemester } from '@/lib/savedStudyPlanReferenceReviewApi';
import { SavedStudyPlanCoursesSessionChangedError } from '@/lib/savedStudyPlanCoursesApi';

type Props = {
  ownerId: string;
  planId: string;
  semesterId: string;
  expectedCurriculumId: string | null;
  onInvalidated: (kind: 'account' | 'unavailable') => void;
};
type State =
  | { status: 'idle' | 'loading' | 'error' }
  | { status: 'ready'; result: OwnStudyPlanReferenceReviewDTO };
const blockerLabels = {
  NO_CURRENT_PLACEMENT: 'No placement in your current curriculum.',
  NO_MATCHING_REFERENCE_SLOT: 'No placement in the selected academic year and semester.',
  GPA_EXCLUDED: 'Excluded by your current numeric GPA path.',
  GPA_UNDETERMINED: 'Numeric GPA is needed to determine this course’s GPA path.',
  UNMET_PREREQUISITE: 'Mandatory prerequisites are not recorded as completed.',
};

function ReferenceReviewBody({
  ownerId,
  planId,
  semesterId,
  expectedCurriculumId,
  onInvalidated,
}: Props) {
  const [year, setYear] = useState('');
  const [semester, setSemester] = useState('');
  const draft = useRef({ year: '', semester: '' });
  const [state, setState] = useState<State>({ status: 'idle' });
  const generation = useRef(0);
  const alive = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const busy = useRef(false);
  const rememberFocus = useFocusAfterDisable(state.status === 'loading');
  const invalidate = useCallback(() => {
    generation.current++;
    controller.current?.abort();
    busy.current = false;
  }, []);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      invalidate();
    };
  }, [invalidate]);
  const clear = () => {
    invalidate();
    setState({ status: 'idle' });
  };
  const academicYear = Number(year);
  const academicSemester = Number(semester);
  const valid =
    year.trim() !== '' &&
    Number.isSafeInteger(academicYear) &&
    academicYear > 0 &&
    [1, 2, 3].includes(academicSemester);
  const review = async () => {
    if (
      !alive.current ||
      busy.current ||
      !valid ||
      draft.current.year !== year ||
      draft.current.semester !== semester
    )
      return;
    invalidate();
    busy.current = true;
    const version = generation.current;
    const active = new AbortController();
    controller.current = active;
    const current = () => alive.current && generation.current === version && !active.signal.aborted;
    setState({ status: 'loading' });
    try {
      const result = OwnStudyPlanReferenceReviewSchema.parse(
        await reviewSavedStudyPlanSemester(
          ownerId,
          planId,
          semesterId,
          expectedCurriculumId,
          academicYear,
          academicSemester,
          active.signal,
        ),
      );
      if (!current()) return;
      if (
        result.snapshot.scope.userId !== ownerId ||
        result.snapshot.scope.curriculumId !== expectedCurriculumId ||
        result.snapshot.plan.id !== planId ||
        result.snapshot.semester.id !== semesterId ||
        result.referenceSlot.academicYear !== academicYear ||
        result.referenceSlot.academicSemester !== academicSemester
      )
        throw new Error('Reference review scope changed');
      setState({ status: 'ready', result });
    } catch (error) {
      if (!current()) return;
      const status = isAxiosError(error) ? error.response?.status : undefined;
      if (
        error instanceof SavedStudyPlanCoursesSessionChangedError ||
        status === 401 ||
        status === 403 ||
        status === 409
      )
        onInvalidated('account');
      else if (status === 404) onInvalidated('unavailable');
      else setState({ status: 'error' });
    } finally {
      if (current()) busy.current = false;
    }
  };
  return (
    <section
      aria-label="Saved semester reference review"
      className="mt-6 border-t border-gray-200 pt-5"
    >
      <h4 className="font-semibold text-gray-900">Review against an academic slot</h4>
      <p className="mt-2 max-w-prose text-sm text-gray-700">
        Choose a year within the degree and a semester. The saved calendar year is not used to infer
        this slot. Only your current recorded completions satisfy prerequisites; courses in this or
        other saved semesters do not. This review does not save changes or confirm a valid timetable
        or degree plan.
      </p>
      <form
        className="mt-4 flex flex-wrap items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          rememberFocus();
          void review();
        }}
      >
        <label className="text-sm text-gray-700">
          Reference academic year
          <input
            type="number"
            min="1"
            step="1"
            value={year}
            onChange={(event) => {
              clear();
              draft.current.year = event.target.value;
              setYear(event.target.value);
            }}
            className="mt-1 block min-h-11 w-36 rounded border border-gray-300 p-2"
          />
        </label>
        <label className="text-sm text-gray-700">
          Reference academic semester
          <select
            value={semester}
            onChange={(event) => {
              clear();
              draft.current.semester = event.target.value;
              setSemester(event.target.value);
            }}
            className="mt-1 block min-h-11 rounded border border-gray-300 p-2"
          >
            <option value="">Choose semester</option>
            <option value="1">Semester 1</option>
            <option value="2">Semester 2</option>
            <option value="3">Semester 3</option>
          </select>
        </label>
        <Button
          type="submit"
          variant="secondary"
          className="min-h-11"
          disabled={!valid || state.status === 'loading'}
        >
          Review reference slot
        </Button>
      </form>
      {state.status === 'loading' && (
        <p role="status" className="mt-4 text-sm">
          Reviewing current records…
        </p>
      )}
      {state.status === 'error' && (
        <ErrorBanner className="mt-4 text-sm text-red-700">
          Could not confirm this review. Use Review reference slot to retry.
        </ErrorBanner>
      )}
      {state.status === 'ready' && (
        <div className="mt-4 space-y-3 text-sm text-gray-700">
          <p>
            Academic year {state.result.referenceSlot.academicYear}, semester{' '}
            {state.result.referenceSlot.academicSemester} — current-record review only.
          </p>
          {state.result.review.status === 'UNAVAILABLE' ? (
            <p role="status">
              {state.result.review.reason === 'NO_ASSIGNED_CURRICULUM'
                ? 'No curriculum is assigned, so this review cannot assess courses.'
                : 'This saved course list cannot be reviewed in its current format or size.'}
            </p>
          ) : (
            <>
              {state.result.review.entries.length === 0 && (
                <p>This recognized course list is empty.</p>
              )}
              <ul className="space-y-3">
                {state.result.review.entries.map((entry, index) => {
                  const catalog =
                    state.result.snapshot.courseReferences.status === 'RECOGNIZED'
                      ? state.result.snapshot.courseReferences.entries[index].catalog
                      : null;
                  return (
                    <li key={entry.courseId}>
                      <p className="break-words font-medium">
                        {catalog
                          ? `${catalog.code} — ${catalog.name}`
                          : `Saved reference ${index + 1}: catalog entry unavailable`}
                      </p>
                      {entry.blockers.length === 0 ? (
                        <p>No blockers found for this reference review.</p>
                      ) : (
                        <ul className="ml-5 list-disc">
                          {entry.blockers.map((blocker) => (
                            <li key={blocker}>{blockerLabels[blocker]}</li>
                          ))}
                        </ul>
                      )}
                      {entry.missingPrerequisiteCount !== null &&
                        entry.missingPrerequisiteCount > 0 && (
                          <p>Missing completed prerequisites: {entry.missingPrerequisiteCount}.</p>
                        )}
                    </li>
                  );
                })}
              </ul>
            </>
          )}
          <p>Calendar, original curriculum and permission to save remain unverified.</p>
        </div>
      )}
    </section>
  );
}

export function SavedSemesterReferenceReview(props: Props) {
  const ownerId = props.ownerId.toLowerCase();
  const planId = props.planId.toLowerCase();
  const semesterId = props.semesterId.toLowerCase();
  const expectedCurriculumId = props.expectedCurriculumId?.toLowerCase() ?? null;
  return (
    <ReferenceReviewBody
      key={JSON.stringify([ownerId, planId, semesterId, expectedCurriculumId])}
      {...props}
      ownerId={ownerId}
      planId={planId}
      semesterId={semesterId}
      expectedCurriculumId={expectedCurriculumId}
    />
  );
}
