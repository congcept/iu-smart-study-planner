import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OwnStudyPlanCoursesDTO } from '@iu-study-planner/shared';
import {
  getSavedStudyPlanCourses,
  SavedStudyPlanCoursesSessionChangedError,
} from '@/lib/savedStudyPlanCoursesApi';
import { ownerId, referenceId } from '@/test/fixtures/curriculumReference';
import {
  savedCourseFixture,
  savedPlanId,
  savedSemesterId,
  savedCourseId,
} from '@/test/fixtures/savedStudyPlanCourses';
import {
  getSavedReferenceSelection,
  saveReferenceSelection,
} from '@/lib/savedStudyPlanReferenceSelectionApi';
import { referenceSelectionState } from '@/test/fixtures/savedReferenceSelection';
import { SavedStudyPlanCoursesPanel } from '../SavedStudyPlanCoursesPanel';
import { reviewSavedStudyPlanSemester } from '@/lib/savedStudyPlanReferenceReviewApi';

vi.mock('@/lib/savedStudyPlanCoursesApi', async (original) => ({
  ...(await original<typeof import('@/lib/savedStudyPlanCoursesApi')>()),
  getSavedStudyPlanCourses: vi.fn(),
}));
vi.mock('@/lib/savedStudyPlanReferenceReviewApi', () => ({
  reviewSavedStudyPlanSemester: vi.fn(),
}));
vi.mock('@/lib/savedStudyPlanReferenceSelectionApi', () => ({
  getSavedReferenceSelection: vi.fn(),
  saveReferenceSelection: vi.fn(),
}));
const editRead = vi.mocked(getSavedReferenceSelection);
const review = vi.mocked(reviewSavedStudyPlanSemester);
const read = vi.mocked(getSavedStudyPlanCourses);
const props = {
  ownerId,
  planId: savedPlanId,
  semesterId: savedSemesterId,
  expectedCurriculumId: null,
  onBack: vi.fn(),
};
function deferred() {
  let resolve!: (value: OwnStudyPlanCoursesDTO) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<OwnStudyPlanCoursesDTO>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
beforeEach(() => {
  vi.resetAllMocks();
  sessionStorage.clear();
  read.mockResolvedValue(savedCourseFixture());
});
afterEach(cleanup);
describe('saved semester course references', () => {
  it('retains partial unsent edits through the real focus refresh and restores only after an explicit fresh read', async () => {
    const current = referenceSelectionState(0);
    read.mockResolvedValue(current.snapshot);
    editRead.mockResolvedValue(current);
    render(<SavedStudyPlanCoursesPanel {...props} expectedCurriculumId={referenceId} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit saved course selection' }));
    fireEvent.change(await screen.findByLabelText('Selection academic year'), {
      target: { value: '2' },
    });
    fireEvent(window, new Event('focus'));
    fireEvent.click(await screen.findByRole('button', { name: 'Edit saved course selection' }));
    expect(await screen.findByLabelText('Selection academic year')).toHaveValue(null);
    expect(screen.getByLabelText('Selection academic year')).toBeDisabled();
    expect(saveReferenceSelection).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Restore unsent draft' }));
    await screen.findByText(/Unsent draft restored after checking/);
    expect(editRead).toHaveBeenCalledTimes(3);
    expect(screen.getByLabelText('Selection academic year')).toHaveValue(2);
    expect(screen.getByLabelText('Selection academic semester')).toHaveValue('');
    expect(saveReferenceSelection).not.toHaveBeenCalled();
  });
  it('hides all course and review evidence when edit-session verification fails', async () => {
    editRead.mockRejectedValue(new SavedStudyPlanCoursesSessionChangedError());
    render(<SavedStudyPlanCoursesPanel {...props} />);
    await screen.findByText(/Reference course/);
    fireEvent.click(screen.getByRole('button', { name: 'Edit saved course selection' }));
    await screen.findByRole('alert');
    expect(screen.queryByText(/Reference course/)).not.toBeInTheDocument();
    expect(
      screen.queryByRole('region', { name: 'Saved semester reference review' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('region', { name: 'Edit saved course selection' }),
    ).not.toBeInTheDocument();
  });
  it('mounts review only after confirmed references and hides all evidence on session invalidation', async () => {
    review.mockRejectedValue(new SavedStudyPlanCoursesSessionChangedError());
    render(<SavedStudyPlanCoursesPanel {...props} />);
    await screen.findByText(/Reference course/);
    fireEvent.change(screen.getByLabelText('Reference academic year'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('Reference academic semester'), {
      target: { value: '1' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Review reference slot' }));
    await screen.findByRole('alert');
    expect(screen.queryByText(/Reference course/)).not.toBeInTheDocument();
    expect(
      screen.queryByRole('region', { name: 'Saved semester reference review' }),
    ).not.toBeInTheDocument();
  });

  it('does not assess membership for an unassigned account', async () => {
    render(<SavedStudyPlanCoursesPanel {...props} />);
    expect(
      await screen.findByText(/No curriculum assigned — membership not assessed/),
    ).toBeInTheDocument();
    expect(screen.queryByText('Listed in your current curriculum.')).not.toBeInTheDocument();
  });
  it('distinguishes current placements from historical labels without asserting eligibility', async () => {
    const value = savedCourseFixture();
    value.scope.curriculumId = referenceId;
    value.courseReferences = {
      status: 'RECOGNIZED',
      order: 'STORED_ARRAY_ORDER',
      entries: [
        {
          courseId: savedCourseId,
          storedPosition: 5,
          catalog: { code: 'CS101', name: 'Placed reference' },
          currentCurriculumMembership: 'PLACED_MEMBER',
        },
        {
          courseId: referenceId,
          storedPosition: -2,
          catalog: { code: 'CS102', name: 'Unplaced reference' },
          currentCurriculumMembership: 'NO_CURRENT_PLACEMENT',
        },
        {
          courseId: ownerId,
          storedPosition: 0,
          catalog: null,
          currentCurriculumMembership: 'NO_CURRENT_PLACEMENT',
        },
      ],
    };
    read.mockResolvedValue(value);
    render(<SavedStudyPlanCoursesPanel {...props} expectedCurriculumId={referenceId} />);
    await screen.findByText(/Placed reference/);
    const entries = screen.getAllByRole('listitem');
    expect(entries[0]).toHaveTextContent('Listed in your current curriculum.');
    expect(entries[1]).toHaveTextContent('No placement in your current curriculum.');
    expect(entries[2]).toHaveTextContent('Current catalog entry unavailable');
    expect(entries[2]).toHaveTextContent('No placement in your current curriculum.');
    expect(screen.getByText(/do not establish the original curriculum/)).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /^(save|activate|complete)\b/i }),
    ).not.toBeInTheDocument();
  });
  it('hides membership indicators while refreshing and after a read failure', async () => {
    read.mockResolvedValueOnce(savedCourseFixture()).mockRejectedValueOnce(new Error('offline'));
    render(<SavedStudyPlanCoursesPanel {...props} />);
    await screen.findByText(/membership not assessed/);
    fireEvent.click(screen.getByRole('button', { name: 'Reload saved courses' }));
    expect(screen.queryByText(/membership not assessed/)).not.toBeInTheDocument();
    await screen.findByRole('alert');
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });
  it('rejects membership inconsistent with the confirmed curriculum', async () => {
    const value = savedCourseFixture();
    if (value.courseReferences.status === 'RECOGNIZED')
      value.courseReferences.entries[0].currentCurriculumMembership = 'PLACED_MEMBER';
    read.mockResolvedValue(value);
    render(<SavedStudyPlanCoursesPanel {...props} />);
    await screen.findByRole('alert');
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });

  it('shows escaped current labels with honest reference-only wording', async () => {
    const value = savedCourseFixture();
    if (value.courseReferences.status === 'RECOGNIZED')
      value.courseReferences.entries[0].catalog = {
        code: 'CS101',
        name: '<script>untrusted</script>',
      };
    read.mockResolvedValue(value);
    render(<SavedStudyPlanCoursesPanel {...props} />);
    expect(await screen.findByText(/untrusted/)).toBeInTheDocument();
    expect(document.querySelector('script')).toBeNull();
    expect(screen.getByText(/current catalog labels/)).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /save plan|activate|complete/i }),
    ).not.toBeInTheDocument();
  });
  it('preserves list order and exposes missing catalog entries without fabricating labels', async () => {
    read.mockResolvedValue(
      savedCourseFixture({
        courseReferences: {
          status: 'RECOGNIZED',
          order: 'STORED_ARRAY_ORDER',
          entries: [
            {
              courseId: savedCourseId,
              storedPosition: 99,
              currentCurriculumMembership: 'NO_ASSIGNED_CURRICULUM',
              catalog: { code: 'LAST', name: 'Saved first' },
            },
            {
              courseId: referenceId,
              storedPosition: -9,
              catalog: null,
              currentCurriculumMembership: 'NO_ASSIGNED_CURRICULUM',
            },
          ],
        },
      }),
    );
    render(<SavedStudyPlanCoursesPanel {...props} />);
    await screen.findByText(/Saved first/);
    const entries = screen.getAllByRole('listitem');
    expect(entries[0]).toHaveTextContent('LAST');
    expect(entries[1]).toHaveTextContent('unavailable for saved reference 2');
  });
  it.each(['READER_LIMIT', 'UNSUPPORTED_FORMAT'] as const)(
    'distinguishes %s from empty recognized content',
    async (reason) => {
      read.mockResolvedValue(
        savedCourseFixture({ courseReferences: { status: 'UNAVAILABLE', reason } }),
      );
      render(<SavedStudyPlanCoursesPanel {...props} />);
      expect(await screen.findByText(/contents have been preserved/)).toBeInTheDocument();
      expect(screen.queryByRole('list')).not.toBeInTheDocument();
      expect(screen.queryByText(/contains an empty/)).not.toBeInTheDocument();
    },
  );
  it('shows a recognized empty list honestly', async () => {
    read.mockResolvedValue(
      savedCourseFixture({
        courseReferences: { status: 'RECOGNIZED', order: 'STORED_ARRAY_ORDER', entries: [] },
      }),
    );
    render(<SavedStudyPlanCoursesPanel {...props} />);
    expect(await screen.findByText(/contains an empty course list/)).toBeInTheDocument();
  });
  it('hides old labels on reload failure and retries', async () => {
    read
      .mockResolvedValueOnce(savedCourseFixture())
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(savedCourseFixture());
    render(<SavedStudyPlanCoursesPanel {...props} />);
    await screen.findByText(/Reference course/);
    fireEvent.click(screen.getByRole('button', { name: 'Reload saved courses' }));
    expect(screen.queryByText(/Reference course/)).not.toBeInTheDocument();
    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: 'Retry saved courses' }));
    expect(await screen.findByText(/Reference course/)).toBeInTheDocument();
  });
  it('keeps back available while pending and aborts unmounted reads', () => {
    const pending = deferred();
    read.mockReturnValue(pending.promise);
    const view = render(<SavedStudyPlanCoursesPanel {...props} />);
    const signal = read.mock.calls[0][4];
    fireEvent.click(screen.getByRole('button', { name: 'Back to saved semesters' }));
    expect(props.onBack).toHaveBeenCalledOnce();
    view.unmount();
    expect(signal?.aborted).toBe(true);
  });
  it.each(['scope', 'plan', 'semester', 'owner'] as const)(
    'rejects wrong %s from an adapter',
    async (kind) => {
      const value = savedCourseFixture();
      if (kind === 'scope') value.scope.curriculumId = referenceId;
      if (kind === 'owner') value.scope.userId = referenceId;
      if (kind === 'plan') value.plan.id = referenceId;
      if (kind === 'semester') value.semester.id = referenceId;
      read.mockResolvedValue(value);
      render(<SavedStudyPlanCoursesPanel {...props} />);
      await screen.findByRole('alert');
      expect(screen.queryByText(/Reference course/)).not.toBeInTheDocument();
    },
  );
  it.each(['resolve', 'reject'] as const)(
    'ignores an old %s after semester selection changes',
    async (mode) => {
      const old = deferred();
      read
        .mockReturnValueOnce(old.promise)
        .mockResolvedValueOnce(
          savedCourseFixture({ semester: { ...savedCourseFixture().semester, id: referenceId } }),
        );
      const view = render(<SavedStudyPlanCoursesPanel {...props} />);
      view.rerender(<SavedStudyPlanCoursesPanel {...props} semesterId={referenceId} />);
      await screen.findByText(/Reference course/);
      await act(async () => {
        if (mode === 'resolve') old.resolve(savedCourseFixture());
        else old.reject(new Error('old'));
      });
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    },
  );
  it('offers account recovery without retrying old evidence', async () => {
    read.mockRejectedValue(new SavedStudyPlanCoursesSessionChangedError());
    render(<SavedStudyPlanCoursesPanel {...props} />);
    await screen.findByRole('alert');
    expect(screen.queryByRole('button', { name: 'Retry saved courses' })).not.toBeInTheDocument();
  });
});
