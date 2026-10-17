import { useEffect, useRef, useState } from 'react';
import { isAxiosError } from 'axios';
import {
  OwnStudyPlanReferenceSelectionPreviewSchema,
  type OwnStudyPlanReferenceSelectionPreviewBodyDTO,
  type OwnStudyPlanReferenceSelectionPreviewDTO,
} from '@iu-study-planner/shared';
import { Button } from '@/components/ui';
import { SavedStudyPlanCoursesSessionChangedError } from '@/lib/savedStudyPlanCoursesApi';
import {
  previewReferenceSelection,
  type ReferenceSelectionScope,
} from '@/lib/savedStudyPlanReferenceSelectionApi';

type Props = ReferenceSelectionScope & {
  input: OwnStudyPlanReferenceSelectionPreviewBodyDTO;
  courses: { id: string; code: string; name: string }[];
  onInvalidated: (kind: 'account' | 'unavailable') => void;
};
type State =
  | { status: 'idle' | 'loading' | 'error' }
  | {
      status: 'ready';
      result: OwnStudyPlanReferenceSelectionPreviewDTO;
    };

function CheckBody({
  ownerId,
  expectedCurriculumId,
  planId,
  semesterId,
  input,
  courses,
  onInvalidated,
}: Props) {
  const [state, setState] = useState<State>({ status: 'idle' });
  const alive = useRef(false);
  const busy = useRef(false);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    const activeAlive = alive;
    const activeController = controller;
    activeAlive.current = true;
    return () => {
      activeAlive.current = false;
      activeController.current?.abort();
    };
  }, []);
  const check = async () => {
    if (!alive.current || busy.current) return;
    busy.current = true;
    const active = new AbortController();
    controller.current?.abort();
    controller.current = active;
    const current = () => alive.current && controller.current === active && !active.signal.aborted;
    setState({ status: 'loading' });
    try {
      const received = await previewReferenceSelection(
        { ownerId, expectedCurriculumId, planId, semesterId },
        input,
        active.signal,
      );
      if (!current()) return;
      const result = OwnStudyPlanReferenceSelectionPreviewSchema.parse(received);
      if (
        result.scope.userId !== ownerId ||
        result.scope.curriculumId !== expectedCurriculumId ||
        result.planId !== planId ||
        result.semesterId !== semesterId ||
        result.revision !== input.expectedRevision ||
        result.referenceSlot.academicYear !== input.academicYear ||
        result.referenceSlot.academicSemester !== input.academicSemester ||
        JSON.stringify(result.courseIds) !== JSON.stringify(input.courseIds)
      )
        throw new Error('Unexpected course check');
      setState({ status: 'ready', result });
    } catch (error) {
      if (!current()) return;
      setState({ status: 'error' });
      const status = isAxiosError(error) ? error.response?.status : undefined;
      if (
        error instanceof SavedStudyPlanCoursesSessionChangedError ||
        status === 401 ||
        status === 403
      )
        onInvalidated('account');
      else if (status === 404) onInvalidated('unavailable');
    } finally {
      if (current()) busy.current = false;
    }
  };
  return (
    <section
      aria-label="Proposed course check"
      className="space-y-3 rounded border border-gray-200 p-3"
    >
      <h5 className="font-semibold text-gray-900">Check proposed courses</h5>
      <p className="max-w-prose text-sm text-gray-700">
        Check this selection against current completed records, academic placements and numeric GPA.
        This does not save courses or confirm a timetable or degree plan. Saving checks the rules
        again.
      </p>
      <Button
        type="button"
        variant="secondary"
        className="min-h-11"
        disabled={state.status === 'loading'}
        onClick={() => void check()}
      >
        {state.status === 'loading' ? 'Checking proposed courses…' : 'Check proposed courses'}
      </Button>
      {state.status === 'error' && (
        <p role="alert" className="text-sm text-red-700">
          Could not confirm this proposed selection. Reload the saved selection if it changed, then
          check again. No courses were saved by this check.
        </p>
      )}
      {state.status === 'ready' && (
        <div className="space-y-3">
          <p role="status" className="text-sm text-gray-700">
            {state.result.assessment.entries.length === 0
              ? 'The proposed selection is empty. No courses were assessed.'
              : `${state.result.assessment.entries.filter(({ blockers }) => blockers.length > 0).length} of ${state.result.assessment.entries.length} proposed courses have blockers in this check.`}
          </p>
          <ol className="space-y-3 text-sm text-gray-700">
            {state.result.assessment.entries.map((entry, index) => {
              const course = courses.find(({ id }) => id === entry.courseId);
              return (
                <li key={entry.courseId} className="space-y-1 break-words">
                  <strong>
                    {course ? `${course.code} — ${course.name}` : `Proposed course ${index + 1}`}
                  </strong>
                  {entry.blockers.length === 0 ? (
                    <p>No blockers found in the current records at the time of this check.</p>
                  ) : (
                    <ul className="list-inside list-disc space-y-1">
                      {entry.blockers.map((blocker) => (
                        <li key={blocker}>
                          {blocker === 'NO_CURRENT_PLACEMENT'
                            ? 'No placement in your currently assigned curriculum.'
                            : blocker === 'NO_MATCHING_REFERENCE_SLOT'
                              ? 'Not listed for the academic year and semester you chose.'
                              : blocker === 'GPA_EXCLUDED'
                                ? 'Not included in your current numeric GPA path.'
                                : blocker === 'GPA_UNDETERMINED'
                                  ? 'Numeric GPA is unknown. Course scores are needed to determine this GPA-dependent path.'
                                  : `${entry.missingPrerequisiteCount} mandatory prerequisite${entry.missingPrerequisiteCount === 1 ? ' is' : 's are'} not recorded as completed.`}
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ol>
          <p className="max-w-prose text-sm text-gray-600">
            Selected peers and other saved semesters do not satisfy prerequisites. Later grade or
            progress changes can change these results; this check does not authorize a later save.
          </p>
        </div>
      )}
    </section>
  );
}

export function ProposedReferenceSelectionCheck(props: Props) {
  return (
    <CheckBody
      key={JSON.stringify([
        props.ownerId,
        props.expectedCurriculumId,
        props.planId,
        props.semesterId,
        props.input,
      ])}
      {...props}
    />
  );
}
