import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, within, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OwnStudyPlanReferenceReviewDTO } from '@iu-study-planner/shared';
import { reviewSavedStudyPlanSemester } from '@/lib/savedStudyPlanReferenceReviewApi';
import { SavedStudyPlanCoursesSessionChangedError } from '@/lib/savedStudyPlanCoursesApi';
import { ownerId, referenceId } from '@/test/fixtures/curriculumReference';
import { savedPlanId, savedSemesterId } from '@/test/fixtures/savedStudyPlanCourses';
import { referenceReviewFixture } from '@/test/fixtures/savedSemesterReferenceReview';
import { dropFocusToBody } from '@/test/dropFocusToBody';
import { SavedSemesterReferenceReview } from '../SavedSemesterReferenceReview';

vi.mock('@/lib/savedStudyPlanReferenceReviewApi', () => ({
  reviewSavedStudyPlanSemester: vi.fn(),
}));
const read = vi.mocked(reviewSavedStudyPlanSemester);
const props = {
  ownerId,
  planId: savedPlanId,
  semesterId: savedSemesterId,
  expectedCurriculumId: referenceId,
  onInvalidated: vi.fn(),
};
function choose(year = '2', semester = '1') {
  fireEvent.change(screen.getByLabelText('Reference academic year'), { target: { value: year } });
  fireEvent.change(screen.getByLabelText('Reference academic semester'), {
    target: { value: semester },
  });
}
const submit = () => fireEvent.click(screen.getByRole('button', { name: 'Review reference slot' }));
function deferred() {
  let resolve!: (value: OwnStudyPlanReferenceReviewDTO) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<OwnStudyPlanReferenceReviewDTO>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
beforeEach(() => {
  vi.resetAllMocks();
  read.mockResolvedValue(referenceReviewFixture());
});
afterEach(cleanup);
describe('saved semester explicit reference review', () => {
  it('remounts on scope changes and rejects late evidence from the previous semester', async () => {
    const pending = deferred();
    read.mockReturnValueOnce(pending.promise);
    const view = render(<SavedSemesterReferenceReview {...props} />);
    choose();
    submit();
    const signal = read.mock.calls[0][6];
    view.rerender(<SavedSemesterReferenceReview {...props} semesterId={referenceId} />);
    expect(signal?.aborted).toBe(true);
    expect(screen.getByRole('button', { name: 'Review reference slot' })).toBeDisabled();
    await act(async () => pending.resolve(referenceReviewFixture()));
    expect(screen.queryByText(/No blockers found/)).not.toBeInTheDocument();
  });

  it('starts without an inferred slot or automatic request', () => {
    render(<SavedSemesterReferenceReview {...props} />);
    expect(screen.getByRole('button', { name: 'Review reference slot' })).toBeDisabled();
    expect(read).not.toHaveBeenCalled();
    expect(screen.getByText(/saved calendar year is not used/)).toBeInTheDocument();
  });
  it('reviews chosen inputs and retains unverified saving/calendar wording', async () => {
    render(<SavedSemesterReferenceReview {...props} />);
    choose();
    submit();
    expect(
      await screen.findByText('No blockers found for this reference review.'),
    ).toBeInTheDocument();
    expect(read).toHaveBeenCalledWith(
      ownerId,
      savedPlanId,
      savedSemesterId,
      referenceId,
      2,
      1,
      expect.any(AbortSignal),
    );
    expect(
      screen.getByText(/Calendar, original curriculum and permission to save remain unverified/),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^(save|activate)\b/i })).not.toBeInTheDocument();
  });
  it('shows mandatory prerequisite blockers and counts', async () => {
    const result = referenceReviewFixture();
    if (result.review.status === 'ASSESSED')
      result.review.entries[0] = {
        ...result.review.entries[0],
        blockers: ['UNMET_PREREQUISITE', 'NO_MATCHING_REFERENCE_SLOT'],
        missingPrerequisiteCount: 2,
      };
    read.mockResolvedValue(result);
    render(<SavedSemesterReferenceReview {...props} />);
    choose();
    submit();
    expect(await screen.findByText('Missing completed prerequisites: 2.')).toBeInTheDocument();
    expect(screen.getByText(/No placement in the selected academic/)).toBeInTheDocument();
  });
  it('shows an unknown GPA path without implying eligibility', async () => {
    const result = referenceReviewFixture();
    result.referenceSlot = { academicYear: 4, academicSemester: 2 };
    if (result.review.status === 'ASSESSED')
      result.review.entries[0].blockers = ['GPA_UNDETERMINED'];
    read.mockResolvedValue(result);
    render(<SavedSemesterReferenceReview {...props} />);
    choose('4', '2');
    submit();
    expect(await screen.findByText(/Numeric GPA is needed/)).toBeInTheDocument();
    expect(
      screen.queryByText('No blockers found for this reference review.'),
    ).not.toBeInTheDocument();
  });
  it('distinguishes an unavailable review from a recognized empty list', async () => {
    const result = referenceReviewFixture();
    result.snapshot.courseReferences = { status: 'UNAVAILABLE', reason: 'READER_LIMIT' };
    result.review = { status: 'UNAVAILABLE', reason: 'COURSE_REFERENCES_UNAVAILABLE' };
    read.mockResolvedValueOnce(result).mockResolvedValueOnce({
      ...referenceReviewFixture(),
      snapshot: {
        ...referenceReviewFixture().snapshot,
        courseReferences: { status: 'RECOGNIZED', order: 'STORED_ARRAY_ORDER', entries: [] },
      },
      review: {
        status: 'ASSESSED',
        basis: 'CURRENT_COMPLETIONS_ONLY',
        gpaPath: null,
        entries: [],
      },
    });
    render(<SavedSemesterReferenceReview {...props} />);
    choose();
    submit();
    await screen.findByText(/cannot be reviewed in its current format/);
    submit();
    expect(await screen.findByText('This recognized course list is empty.')).toBeInTheDocument();
  });
  it.each(['resolve', 'reject'] as const)(
    'ignores old %s after changing the slot',
    async (mode) => {
      const pending = deferred();
      read.mockReturnValueOnce(pending.promise);
      render(<SavedSemesterReferenceReview {...props} />);
      choose();
      submit();
      const signal = read.mock.calls[0][6];
      choose('3', '1');
      expect(signal?.aborted).toBe(true);
      await act(async () => {
        if (mode === 'resolve') pending.resolve(referenceReviewFixture());
        else pending.reject(new Error('old'));
      });
      expect(screen.queryByText(/No blockers found/)).not.toBeInTheDocument();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    },
  );
  it('hides old evidence on reload failure and allows explicit retry', async () => {
    read
      .mockResolvedValueOnce(referenceReviewFixture())
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(referenceReviewFixture());
    render(<SavedSemesterReferenceReview {...props} />);
    choose();
    submit();
    await screen.findByText(/No blockers found/);
    submit();
    expect(screen.queryByText(/No blockers found/)).not.toBeInTheDocument();
    await screen.findByRole('alert');
    submit();
    await screen.findByText(/No blockers found/);
  });
  it('invalidates parent evidence on a changed account', async () => {
    read.mockRejectedValue(new SavedStudyPlanCoursesSessionChangedError());
    render(<SavedSemesterReferenceReview {...props} />);
    choose();
    submit();
    await vi.waitFor(() => expect(props.onInvalidated).toHaveBeenCalledWith('account'));
  });
  it('aborts an unmounted review and ignores its late result', async () => {
    const pending = deferred();
    read.mockReturnValueOnce(pending.promise);
    const view = render(<SavedSemesterReferenceReview {...props} />);
    choose();
    submit();
    const signal = read.mock.calls[0][6];
    view.unmount();
    expect(signal?.aborted).toBe(true);
    await act(async () => pending.resolve(referenceReviewFixture()));
    expect(props.onInvalidated).not.toHaveBeenCalled();
  });
  it('rejects a mismatched slot from an adapter', async () => {
    const result = referenceReviewFixture();
    result.referenceSlot.academicYear = 3;
    read.mockResolvedValue(result);
    render(<SavedSemesterReferenceReview {...props} />);
    choose();
    submit();
    await screen.findByRole('alert');
    expect(screen.queryByText(/No blockers found/)).not.toBeInTheDocument();
  });
  it('blocks a batched stale form submit after an input intent changes', async () => {
    render(<SavedSemesterReferenceReview {...props} />);
    choose();
    const form = screen.getByRole('button', { name: 'Review reference slot' }).closest('form')!;
    const year = within(form).getByLabelText('Reference academic year');
    act(() => {
      fireEvent.change(year, { target: { value: '3' } });
      fireEvent.submit(form);
    });
    if (read.mock.calls.length) expect(read.mock.calls[0][4]).toBe(3);
  });

  it('returns focus to the review control when the slot review finishes', async () => {
    const pendingRead = deferred();
    read.mockReturnValueOnce(pendingRead.promise);
    render(<SavedSemesterReferenceReview {...props} />);
    choose();
    const target = screen.getByRole('button', { name: 'Review reference slot' });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Review reference slot' })).toBeEnabled(),
    );
    target.focus();
    fireEvent.click(target);
    await waitFor(() => expect(target).toBeDisabled());
    dropFocusToBody();
    expect(target).not.toHaveFocus();
    expect(document.activeElement).toBe(document.body);
    await act(async () => pendingRead.resolve(referenceReviewFixture()));
    await waitFor(() => expect(target).toBeEnabled());
    expect(document.activeElement).toBe(target);
  });
});
