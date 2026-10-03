import '@testing-library/jest-dom/vitest';
import { useEffect, useState } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiResponse, StudentProgressDTO } from '@iu-study-planner/shared';
import { getCourses, getCurrentStudentProgress, getSession } from '@/lib/api';
import type { Course } from '@/types';
import { PlannerDashboard } from '../PlannerDashboard';

const children = vi.hoisted(() => ({
  workload: vi.fn(),
  recommendations: vi.fn(),
  recommendationMount: vi.fn(),
}));
vi.mock('@/lib/api', () => ({
  getCourses: vi.fn(),
  getCurrentStudentProgress: vi.fn(),
  getSession: vi.fn(),
  getCurriculumSemesterPreview: vi.fn(),
}));
vi.mock('../WorkloadAnalyzer', () => ({
  WorkloadAnalyzer: (props: { selectedCourses: Course[]; onClear?: () => void }) => {
    children.workload(props);
    const [remembered, setRemembered] = useState(false);
    return (
      <section aria-label="Workload child">
        <p>Saved workload courses: {props.selectedCourses.map((course) => course.id).join(',')}</p>
        <button onClick={() => setRemembered(true)}>Remember workload result</button>
        {remembered && <p>Previous workload result</p>}
      </section>
    );
  },
}));
vi.mock('../../recommendations/Recommendations', () => ({
  Recommendations: (props: { userId: string; onAddToPlan?: (course: Course) => void }) => {
    children.recommendations(props);
    useEffect(() => {
      children.recommendationMount(props.userId);
    }, [props.userId]);
    return (
      <section aria-label="Recommendations child">Read-only suggestions for {props.userId}</section>
    );
  },
}));

const progress = vi.mocked(getCurrentStudentProgress);
const catalog = vi.mocked(getCourses);
function course(id: string, credits = 3): Course {
  return {
    id,
    code: id.toUpperCase(),
    name: `Saved course ${id}`,
    credits,
    difficultyLevel: 2,
    ratingDifficulty: 3,
    ratingCount: 0,
    category: 'REQUIRED',
    semesterOffered: ['FALL'],
    prerequisites: [],
    isPrerequisiteFor: [],
    createdAt: '',
    updatedAt: '',
  };
}
const courses = [course('a'), course('b', 4), course('completed'), course('cached')];
const saved: StudentProgressDTO = { completedIds: { completed: null }, plannedIds: ['a'] };
const catalogResponse: ApiResponse<Course[]> = { success: true, data: courses };
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
let sessionOwner = 'one';
const dashboard = (userId = 'one') => {
  sessionOwner = userId;
  return (
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <PlannerDashboard userId={userId} />
    </MemoryRouter>
  );
};

