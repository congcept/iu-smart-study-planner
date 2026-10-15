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
import { SavedStudyPlanCoursesPanel } from '../SavedStudyPlanCoursesPanel';

vi.mock('@/lib/savedStudyPlanCoursesApi', async (original) => ({
  ...(await original<typeof import('@/lib/savedStudyPlanCoursesApi')>()),
  getSavedStudyPlanCourses: vi.fn(),
}));
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
  read.mockResolvedValue(savedCourseFixture());
});
afterEach(cleanup);
describe('saved semester course references', () => {
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
      screen.queryByRole('button', { name: /save plan|edit|activate|complete/i }),
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
              catalog: { code: 'LAST', name: 'Saved first' },
            },
            { courseId: referenceId, storedPosition: -9, catalog: null },
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
