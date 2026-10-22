import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CompleteCourseResponseDTO } from '@iu-study-planner/shared';
import { getCurriculum, saveCourseProgress } from '@/lib/api';
import { getScopedStudentProgress } from '@/lib/scopedProgressApi';
import { getStudentGrades } from '@/lib/gradesApi';
import { useAppStore } from '@/lib/store';
import type { Course } from '@/types';
import { CurriculumProgressMap } from '../CurriculumProgressMap';

vi.mock('@/lib/api', () => ({
  getCurriculum: vi.fn(),
  saveCourseProgress: vi.fn(),
}));
vi.mock('@/lib/scopedProgressApi', () => ({ getScopedStudentProgress: vi.fn() }));
vi.mock('@/lib/gradesApi', () => ({ getStudentGrades: vi.fn() }));
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
    name: new RegExp(`^${courses[0].code} .*: (Mark (in)?complete|Show prerequisites)$`),
  });
}

beforeEach(() => {
  vi.mocked(getStudentGrades).mockResolvedValue({
    attempts: [],
    completedCoursesWithoutNumericGrades: [],
    summary: {
      gpa100: null,
      gpaPath: null,
      gradedCredits: 0,
      gradedCourseCount: 0,
      courseScores: [],
    },
  });
  const storage = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  });
  useAppStore.setState({
    completedIds: {},
    plannedIds: [],
    progressOwnerId: null,
    progressScope: null,
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
  it('resets map scrolling without changing course selections', async () => {
    useAppStore.setState({ completedIds: { A: null }, plannedIds: ['B'] });
    await showCurriculum([course('A'), course('B')]);
    const map = screen.getByRole('region', { name: 'Semester curriculum map' });
    map.scrollTop = 160;
    map.scrollLeft = 240;
    fireEvent.click(screen.getByRole('button', { name: 'Reset view' }));
    expect(map.scrollTop).toBe(0);
    expect(map.scrollLeft).toBe(0);
    expect(useAppStore.getState().completedIds).toEqual({ A: null });
    expect(useAppStore.getState().plannedIds).toEqual(['B']);
  });
  it('reconciles a signed-in cascade with server-only dependents and blocks clicks during saving', async () => {
    useAppStore.getState().setProgressOwner('alice');
    vi.mocked(getScopedStudentProgress).mockResolvedValue({
      scope: { userId: 'alice', curriculumId: null },
      progress: { completedIds: { A: null, B: null, C: null, E: null }, plannedIds: [] },
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
      expectedScope: { userId: 'alice', curriculumId: null },
    });
    vi.mocked(getScopedStudentProgress).mockResolvedValueOnce({
      scope: { userId: 'alice', curriculumId: null },
      progress: { completedIds: { C: null }, plannedIds: [] },
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
    vi.mocked(getScopedStudentProgress)
      .mockRejectedValueOnce(new Error('Offline'))
      .mockResolvedValueOnce({
        scope: { userId: 'alice', curriculumId: null },
        progress: { completedIds: {}, plannedIds: [] },
      });
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
    fireEvent.contextMenu(screen.getByText('IT002IU'));
    expect(useAppStore.getState().plannedIds).toEqual(['IT002IU']);
    fireEvent.click(screen.getByRole('button', { name: /^IT002IU .*: Show prerequisites$/ }));
    expect(
      screen.getByRole('button', { name: /^IT002IU .*: Show prerequisites$/ }),
    ).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Requires')).toBeVisible();
    expect(useAppStore.getState().completedIds).toEqual({});
    expect(useAppStore.getState().plannedIds).toEqual(['IT002IU']);

    fireEvent.click(screen.getByRole('button', { name: /^IT001IU .*: Mark complete$/ }));
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

    fireEvent.click(screen.getByRole('button', { name: /^IT001IU .*: Mark complete$/ }));
    fireEvent.click(screen.getByText('IT002IU'));
    expect(useAppStore.getState().completedIds.IT002IU).toBe('Group 1');
  });

  // WCAG 2.5.3: a voice-control user must be able to say what they see.
  const nameMustContainVisibleText = (button: HTMLElement) => {
    const visibleText = (button.textContent ?? '').replace(/\s+/g, ' ').trim();
    expect(button).toHaveAccessibleName(
      new RegExp(visibleText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
    );
    return visibleText;
  };

  it('keeps an elective group button name in sync with its visible text', async () => {
    await showCurriculum([course('IT001IU'), course('IT002IU', ['IT001IU'], 'Group 1')]);

    const button = screen.getByRole('button', { name: /^Elective Group 1/ });
    expect(nameMustContainVisibleText(button)).toBe('Elective Group 1 0/1 completed');
  });

  it('includes an elective group status word in its visible text and name', async () => {
    useAppStore.setState({ completedIds: { IT002IU: 'Group 1' } });
    await showCurriculum([course('IT001IU'), course('IT002IU', ['IT001IU'], 'Group 1')]);

    const button = screen.getByRole('button', { name: /^Elective Group 1 DONE/ });
    expect(nameMustContainVisibleText(button)).toBe('Elective Group 1 DONE 1/1 completed');
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

describe('curriculum load recovery', () => {
  it('recovers in place when a retry succeeds after an unsuccessful read', async () => {
    vi.mocked(getCurriculum).mockResolvedValueOnce({ success: false } as never);
    vi.mocked(getCurriculum).mockResolvedValueOnce({
      success: true,
      data: [{ year: 1, semester: 1, courses: [course('IT001IU')] }],
    } as never);

    render(<CurriculumProgressMap />);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Could not load the curriculum');
    // A failed load must not tell the user the only option is a full page reload.
    expect(alert).not.toHaveTextContent(/reload the page/i);

    fireEvent.click(screen.getByRole('button', { name: /try loading the curriculum again/i }));

    await screen.findByText('IT001IU');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(getCurriculum).toHaveBeenCalledTimes(2);
  });

  it('puts focus on the failure message when the retry fails again', async () => {
    vi.mocked(getCurriculum).mockRejectedValue(new Error('Offline'));
    render(<CurriculumProgressMap />);
    const retry = await screen.findByRole('button', { name: /try loading the curriculum again/i });
    retry.focus();
    fireEvent.click(retry);
    await waitFor(() => expect(document.activeElement).not.toBe(document.body));
    expect(document.activeElement).toBe(screen.getByRole('alert'));
  });

  it('recovers in place when a retry succeeds after a network failure', async () => {
    vi.mocked(getCurriculum).mockRejectedValueOnce(new Error('Offline'));
    vi.mocked(getCurriculum).mockResolvedValueOnce({
      success: true,
      data: [{ year: 1, semester: 1, courses: [course('IT001IU')] }],
    } as never);

    render(<CurriculumProgressMap />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not connect to the planner');

    fireEvent.click(screen.getByRole('button', { name: /try loading the curriculum again/i }));

    await screen.findByText('IT001IU');
    expect(getCurriculum).toHaveBeenCalledTimes(2);
  });

  it('keeps the retry available when a retry also fails', async () => {
    vi.mocked(getCurriculum).mockResolvedValue({ success: false } as never);

    render(<CurriculumProgressMap />);
    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: /try loading the curriculum again/i }));

    await waitFor(() => expect(getCurriculum).toHaveBeenCalledTimes(2));
    expect(screen.getByRole('button', { name: /try loading the curriculum again/i })).toBeVisible();
    expect(screen.getByRole('alert')).toHaveTextContent('Could not load the curriculum');
  });
});

describe('planned credit warning', () => {
  it('points at the fixed reference instead of a control that never moves it', async () => {
    useAppStore.setState({ plannedIds: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'] });
    await showCurriculum([...'ABCDEFGHI'].map((id) => course(id)));

    expect(screen.getByText(/27 \/ 24 credits/)).toBeInTheDocument();
    expect(screen.getByText(/Over the typical load/)).toHaveTextContent(
      'Reduce the plan to get back under',
    );
    // The 24-credit reference is fixed; the course-load control does not move it,
    // so the warning must not send the user to a control that cannot clear it.
    expect(screen.queryByText(/raise the course load/i)).not.toBeInTheDocument();
  });
});

describe('prerequisite hover emphasis', () => {
  it('de-emphasises unrelated cards without fading their text', async () => {
    await showCurriculum([course('IT001IU'), course('IT002IU', ['IT001IU']), course('IT003IU')]);

    const lockedCard = screen.getByRole('button', {
      name: /^IT002IU .*: Show prerequisites$/,
    }).parentElement as HTMLElement;
    const unrelatedCard = screen.getByText('Course IT003IU').closest('div.border-2') as HTMLElement;

    fireEvent.mouseOver(lockedCard);

    // Cards outside the chain are still clickable, so fading the whole card
    // would push their labels below the contrast minimum. The emphasis comes
    // from the background instead.
    expect(unrelatedCard).toHaveClass('bg-gray-100');
    expect(unrelatedCard.className).not.toMatch(/opacity-/);
    expect(lockedCard).not.toHaveClass('bg-gray-100');
  });
});

describe('elective group panel reachability', () => {
  it('moves focus into the panel it opens and hands it back on Escape', async () => {
    await showCurriculum([course('IT001IU'), course('IT002IU', ['IT001IU'], 'Group 1')]);

    const trigger = screen.getByRole('button', { name: /^Elective Group 1/ });
    trigger.focus();
    fireEvent.click(trigger);

    // The panel renders after the whole canvas in DOM order, which is dozens of
    // tab stops away from the card that opened it.
    const panel = await screen.findByRole('region', { name: /Elective Group 1/ });
    expect(panel).toHaveFocus();
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(trigger).toHaveAttribute('aria-controls', panel.id);

    fireEvent.keyDown(panel, { key: 'Escape' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger).toHaveFocus();
  });
});

describe('zoom limits', () => {
  it('says the limit in text a screen reader reads', async () => {
    await showCurriculum([course('A')]);
    const zoomIn = screen.getByRole('button', { name: 'Zoom in' });
    const zoomOut = screen.getByRole('button', { name: 'Zoom out' });

    expect(zoomOut).toHaveAccessibleDescription('Already at the smallest zoom');
    expect(zoomIn).toHaveAccessibleDescription('Zooms the map in');

    for (let step = 0; step < 6; step += 1) fireEvent.click(zoomIn);
    expect(zoomIn).toHaveAccessibleDescription('Already at the largest zoom');
  });

  it('says what the reset control keeps when it resets the map', async () => {
    await showCurriculum([course('A')]);
    expect(screen.getByRole('button', { name: 'Reset view' })).toHaveAccessibleDescription(
      'Resets the map position and zoom. Course selections stay the same.',
    );
  });

  it('states the limit instead of ignoring a click on the zoom button', async () => {
    await showCurriculum([course('A')]);
    const zoomIn = screen.getByRole('button', { name: 'Zoom in' });
    const zoomOut = screen.getByRole('button', { name: 'Zoom out' });
    // The readout sits between the two buttons; the page has other percentages.
    const percent = () => zoomIn.previousElementSibling?.textContent;

    expect(percent()).toBe('100%');
    expect(zoomOut).toHaveAttribute('aria-disabled', 'true');
    expect(zoomOut).toHaveAttribute('title', 'Already at the smallest zoom');
    expect(zoomIn).not.toHaveAttribute('aria-disabled');
    fireEvent.click(zoomOut);
    expect(percent()).toBe('100%');

    for (let step = 0; step < 6; step += 1) fireEvent.click(zoomIn);
    expect(percent()).toBe('200%');
    expect(zoomIn).toHaveAttribute('aria-disabled', 'true');
    expect(zoomIn).toHaveAttribute('title', 'Already at the largest zoom');
    expect(zoomOut).not.toHaveAttribute('aria-disabled');

    // The button keeps its place in the tab order and in focus: this is a
    // stated limit, not a control that has been taken away.
    zoomIn.focus();
    fireEvent.click(zoomIn);
    expect(percent()).toBe('200%');
    expect(document.activeElement).toBe(zoomIn);
  });
});