beforeEach(() => {
  vi.resetAllMocks();
  sessionOwner = 'one';
  vi.mocked(getSession).mockImplementation(async () => ({
    id: sessionOwner,
    studentId: 'SIMULATED',
    name: 'Simulated planner owner',
    email: 'planner@example.test',
    role: 'STUDENT',
    curriculumId: null,
  }));
  progress.mockResolvedValue(saved);
  catalog.mockResolvedValue(catalogResponse);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('server-backed planner dashboard', () => {
  it('loads progress on direct entry and uses confirmed planned courses without browser storage', async () => {
    const readCache = vi.fn(() => {
      throw new Error('Storage unavailable');
    });
    vi.stubGlobal('localStorage', { getItem: readCache });
    render(dashboard());
    expect(screen.getByRole('heading', { name: 'Planner' })).toBeInTheDocument();
    expect(await screen.findByRole('region', { name: 'Workload child' })).toHaveTextContent(
      'Saved workload courses: a',
    );
    expect(progress).toHaveBeenCalledTimes(1);
    expect(progress).toHaveBeenCalledWith();
    expect(catalog).toHaveBeenCalledTimes(1);
    expect(readCache).not.toHaveBeenCalled();
    expect(children.workload).toHaveBeenLastCalledWith({ selectedCourses: [courses[0]] });
    expect(children.recommendations).toHaveBeenLastCalledWith({ userId: 'one' });
  });

  it('withholds both child sections while either progress or catalog is still loading', async () => {
    const pendingCatalog = deferred<ApiResponse<Course[]>>();
    catalog.mockReturnValueOnce(pendingCatalog.promise);
    render(dashboard());
    expect(screen.getByRole('status')).toHaveTextContent('Loading your saved planned courses');
    expect(screen.getByRole('button', { name: 'Reload planner' })).toBeDisabled();
    await waitFor(() => expect(progress).toHaveBeenCalledTimes(1));
    expect(children.workload).not.toHaveBeenCalled();
    expect(children.recommendations).not.toHaveBeenCalled();
    await act(async () => pendingCatalog.resolve(catalogResponse));
    expect(await screen.findByRole('region', { name: 'Workload child' })).toBeInTheDocument();
  });

  it('resolves duplicate planned IDs once in the server selection order', async () => {
    progress.mockResolvedValueOnce({ completedIds: {}, plannedIds: ['b', 'a', 'b', 'a'] });
    render(dashboard());
    expect(await screen.findByRole('region', { name: 'Workload child' })).toHaveTextContent(
      'Saved workload courses: b,a',
    );
    expect(children.workload).toHaveBeenLastCalledWith({
      selectedCourses: [courses[1], courses[0]],
    });
  });

  it('keeps recommendations available when no courses are planned and links to curriculum', async () => {
    progress.mockResolvedValueOnce({ completedIds: { a: null }, plannedIds: [] });
    render(dashboard());
    expect(
      await screen.findByRole('heading', { name: 'No courses are planned yet' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open My curriculum' })).toHaveAttribute(
      'href',
      '/curriculum',
    );
    expect(screen.getByRole('region', { name: 'Recommendations child' })).toHaveTextContent(
      'Read-only suggestions for one',
    );
    expect(children.workload).not.toHaveBeenCalled();
    expect(children.recommendations).toHaveBeenLastCalledWith({ userId: 'one' });
  });

  it.each(['progress', 'catalog'] as const)(
    'offers reload after a failed %s read',
    async (source) => {
      if (source === 'progress') progress.mockRejectedValueOnce(new Error('offline'));
      else catalog.mockRejectedValueOnce(new Error('offline'));
      render(dashboard());
      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Could not load your saved planned courses',
      );
      expect(screen.queryByRole('region', { name: 'Workload child' })).not.toBeInTheDocument();
      expect(
        screen.queryByRole('region', { name: 'Recommendations child' }),
      ).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Reload planner' }));
      expect(await screen.findByRole('region', { name: 'Workload child' })).toHaveTextContent(
        'Saved workload courses: a',
      );
      expect(progress).toHaveBeenCalledTimes(2);
      expect(catalog).toHaveBeenCalledTimes(2);
    },
  );

  it('fails on a rejected catalog envelope without passing partial data to children', async () => {
    catalog.mockResolvedValueOnce({ success: false, data: courses });
    render(dashboard());
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(children.workload).not.toHaveBeenCalled();
    expect(children.recommendations).not.toHaveBeenCalled();
  });

  it('blocks an unknown saved course instead of silently analyzing the known subset', async () => {
    progress.mockResolvedValueOnce({ completedIds: {}, plannedIds: ['a', 'missing'] });
    render(dashboard());
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Some saved planned courses are missing from the current catalog',
    );
    expect(children.workload).not.toHaveBeenCalled();
    expect(children.recommendations).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Reload planner' }));
    expect(await screen.findByRole('region', { name: 'Workload child' })).toHaveTextContent(
      'Saved workload courses: a',
    );
  });

  it('rejects malformed planned IDs rather than treating them as an empty plan', async () => {
    progress.mockResolvedValueOnce({
      completedIds: {},
      plannedIds: [null],
    } as unknown as StudentProgressDTO);
    render(dashboard());
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText('No courses are planned yet')).not.toBeInTheDocument();
    expect(children.workload).not.toHaveBeenCalled();
  });

  it('blocks ambiguous duplicate catalog identities', async () => {
    catalog.mockResolvedValueOnce({
      success: true,
      data: [courses[0], { ...courses[0], credits: 9 }],
    });
    render(dashboard());
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(children.workload).not.toHaveBeenCalled();
  });

  it('reloads saved selections and remounts analysis and recommendations without stale results', async () => {
    progress
      .mockResolvedValueOnce(saved)
      .mockResolvedValueOnce({ completedIds: {}, plannedIds: ['b'] });
    render(dashboard());
    await screen.findByRole('region', { name: 'Workload child' });
    fireEvent.click(screen.getByRole('button', { name: 'Remember workload result' }));
    expect(screen.getByText('Previous workload result')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Reload planner' }));
    expect(screen.queryByText('Previous workload result')).not.toBeInTheDocument();
    expect(await screen.findByRole('region', { name: 'Workload child' })).toHaveTextContent(
      'Saved workload courses: b',
    );
    expect(children.recommendationMount).toHaveBeenCalledTimes(2);
    expect(children.recommendationMount).toHaveBeenLastCalledWith('one');
  });

  it('deduplicates rapid reload clicks while the server read is pending', async () => {
    const next = deferred<StudentProgressDTO>();
    progress.mockResolvedValueOnce(saved).mockReturnValueOnce(next.promise);
    render(dashboard());
    await screen.findByRole('region', { name: 'Workload child' });
    const button = screen.getByRole('button', { name: 'Reload planner' });
    act(() => {
      fireEvent.click(button);
      fireEvent.click(button);
    });
    await waitFor(() => expect(progress).toHaveBeenCalledTimes(2));
    expect(catalog).toHaveBeenCalledTimes(2);
    expect(button).toBeDisabled();
    await act(async () => next.resolve(saved));
    expect(await screen.findByRole('region', { name: 'Workload child' })).toBeInTheDocument();
    expect(progress).toHaveBeenCalledTimes(2);
  });

  it('hides the previous account data immediately before a new account request resolves', async () => {
    const next = deferred<StudentProgressDTO>();
    progress.mockResolvedValueOnce(saved).mockReturnValueOnce(next.promise);
    const { rerender } = render(dashboard());
    await screen.findByRole('region', { name: 'Workload child' });
    rerender(dashboard('two'));
    expect(screen.queryByRole('region', { name: 'Workload child' })).not.toBeInTheDocument();
    expect(screen.queryByText('Read-only suggestions for one')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument();
    await act(async () => next.resolve({ completedIds: {}, plannedIds: ['b'] }));
    expect(await screen.findByRole('region', { name: 'Workload child' })).toHaveTextContent(
      'Saved workload courses: b',
    );
    expect(screen.getByRole('region', { name: 'Recommendations child' })).toHaveTextContent(
      'Read-only suggestions for two',
    );
  });

  it.each(['resolve', 'reject'] as const)(
    'ignores an old account %s after a new account load',
    async (outcome) => {
      const old = deferred<StudentProgressDTO>();
      progress
        .mockReturnValueOnce(old.promise)
        .mockResolvedValueOnce({ completedIds: {}, plannedIds: ['b'] });
      const { rerender } = render(dashboard());
      await waitFor(() => expect(progress).toHaveBeenCalledTimes(1));
      rerender(dashboard('two'));
      expect(await screen.findByRole('region', { name: 'Workload child' })).toHaveTextContent(
        'Saved workload courses: b',
      );
      await act(async () => {
        if (outcome === 'resolve') old.resolve(saved);
        else old.reject(new Error('old failure'));
      });
      expect(screen.getByRole('region', { name: 'Workload child' })).toHaveTextContent(
        'Saved workload courses: b',
      );
      expect(screen.getByRole('region', { name: 'Recommendations child' })).toHaveTextContent(
        'Read-only suggestions for two',
      );
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    },
  );

  it('removes stale confirmed results when a reload fails', async () => {
    progress.mockResolvedValueOnce(saved).mockRejectedValueOnce(new Error('session expired'));
    render(dashboard());
    await screen.findByRole('region', { name: 'Workload child' });
    fireEvent.click(screen.getByRole('button', { name: 'Reload planner' }));
    await screen.findByRole('alert');
    expect(screen.queryByRole('region', { name: 'Workload child' })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Recommendations child' })).not.toBeInTheDocument();
  });

  it('recovers after a synchronous adapter failure without getting stuck behind pending state', async () => {
    progress
      .mockImplementationOnce(() => {
        throw new Error('adapter failure');
      })
      .mockResolvedValueOnce(saved);
    render(dashboard());
    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: 'Reload planner' }));
    expect(await screen.findByRole('region', { name: 'Workload child' })).toBeInTheDocument();
    expect(progress).toHaveBeenCalledTimes(2);
  });

  it('ignores a response after unmount without mounting either child', async () => {
    const pending = deferred<StudentProgressDTO>();
    progress.mockReturnValueOnce(pending.promise);
    const { unmount } = render(dashboard());
    await waitFor(() => expect(progress).toHaveBeenCalledTimes(1));
    unmount();
    await act(async () => pending.resolve(saved));
    expect(children.workload).not.toHaveBeenCalled();
    expect(children.recommendations).not.toHaveBeenCalled();
  });
});
