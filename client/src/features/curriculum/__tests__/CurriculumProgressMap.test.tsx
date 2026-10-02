import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getCurriculum, getCurrentStudentProgress, saveCourseProgress } from '@/lib/api';
import type { CompleteCourseResponseDTO } from '@iu-study-planner/shared';
import { useAppStore } from '@/lib/store';
import type { Course } from '@/types';
import { CurriculumProgressMap } from '../CurriculumProgressMap';

vi.mock('@/lib/api', () => ({
  getCurriculum: vi.fn(),
  getCurrentStudentProgress: vi.fn(),
  saveCourseProgress: vi.fn(),
}));
vi.mock('@/lib/sounds', () => ({
  playCompleteSound: vi.fn(),
  playUncompleteSound: vi.fn(),
  playPlanSound: vi.fn(),
  playUnplanSound: vi.fn(),
  playLockedSound: vi.fn(),
  playToggleSound: vi.fn(),
  playRecommendationsSound: vi.fn(),
}));

function course(id: string, prerequisites: string[] = [], electiveGroup?: string): Course {
  return {
    id,
    code: id,
    name: `Course ${id}`,
    credits: 3,
    difficultyLevel: 2,
    category: electiveGroup ? 'MAJOR_ELECTIVE' : 'REQUIRED',
    semesterOffered: ['FALL'],
    electiveGroup,
    electiveSelectCount: electiveGroup ? 1 : undefined,
    prerequisites: prerequisites.map((prerequisiteId) => ({
      id: `${id}-${prerequisiteId}`,
      courseId: id,
      prerequisiteId,
      isStrict: true,
      isCorequisite: false,
    })),
    isPrerequisiteFor: [],
    createdAt: '',
    updatedAt: '',
  };
}

async function showCurriculum(courses: Course[], userId?: string) {
  vi.mocked(getCurriculum).mockResolvedValue({
    success: true,
    data: [{ year: 1, semester: 1, courses }],
  });
  render(<CurriculumProgressMap userId={userId} />);
  await screen.findByRole('button', {
    name: new RegExp(`^${courses[0].code} Course ${courses[0].code}:`),
  });
}

