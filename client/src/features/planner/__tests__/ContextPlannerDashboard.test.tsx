import '@testing-library/jest-dom/vitest';
import { MemoryRouter } from 'react-router-dom';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthUserDTO, CurriculumSemesterPreviewDTO } from '@iu-study-planner/shared';
import * as api from '@/lib/api';
import { PlannerDashboard } from '../PlannerDashboard';

const children = vi.hoisted(() => ({ workload: vi.fn(), recommendations: vi.fn() }));
vi.mock('@/lib/api', () => ({
  getSession: vi.fn(),
  getCourses: vi.fn(),
  getCurrentStudentProgress: vi.fn(),
  getCurriculumSemesterPreview: vi.fn(),
}));
vi.mock('../WorkloadAnalyzer', () => ({
  WorkloadAnalyzer: (props: unknown) => {
    children.workload(props);
    return <p>Legacy workload</p>;
  },
}));
vi.mock('../../recommendations/Recommendations', () => ({
  Recommendations: (props: unknown) => {
    children.recommendations(props);
    return <p>Legacy recommendations</p>;
  },
}));

const contextA = '11111111-1111-4111-8111-111111111111';
const contextB = '22222222-2222-4222-8222-222222222222';
const courseId = '33333333-3333-4333-8333-333333333333';
let currentOwner = 'alice';
let currentContext: string | null = contextA;
const session = (changes: Partial<AuthUserDTO> = {}): AuthUserDTO => ({
  id: currentOwner,
  studentId: 'SIMULATED',
  name: 'Simulated planner owner',
  email: 'planner@example.test',
  role: 'STUDENT',
  curriculumId: currentContext,
  ...changes,
});
function preview(curriculumId = contextA, name = 'Scoped Calculus'): CurriculumSemesterPreviewDTO {
  return {
    scope: {
      curriculumId,
      usage: 'REFERENCE_ONLY',
      planningBasis: 'SELECTED_COURSES',
      ratingPrior: { mean: 2, source: 'CURRICULUM_SEED' },
      electiveRequirementsValidated: false,
      offeringValidationAvailable: false,
      calendarDatesAvailable: false,
    },
    gpaPath: null,
    slots: [
      {
        academicYear: 1,
        academicSemester: 1,
        courseIds: [courseId],
        totalCredits: 3,
        averageDifficulty: 2,
      },
    ],
    courses: [
      {
        id: courseId,
        code: 'MA001IU',
        name,
        credits: 3,
        difficultyLevel: 2,
        description: null,
        semesterOffered: ['FALL', 'SPRING'],
        avgRating: null,
        ratingCount: 0,
        ratingDifficulty: 2,
        ratingPriorMean: 2,
        ratingPriorSource: 'CURRICULUM_SEED',
        placements: [
          {
            id: '44444444-4444-4444-8444-444444444444',
            academicYear: 1,
            academicSemester: 1,
            electiveGroup: null,
            electiveSelectCount: null,
            sourceOrder: 0,
            sourceLabel: 'Simulated reference',
          },
        ],
      },
    ],
    ignoredPlannedIds: [],
    unscheduled: [],
    stats: {
      selectedCourseCount: 1,
      scheduledCourseCount: 1,
      unscheduledCourseCount: 0,
      selectedCredits: 3,
      scheduledCredits: 3,
      semestersToCompletion: null,
      totalRemainingCredits: null,
      estimatedGraduation: null,
    },
    requirements: [],
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
const dashboard = (userId = 'alice') => {
  currentOwner = userId;
  return (
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <PlannerDashboard userId={userId} />
    </MemoryRouter>
  );
};
const confirmedPreview = () => screen.findByRole('heading', { name: 'Reference semester preview' });
const reload = () => fireEvent.click(screen.getByRole('button', { name: 'Reload planner' }));
const noLegacyReads = () => {
  expect(api.getCourses).not.toHaveBeenCalled();
  expect(api.getCurrentStudentProgress).not.toHaveBeenCalled();
  expect(children.workload).not.toHaveBeenCalled();
  expect(children.recommendations).not.toHaveBeenCalled();
};

beforeEach(() => {
  vi.resetAllMocks();
  currentOwner = 'alice';
  currentContext = contextA;
  vi.mocked(api.getSession).mockImplementation(async () => session());
  vi.mocked(api.getCurriculumSemesterPreview).mockImplementation(async (_mode, id) => preview(id));
  vi.mocked(api.getCurrentStudentProgress).mockResolvedValue({ completedIds: {}, plannedIds: [] });
  vi.mocked(api.getCourses).mockResolvedValue({ success: true, data: [] });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('assigned curriculum Planner dashboard', () => {
  it('confirms cookie session scope before fetching any planner data', async () => {
    const pending = deferred<AuthUserDTO>();
    vi.mocked(api.getSession).mockReturnValueOnce(pending.promise);
    render(dashboard());
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(api.getCurriculumSemesterPreview).not.toHaveBeenCalled();
    noLegacyReads();
    await act(async () => pending.resolve(session()));
    await confirmedPreview();
    expect(api.getCurriculumSemesterPreview).toHaveBeenCalledWith('normal', contextA);
    noLegacyReads();
  });

  it('renders contextual slots and rating confidence without a legacy planner or write controls', async () => {
    render(dashboard());
    await confirmedPreview();
    expect(screen.getAllByText('Scoped Calculus')).toHaveLength(2);
    expect(screen.getByRole('heading', { name: 'Saved planned courses' })).toBeInTheDocument();
    expect(screen.getByLabelText('Planning intensity')).toHaveValue('normal');
    expect(screen.getByText('No ratings yet')).toBeInTheDocument();
    expect(
      screen.getByText(/prior uses seed estimates in this reference curriculum/),
    ).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Year 1, Semester 1' })).toHaveTextContent(
      'Average rating difficulty 2.0 / 5',
    );
    expect(
      screen.queryByRole('button', { name: /add|save|complete|clear/i }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/graduation date|expected graduation/i)).not.toBeInTheDocument();
    noLegacyReads();
  });

  it.each([undefined, '', 'not-a-uuid', 42, {}])(
    'fails closed for missing or invalid session curriculum metadata %j',
    async (curriculumId) => {
      vi.mocked(api.getSession).mockResolvedValueOnce({
        ...session(),
        curriculumId,
      } as unknown as AuthUserDTO);
      render(dashboard());
      await screen.findByRole('alert');
      expect(api.getCurriculumSemesterPreview).not.toHaveBeenCalled();
      noLegacyReads();
    },
  );

  it('fails closed when the fresh cookie account differs from the route owner', async () => {
    vi.mocked(api.getSession).mockResolvedValueOnce(session({ id: 'bob' }));
    render(dashboard());
    await screen.findByRole('alert');
    expect(api.getCurriculumSemesterPreview).not.toHaveBeenCalled();
    noLegacyReads();
  });

  it('retries a failed scope read before requesting a contextual preview', async () => {
    vi.mocked(api.getSession).mockRejectedValueOnce(new Error('Offline'));
    render(dashboard());
    await screen.findByRole('alert');
    expect(api.getCurriculumSemesterPreview).not.toHaveBeenCalled();
    reload();
    await confirmedPreview();
    expect(api.getSession).toHaveBeenCalledTimes(2);
    expect(api.getCurriculumSemesterPreview).toHaveBeenCalledTimes(1);
    noLegacyReads();
  });

  it('blocks missing or invalid preview responses and retries without falling back to global data', async () => {
    vi.mocked(api.getCurriculumSemesterPreview).mockRejectedValueOnce(new Error('Invalid preview'));
    render(dashboard());
    await screen.findByRole('alert');
    expect(screen.queryByText('Scoped Calculus')).not.toBeInTheDocument();
    noLegacyReads();
    reload();
    await confirmedPreview();
    expect(api.getSession).toHaveBeenCalledTimes(2);
  });

  it('clears prior results while reloading and withholds stale results after a refresh failure', async () => {
    vi.mocked(api.getCurriculumSemesterPreview)
      .mockResolvedValueOnce(preview())
      .mockRejectedValueOnce(new Error('Expired session'));
    render(dashboard());
    await confirmedPreview();
    reload();
    expect(screen.queryByText('Scoped Calculus')).not.toBeInTheDocument();
    await screen.findByRole('alert');
    expect(
      screen.queryByRole('heading', { name: 'Reference semester preview' }),
    ).not.toBeInTheDocument();
    noLegacyReads();
  });

  it('rechecks session and clears the preview when intensity changes', async () => {
    const pending = deferred<CurriculumSemesterPreviewDTO>();
    vi.mocked(api.getCurriculumSemesterPreview)
      .mockResolvedValueOnce(preview())
      .mockReturnValueOnce(pending.promise);
    render(dashboard());
    await confirmedPreview();
    fireEvent.change(screen.getByLabelText('Planning intensity'), { target: { value: 'low' } });
    expect(screen.queryByText('Scoped Calculus')).not.toBeInTheDocument();
    await waitFor(() =>
      expect(api.getCurriculumSemesterPreview).toHaveBeenLastCalledWith('low', contextA),
    );
    expect(api.getSession).toHaveBeenCalledTimes(2);
    expect(screen.getByLabelText('Planning intensity')).toBeDisabled();
    await act(async () => pending.resolve(preview(contextA, 'Low intensity course')));
    await screen.findAllByText('Low intensity course');
    expect(screen.getByLabelText('Planning intensity')).toHaveValue('low');
    noLegacyReads();
  });

  it('deduplicates rapid refresh and focus while a preview request is pending', async () => {
    const pending = deferred<CurriculumSemesterPreviewDTO>();
    vi.mocked(api.getCurriculumSemesterPreview)
      .mockResolvedValueOnce(preview())
      .mockReturnValueOnce(pending.promise);
    render(dashboard());
    await confirmedPreview();
    const button = screen.getByRole('button', { name: 'Reload planner' });
    act(() => {
      fireEvent.click(button);
      fireEvent.click(button);
      window.dispatchEvent(new Event('focus'));
    });
    await waitFor(() => expect(api.getCurriculumSemesterPreview).toHaveBeenCalledTimes(2));
    expect(api.getSession).toHaveBeenCalledTimes(2);
    await act(async () => pending.resolve(preview()));
    await confirmedPreview();
    expect(api.getCurriculumSemesterPreview).toHaveBeenCalledTimes(2);
  });

  it('refreshes the same owner into a changed curriculum on window focus', async () => {
    render(dashboard());
    await confirmedPreview();
    currentContext = contextB;
    vi.mocked(api.getCurriculumSemesterPreview).mockResolvedValueOnce(
      preview(contextB, 'Changed context course'),
    );
    act(() => window.dispatchEvent(new Event('focus')));
    expect(screen.queryByText('Scoped Calculus')).not.toBeInTheDocument();
    await screen.findAllByText('Changed context course');
    expect(api.getCurriculumSemesterPreview).toHaveBeenLastCalledWith('normal', contextB);
    noLegacyReads();
  });

  it('rechecks visible-tab scope and ignores a hidden visibility event', async () => {
    render(dashboard());
    await confirmedPreview();
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    expect(api.getSession).toHaveBeenCalledTimes(1);
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    await waitFor(() => expect(api.getCurriculumSemesterPreview).toHaveBeenCalledTimes(2));
    await confirmedPreview();
    expect(api.getSession).toHaveBeenCalledTimes(2);
  });

  it('switches the same owner from assigned context to confirmed legacy scope', async () => {
    render(dashboard());
    await confirmedPreview();
    currentContext = null;
    reload();
    expect(screen.queryByText('Scoped Calculus')).not.toBeInTheDocument();
    await screen.findAllByText('Legacy recommendations');
    expect(api.getCurriculumSemesterPreview).toHaveBeenCalledTimes(1);
    expect(api.getCourses).toHaveBeenCalledTimes(1);
    expect(api.getCurrentStudentProgress).toHaveBeenCalledTimes(1);
  });

  it('switches the same owner from confirmed legacy scope to assigned context', async () => {
    currentContext = null;
    render(dashboard());
    await screen.findAllByText('Legacy recommendations');
    currentContext = contextA;
    reload();
    expect(screen.queryByText('Legacy recommendations')).not.toBeInTheDocument();
    await confirmedPreview();
    expect(api.getCourses).toHaveBeenCalledTimes(1);
    expect(api.getCurrentStudentProgress).toHaveBeenCalledTimes(1);
    expect(api.getCurriculumSemesterPreview).toHaveBeenCalledTimes(1);
  });

  it.each(['resolve', 'reject'] as const)(
    'ignores a previous account preview %s after the next account loads',
    async (outcome) => {
      const old = deferred<CurriculumSemesterPreviewDTO>();
      vi.mocked(api.getCurriculumSemesterPreview)
        .mockReturnValueOnce(old.promise)
        .mockResolvedValueOnce(preview(contextB, 'Bob context course'));
      const { rerender } = render(dashboard());
      await waitFor(() => expect(api.getCurriculumSemesterPreview).toHaveBeenCalledTimes(1));
      currentContext = contextB;
      rerender(dashboard('bob'));
      await screen.findAllByText('Bob context course');
      await act(async () => {
        if (outcome === 'resolve') old.resolve(preview(contextA, 'Old Alice result'));
        else old.reject(new Error('Old Alice failure'));
      });
      expect(screen.getAllByText('Bob context course')).toHaveLength(2);
      expect(screen.queryByText('Old Alice result')).not.toBeInTheDocument();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      noLegacyReads();
    },
  );

  it('rejects the first A response after the owner changes from A to B to A', async () => {
    const old = deferred<CurriculumSemesterPreviewDTO>();
    vi.mocked(api.getCurriculumSemesterPreview)
      .mockReturnValueOnce(old.promise)
      .mockResolvedValueOnce(preview(contextB, 'Bob result'))
      .mockResolvedValueOnce(preview(contextA, 'Fresh Alice result'));
    const { rerender } = render(dashboard());
    await waitFor(() => expect(api.getCurriculumSemesterPreview).toHaveBeenCalledTimes(1));
    currentContext = contextB;
    rerender(dashboard('bob'));
    await screen.findAllByText('Bob result');
    currentContext = contextA;
    rerender(dashboard('alice'));
    expect(screen.queryByText('Bob result')).not.toBeInTheDocument();
    await screen.findAllByText('Fresh Alice result');
    await act(async () => old.resolve(preview(contextA, 'First Alice result')));
    expect(screen.getAllByText('Fresh Alice result')).toHaveLength(2);
    expect(screen.queryByText('First Alice result')).not.toBeInTheDocument();
  });

  it('ignores a preview that resolves after unmount', async () => {
    const pending = deferred<CurriculumSemesterPreviewDTO>();
    vi.mocked(api.getCurriculumSemesterPreview).mockReturnValueOnce(pending.promise);
    const { unmount } = render(dashboard());
    await waitFor(() => expect(api.getCurriculumSemesterPreview).toHaveBeenCalledTimes(1));
    unmount();
    await act(async () => pending.resolve(preview()));
    expect(screen.queryByText('Scoped Calculus')).not.toBeInTheDocument();
    noLegacyReads();
  });

  it('works when browser storage is denied and never reads cached progress', async () => {
    const getItem = vi.fn(() => {
      throw new Error('Storage denied');
    });
    vi.stubGlobal('localStorage', { getItem });
    render(dashboard());
    await confirmedPreview();
    expect(getItem).not.toHaveBeenCalled();
    noLegacyReads();
  });

  it('renders an empty context without inventing recommendations or a graduation estimate', async () => {
    const empty = preview();
    empty.courses = [];
    empty.slots = [];
    empty.scope.ratingPrior = null;
    empty.stats = {
      ...empty.stats,
      selectedCourseCount: 0,
      scheduledCourseCount: 0,
      selectedCredits: 0,
      scheduledCredits: 0,
    };
    vi.mocked(api.getCurriculumSemesterPreview).mockResolvedValueOnce(empty);
    render(dashboard());
    await confirmedPreview();
    expect(screen.queryByText('Scoped Calculus')).not.toBeInTheDocument();
    expect(screen.queryByText(/graduation date|expected graduation/i)).not.toBeInTheDocument();
    noLegacyReads();
  });

  it('shows blocked selections, ignored historical selections and unresolved free electives', async () => {
    const result = preview();
    result.slots = [];
    result.unscheduled = [{ courseId, reason: 'UNMET_PREREQUISITE' }];
    result.ignoredPlannedIds = ['55555555-5555-4555-8555-555555555555'];
    result.stats = {
      ...result.stats,
      scheduledCourseCount: 0,
      unscheduledCourseCount: 1,
      scheduledCredits: 0,
    };
    result.requirements = [
      {
        id: '66666666-6666-4666-8666-666666666666',
        kind: 'FREE_ELECTIVE',
        name: 'Free elective',
        credits: 3,
        academicYear: 3,
        academicSemester: 2,
        sourceOrder: 10,
        sourceLabel: 'Simulated reference',
      },
    ];
    vi.mocked(api.getCurriculumSemesterPreview).mockResolvedValueOnce(result);
    render(dashboard());
    await confirmedPreview();
    expect(screen.getByRole('heading', { name: 'Unscheduled courses' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Unresolved requirements' })).toBeInTheDocument();
    expect(screen.getByText(/^Free elective/)).toBeInTheDocument();
    expect(screen.getByText(/historical|outside.*curriculum/i)).toBeInTheDocument();
    noLegacyReads();
  });

  it('describes an unknown or nonfork GPA path without inferring a manual grade or subject fit', async () => {
    render(dashboard());
    await confirmedPreview();
    expect(
      screen.queryByText(/GPA.*(?:is|equals).*0|subject.*fit|manual.*GPA/i),
    ).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/GPA/i)).not.toBeInTheDocument();
    noLegacyReads();
  });

  it.each(['THESIS', 'ALTERNATIVE'] as const)(
    'renders the authoritative %s GPA path without client grade inputs',
    async (gpaPath) => {
      const result = preview();
      result.gpaPath = gpaPath;
      vi.mocked(api.getCurriculumSemesterPreview).mockResolvedValueOnce(result);
      render(dashboard());
      await confirmedPreview();
      expect(
        screen.getByText(
          gpaPath === 'THESIS' ? 'Recorded GPA path: Thesis.' : 'Recorded GPA path: Alternative.',
        ),
      ).toBeInTheDocument();
      expect(screen.queryByLabelText(/GPA/i)).not.toBeInTheDocument();
      noLegacyReads();
    },
  );

  it('does not request preview data from a previous account session response', async () => {
    const old = deferred<AuthUserDTO>();
    vi.mocked(api.getSession).mockReturnValueOnce(old.promise);
    const { rerender } = render(dashboard());
    await waitFor(() => expect(api.getSession).toHaveBeenCalledTimes(1));
    currentContext = contextB;
    rerender(dashboard('bob'));
    await confirmedPreview();
    await act(async () => old.resolve(session({ id: 'alice', curriculumId: contextA })));
    expect(api.getCurriculumSemesterPreview).toHaveBeenCalledTimes(1);
    expect(api.getCurriculumSemesterPreview).toHaveBeenCalledWith('normal', contextB);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    noLegacyReads();
  });

  it('retries an intensity failure with its current mode after confirming scope again', async () => {
    vi.mocked(api.getCurriculumSemesterPreview)
      .mockResolvedValueOnce(preview())
      .mockRejectedValueOnce(new Error('High preview unavailable'))
      .mockResolvedValueOnce(preview(contextA, 'Fresh high result'));
    render(dashboard());
    await confirmedPreview();
    fireEvent.change(screen.getByLabelText('Planning intensity'), { target: { value: 'high' } });
    await screen.findByRole('alert');
    expect(screen.queryByText('Scoped Calculus')).not.toBeInTheDocument();
    reload();
    await screen.findAllByText('Fresh high result');
    expect(vi.mocked(api.getCurriculumSemesterPreview).mock.calls.map(([mode]) => mode)).toEqual([
      'normal',
      'high',
      'high',
    ]);
    expect(api.getSession).toHaveBeenCalledTimes(3);
    noLegacyReads();
  });
});
