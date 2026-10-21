import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AxiosError } from 'axios';
import { previewReferenceSelection } from '@/lib/savedStudyPlanReferenceSelectionApi';
import { SavedStudyPlanCoursesSessionChangedError } from '@/lib/savedStudyPlanCoursesApi';
import {
  proposedSelectionBody,
  proposedSelectionPreview,
} from '@/test/fixtures/proposedReferenceSelection';
import {
  referenceSelectionScope,
  extraSelectionCourseId,
} from '@/test/fixtures/savedReferenceSelection';
import { referenceId } from '@/test/fixtures/curriculumReference';
import { ProposedReferenceSelectionCheck } from '../ProposedReferenceSelectionCheck';

vi.mock('@/lib/savedStudyPlanReferenceSelectionApi', () => ({
  previewReferenceSelection: vi.fn(),
}));
const preview = vi.mocked(previewReferenceSelection);
const props = {
  ...referenceSelectionScope,
  input: proposedSelectionBody(),
  courses: [
    { id: proposedSelectionBody().courseIds[0], code: 'CS101', name: 'Proposed reference course' },
  ],
  onInvalidated: vi.fn(),
};
const click = () => fireEvent.click(screen.getByRole('button', { name: 'Check proposed courses' }));
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
beforeEach(() => {
  vi.resetAllMocks();
  preview.mockImplementation(async (_scope, body) => proposedSelectionPreview(body));
});
afterEach(cleanup);
describe('proposed reference course diagnostics', () => {
  it('requires explicit checking and distinguishes current evidence from a saved or degree-valid plan', async () => {
    render(<ProposedReferenceSelectionCheck {...props} />);
    expect(preview).not.toHaveBeenCalled();
    click();
    await screen.findByText(/0 of 1 proposed courses have blockers/);
    expect(screen.getByText(/No blockers found in the current records/)).toBeInTheDocument();
    expect(screen.getByText(/later save/)).toBeInTheDocument();
    expect(preview.mock.calls[0][1]).toEqual(proposedSelectionBody());
    expect(preview.mock.calls[0][1]).not.toHaveProperty('requestId');
  });
  it.each([
    ['NO_CURRENT_PLACEMENT', null, /No placement in your currently assigned curriculum/],
    ['NO_MATCHING_REFERENCE_SLOT', 0, /Not listed for the academic year and semester/],
    ['UNMET_PREREQUISITE', 2, /2 mandatory prerequisites are not recorded as completed/],
    ['GPA_EXCLUDED', 0, /Not included in your current numeric GPA path/],
    ['GPA_UNDETERMINED', 0, /Numeric GPA is unknown/],
  ] as const)(
    'explains %s without calling it a registration decision',
    async (blocker, count, message) => {
      const input = { ...proposedSelectionBody(), academicYear: 4, academicSemester: 2 };
      const result = proposedSelectionPreview(input);
      result.assessment.gpaPath = blocker === 'GPA_EXCLUDED' ? 'THESIS' : null;
      result.assessment.entries[0] = {
        courseId: input.courseIds[0],
        blockers: [blocker],
        missingPrerequisiteCount: count,
      };
      preview.mockResolvedValue(result);
      render(<ProposedReferenceSelectionCheck {...props} input={input} />);
      click();
      await screen.findByText(message);
      expect(screen.getByText(/1 of 1 proposed courses have blockers/)).toBeInTheDocument();
    },
  );
  it('handles an empty proposed selection explicitly', async () => {
    render(
      <ProposedReferenceSelectionCheck {...props} input={{ ...props.input, courseIds: [] }} />,
    );
    click();
    expect(await screen.findByText(/No courses were assessed/)).toBeInTheDocument();
  });
  it('blocks duplicate checks while in flight and ignores the old result after changing course order', async () => {
    const first = deferred<ReturnType<typeof proposedSelectionPreview>>();
    preview.mockReturnValueOnce(first.promise);
    const input = { ...props.input, courseIds: [...props.input.courseIds, extraSelectionCourseId] };
    const view = render(<ProposedReferenceSelectionCheck {...props} input={input} />);
    const button = screen.getByRole('button', { name: 'Check proposed courses' });
    act(() => {
      fireEvent.click(button);
      fireEvent.click(button);
    });
    expect(preview).toHaveBeenCalledTimes(1);
    view.rerender(
      <ProposedReferenceSelectionCheck
        {...props}
        input={{ ...input, courseIds: [...input.courseIds].reverse() }}
      />,
    );
    await act(async () => first.resolve(proposedSelectionPreview(input)));
    expect(screen.queryByText(/proposed courses have blockers/)).not.toBeInTheDocument();
    expect(preview.mock.calls[0][2]?.aborted).toBe(true);
  });
  it.each(['revision', 'scope', 'planId', 'semesterId', 'slot', 'courses'] as const)(
    'rejects a response with changed %s before displaying evidence',
    async (field) => {
      const result = proposedSelectionPreview();
      if (field === 'revision') result.revision++;
      if (field === 'scope') result.scope.curriculumId = props.planId;
      if (field === 'planId') result.planId = referenceId;
      if (field === 'semesterId') result.semesterId = referenceId;
      if (field === 'slot') result.referenceSlot.academicYear++;
      if (field === 'courses') {
        result.courseIds = [];
        result.assessment.entries = [];
      }
      preview.mockResolvedValue(result);
      render(<ProposedReferenceSelectionCheck {...props} />);
      click();
      await screen.findByRole('alert');
      expect(screen.queryByText(/proposed courses have blockers/)).not.toBeInTheDocument();
    },
  );
  it('clears prior evidence during retry and permits retry after an ordinary failure', async () => {
    preview.mockRejectedValueOnce(new Error('offline'));
    render(<ProposedReferenceSelectionCheck {...props} />);
    click();
    await screen.findByRole('alert');
    click();
    await screen.findByText(/0 of 1 proposed courses have blockers/);
    const next = deferred<ReturnType<typeof proposedSelectionPreview>>();
    preview.mockReturnValueOnce(next.promise);
    click();
    expect(screen.queryByText(/No blockers found/)).not.toBeInTheDocument();
    await act(async () => next.resolve(proposedSelectionPreview()));
  });
  it.each([401, 403, 404])('invalidates parent evidence for HTTP %s', async (status) => {
    const error = new AxiosError('rejected');
    error.response = { status } as NonNullable<AxiosError['response']>;
    preview.mockRejectedValue(error);
    render(<ProposedReferenceSelectionCheck {...props} />);
    click();
    await screen.findByRole('alert');
    expect(props.onInvalidated).toHaveBeenCalledWith(status === 404 ? 'unavailable' : 'account');
  });
  it('invalidates parent evidence when session confirmation fails', async () => {
    preview.mockRejectedValue(new SavedStudyPlanCoursesSessionChangedError());
    render(<ProposedReferenceSelectionCheck {...props} />);
    click();
    await screen.findByRole('alert');
    expect(props.onInvalidated).toHaveBeenCalledWith('account');
  });
  it('ignores an old-account reply after scope remount', async () => {
    const first = deferred<ReturnType<typeof proposedSelectionPreview>>();
    preview.mockReturnValueOnce(first.promise);
    const view = render(<ProposedReferenceSelectionCheck {...props} />);
    click();
    view.rerender(<ProposedReferenceSelectionCheck {...props} ownerId={referenceId} />);
    await act(async () => first.resolve(proposedSelectionPreview()));
    expect(screen.queryByText(/No blockers found/)).not.toBeInTheDocument();
    expect(props.onInvalidated).not.toHaveBeenCalled();
  });

  it('returns focus to the check control when the check finishes', async () => {
    const pendingRead = deferred<Awaited<ReturnType<typeof previewReferenceSelection>>>();
    preview.mockReturnValueOnce(pendingRead.promise);
    render(<ProposedReferenceSelectionCheck {...props} />);
    const target = screen.getByRole('button', { name: 'Check proposed courses' });
    target.focus();
    act(() => {
      fireEvent.click(target);
      target.blur();
    });
    await waitFor(() => expect(target).toBeDisabled());
    expect(document.activeElement).toBe(document.body);
    await act(async () => pendingRead.resolve(await proposedSelectionPreview(props.input)));
    await waitFor(() => expect(target).toBeEnabled());
    expect(document.activeElement).toBe(target);
  });
});