beforeEach(() => {
  const storage = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  });
  useAppStore.setState({
    completedIds: {},
    plannedIds: [],
    progressOwnerId: null,
    progressStatus: 'ready',
    progressError: null,
    browserProgressBackup: null,
    pendingCompletionIds: new Set(),
  });
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({ json: async () => ({ success: true, data: [] }) }),
  );
  vi.stubGlobal(
    'requestAnimationFrame',
    vi.fn(() => 0),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('prerequisite interactions', () => {
  it('reconciles a signed-in cascade with server-only dependents and blocks clicks during saving', async () => {
    useAppStore.getState().setProgressOwner('alice');
    vi.mocked(getCurrentStudentProgress).mockResolvedValue({
      completedIds: { A: null, B: null, C: null, E: null },
      plannedIds: [],
    });
    let confirm: (response: CompleteCourseResponseDTO) => void = () => {};
    vi.mocked(saveCourseProgress).mockReturnValue(
      new Promise((resolve) => {
        confirm = resolve;
      }),
    );
    await showCurriculum([course('A'), course('B', ['A']), course('C'), course('E')], 'alice');
    fireEvent.click(screen.getByText('A'));
    expect(useAppStore.getState().completedIds).toEqual({ C: null, E: null });
    expect(screen.getByRole('status')).toHaveTextContent('Saving progress');
    fireEvent.click(screen.getByText('E'));
    expect(saveCourseProgress).toHaveBeenCalledTimes(1);
    expect(saveCourseProgress).toHaveBeenCalledWith({
      courseId: 'A',
      electiveGroup: null,
      status: 'DROPPED',
    });
    await act(async () => {
      confirm({ completedIds: { C: null }, plannedIds: [], uncompletedCourseIds: ['B', 'E'] });
    });
    expect(useAppStore.getState().completedIds).toEqual({ C: null });
    expect(screen.getByRole('status')).toHaveTextContent('Progress saved');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('blocks course editing when hydration fails and recovers through the retry action', async () => {
    useAppStore.getState().setProgressOwner('alice');
    vi.mocked(getCurrentStudentProgress)
      .mockRejectedValueOnce(new Error('Offline'))
      .mockResolvedValueOnce({ completedIds: {}, plannedIds: [] });
    vi.mocked(getCurriculum).mockResolvedValue({
      success: true,
      data: [{ year: 1, semester: 1, courses: [course('A')] }],
    });
    render(<CurriculumProgressMap userId="alice" />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Offline');
    expect(screen.queryByText('A')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Reload saved progress' }));
    await screen.findByText('A');
    await waitFor(() => expect(useAppStore.getState().progressStatus).toBe('ready'));
  });
  it('allows planning a locked required course without allowing its completion', async () => {
    await showCurriculum([course('IT001IU'), course('IT002IU', ['IT001IU'])]);
    fireEvent.click(screen.getByRole('button', { name: 'Plan: IT002IU Course IT002IU' }));
    expect(useAppStore.getState().plannedIds).toEqual(['IT002IU']);
    fireEvent.click(screen.getByRole('button', { name: 'IT002IU Course IT002IU: Show prerequisites' }));
    expect(screen.getByRole('button', { name: 'IT002IU Course IT002IU: Show prerequisites' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Requires')).toBeVisible();
    expect(useAppStore.getState().completedIds).toEqual({});
    expect(useAppStore.getState().plannedIds).toEqual(['IT002IU']);

    fireEvent.click(screen.getByRole('button', { name: 'IT001IU Course IT001IU: Mark complete' }));
    fireEvent.click(screen.getByText('IT002IU'));
    expect(useAppStore.getState().completedIds).toEqual({ IT001IU: null, IT002IU: null });
    expect(useAppStore.getState().plannedIds).toEqual([]);
  });

  it('keeps a planned elective locked until its prerequisite is complete', async () => {
    await showCurriculum([course('IT001IU'), course('IT002IU', ['IT001IU'], 'Group 1')]);
    fireEvent.click(screen.getByText('Elective Group 1'));
    fireEvent.contextMenu(screen.getByText('IT002IU'));
    fireEvent.click(screen.getByText('IT002IU'));
    expect(useAppStore.getState().completedIds).toEqual({});
    expect(useAppStore.getState().plannedIds).toEqual(['IT002IU']);

    fireEvent.click(screen.getByRole('button', { name: 'IT001IU Course IT001IU: Mark complete' }));
    fireEvent.click(screen.getByText('IT002IU'));
    expect(useAppStore.getState().completedIds.IT002IU).toBe('Group 1');
  });

  it.each(['uncomplete', 'complete to planned'])(
    'cascades %s through an incomplete intermediate course',
    async (action) => {
      useAppStore.setState({ completedIds: { IT001IU: null, IT003IU: null } });
      await showCurriculum([
        course('IT001IU'),
        course('IT002IU', ['IT001IU']),
        course('IT003IU', ['IT002IU']),
      ]);
      if (action === 'uncomplete') fireEvent.click(screen.getByText('IT001IU'));
      else fireEvent.contextMenu(screen.getByText('IT001IU'));
      expect(useAppStore.getState().completedIds).toEqual({});
      expect(JSON.parse(localStorage.getItem('completed_courses') ?? '{}')).toEqual({});
      expect(useAppStore.getState().plannedIds).toEqual(action === 'uncomplete' ? [] : ['IT001IU']);
    },
  );

  it('uncompletes a cycle without toggling the initiating course back on', async () => {
    useAppStore.setState({ completedIds: { IT001IU: null, IT002IU: null } });
    await showCurriculum([course('IT001IU', ['IT002IU']), course('IT002IU', ['IT001IU'])]);
    fireEvent.click(screen.getByText('IT001IU'));
    expect(useAppStore.getState().completedIds).toEqual({});
  });

  it('removes a shared dependent once and preserves unrelated completions', async () => {
    useAppStore.setState({
      completedIds: { IT001IU: null, IT002IU: null, IT003IU: null, IT004IU: null, IT005IU: null },
    });
    await showCurriculum([
      course('IT001IU'),
      course('IT002IU', ['IT001IU']),
      course('IT003IU', ['IT001IU']),
      course('IT004IU', ['IT002IU', 'IT003IU']),
      course('IT005IU'),
    ]);
    fireEvent.click(screen.getByText('IT001IU'));
    expect(useAppStore.getState().completedIds).toEqual({ IT005IU: null });
  });
});
