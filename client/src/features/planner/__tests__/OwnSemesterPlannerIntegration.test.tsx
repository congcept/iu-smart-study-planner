import '@testing-library/jest-dom/vitest';
import { MemoryRouter } from 'react-router-dom';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  CurriculumSemesterPreviewDTO,
  OwnSemesterAllocationHistoryDTO,
} from '@iu-study-planner/shared';
import * as api from '@/lib/api';
import * as ownApi from '@/lib/ownSemesterAllocationApi';
import { ownerId, referenceId, referenceSession } from '@/test/fixtures/curriculumReference';
import { ownSemesterAllocationRun } from '@/test/fixtures/ownSemesterAllocationRun';
import { PlannerDashboard } from '../PlannerDashboard';

vi.mock('@/lib/api', () => ({
  getSession: vi.fn(),
  getCourses: vi.fn(),
  getCurrentStudentProgress: vi.fn(),
  getCurriculumSemesterPreview: vi.fn(),
}));
vi.mock('@/lib/ownSemesterAllocationApi', async (original) => ({
  ...(await original<typeof ownApi>()),
  listOwnSemesterAllocationRuns: vi.fn(),
  getOwnSemesterAllocationRun: vi.fn(),
}));
vi.mock('../WorkloadAnalyzer', () => ({ WorkloadAnalyzer: () => <p>Saved workload</p> }));
vi.mock('../../recommendations/Recommendations', () => ({
  Recommendations: () => <p>Saved recommendations</p>,
}));
vi.mock('../CurriculumPlannerPreview', () => ({
  CurriculumPlannerPreview: () => <p>Current curriculum preview</p>,
}));

const result = ownSemesterAllocationRun();
const page: OwnSemesterAllocationHistoryDTO = {
  kind: 'SIMULATION',
  usage: 'REFERENCE_ONLY',
  visibility: 'CURRENT_ACCOUNT_ONLY',
  order: 'STORED_NEWEST_FIRST',
  pageSize: 5,
  after: null,
  runs: [result],
  nextAfter: null,
};
function preview(): CurriculumSemesterPreviewDTO {
  return {
    scope: {
      curriculumId: referenceId,
      usage: 'REFERENCE_ONLY',
      planningBasis: 'SELECTED_COURSES',
      ratingPrior: { mean: 2, source: 'CURRICULUM_SEED' },
      electiveRequirementsValidated: false,
      offeringValidationAvailable: false,
      calendarDatesAvailable: false,
    },
    gpaPath: null,
    slots: [],
    courses: [],
    ignoredPlannedIds: [],
    unscheduled: [],
    requirements: [],
    stats: {
      selectedCourseCount: 0,
      scheduledCourseCount: 0,
      unscheduledCourseCount: 0,
      selectedCredits: 0,
      scheduledCredits: 0,
      semestersToCompletion: null,
      totalRemainingCredits: null,
      estimatedGraduation: null,
    },
  };
}
function renderPlanner() {
  return render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <PlannerDashboard userId={ownerId} />
    </MemoryRouter>,
  );
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(api.getSession).mockResolvedValue(referenceSession(null));
  vi.mocked(api.getCourses).mockResolvedValue({ success: true, data: [] });
  vi.mocked(api.getCurrentStudentProgress).mockResolvedValue({ completedIds: {}, plannedIds: [] });
  vi.mocked(api.getCurriculumSemesterPreview).mockResolvedValue(preview());
  vi.mocked(ownApi.listOwnSemesterAllocationRuns).mockResolvedValue(page);
  vi.mocked(ownApi.getOwnSemesterAllocationRun).mockResolvedValue(result);
});
afterEach(() => cleanup());

describe('own semester history in the protected planner composition', () => {
  it.each([401, 403])(
    'clears historical evidence after a confirmed session-read %i',
    async (status) => {
      renderPlanner();
      await screen.findByText('Saved recommendations');
      await screen.findByRole('button', { name: 'View result 1' });
      vi.mocked(api.getSession).mockRejectedValue({ isAxiosError: true, response: { status } });
      fireEvent.click(screen.getByRole('button', { name: 'Reload planner' }));
      expect(
        await screen.findByText('Sign in as this account to read your saved simulations.'),
      ).toBeVisible();
      expect(screen.queryByRole('button', { name: 'View result 1' })).not.toBeInTheDocument();
      expect(ownApi.listOwnSemesterAllocationRuns).toHaveBeenCalledTimes(1);
    },
  );
  it('preserves independently confirmed history during an unrelated planner session transport failure', async () => {
    renderPlanner();
    await screen.findByText('Saved recommendations');
    await screen.findByRole('button', { name: 'View result 1' });
    vi.mocked(api.getSession).mockRejectedValue(new Error('Session transport offline'));
    fireEvent.click(screen.getByRole('button', { name: 'Reload planner' }));
    await screen.findByText(/Could not load your saved planned courses/);
    expect(screen.getByRole('button', { name: 'View result 1' })).toBeVisible();
    expect(ownApi.listOwnSemesterAllocationRuns).toHaveBeenCalledTimes(1);
  });
  it('hides all historical evidence when planner refresh detects a changed cookie account', async () => {
    renderPlanner();
    await screen.findByText('Saved recommendations');
    fireEvent.click(await screen.findByRole('button', { name: 'View result 1' }));
    await screen.findByRole('region', { name: 'Your simulation result' });
    vi.mocked(api.getSession).mockResolvedValue(referenceSession(null, referenceId));
    fireEvent.click(screen.getByRole('button', { name: 'Reload planner' }));
    expect(
      await screen.findByText('Sign in as this account to read your saved simulations.'),
    ).toBeVisible();
    expect(
      screen.queryByRole('region', { name: 'Your simulation result' }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'View result 1' })).not.toBeInTheDocument();
    expect(ownApi.listOwnSemesterAllocationRuns).toHaveBeenCalledTimes(1);
    vi.mocked(api.getSession).mockResolvedValue(referenceSession(null));
    fireEvent.click(screen.getByRole('button', { name: 'Reload planner' }));
    await screen.findByRole('button', { name: 'View result 1' });
    expect(ownApi.listOwnSemesterAllocationRuns).toHaveBeenCalledTimes(2);
    expect(
      screen.queryByRole('region', { name: 'Your simulation result' }),
    ).not.toBeInTheDocument();
  });
  it('also discards historical evidence on a focus refresh with an invalid owner', async () => {
    renderPlanner();
    await screen.findByText('Saved recommendations');
    await screen.findByRole('button', { name: 'View result 1' });
    vi.mocked(api.getSession).mockResolvedValue({ ...referenceSession(null), id: '' });
    await act(async () => window.dispatchEvent(new Event('focus')));
    expect(
      await screen.findByText('Sign in as this account to read your saved simulations.'),
    ).toBeVisible();
    expect(screen.queryByRole('button', { name: 'View result 1' })).not.toBeInTheDocument();
    expect(ownApi.listOwnSemesterAllocationRuns).toHaveBeenCalledTimes(1);
  });
  it('shows historical own results beside confirmed legacy recommendations', async () => {
    renderPlanner();
    expect(await screen.findByText('Saved recommendations')).toBeVisible();
    expect(await screen.findByRole('button', { name: 'View result 1' })).toBeVisible();
    expect(ownApi.listOwnSemesterAllocationRuns).toHaveBeenCalledWith(ownerId, {}, undefined);
  });
  it('keeps own history readable when the current planner source fails', async () => {
    vi.mocked(api.getCourses).mockRejectedValue(new Error('Current catalog unavailable'));
    renderPlanner();
    expect(await screen.findByText(/Could not load your saved planned courses/)).toBeVisible();
    fireEvent.click(await screen.findByRole('button', { name: 'View result 1' }));
    expect(await screen.findByRole('region', { name: 'Your simulation result' })).toBeVisible();
  });
  it('does not discard historical selections or reread them when current planning intensity changes', async () => {
    vi.mocked(api.getSession).mockResolvedValue(referenceSession(referenceId));
    renderPlanner();
    expect(await screen.findByText('Current curriculum preview')).toBeVisible();
    fireEvent.click(await screen.findByRole('button', { name: 'View result 1' }));
    expect(await screen.findByRole('region', { name: 'Your simulation result' })).toBeVisible();
    fireEvent.change(screen.getByLabelText('Planning intensity'), { target: { value: 'high' } });
    await waitFor(() =>
      expect(api.getCurriculumSemesterPreview).toHaveBeenCalledWith('high', referenceId),
    );
    expect(screen.getByRole('region', { name: 'Your simulation result' })).toBeVisible();
    expect(ownApi.listOwnSemesterAllocationRuns).toHaveBeenCalledTimes(1);
    expect(ownApi.getOwnSemesterAllocationRun).toHaveBeenCalledTimes(1);
  });
  it('reloads planner sources without remounting own history', async () => {
    renderPlanner();
    await screen.findByText('Saved recommendations');
    await screen.findByRole('button', { name: 'View result 1' });
    fireEvent.click(screen.getByRole('button', { name: 'Reload planner' }));
    await waitFor(() => expect(api.getCourses).toHaveBeenCalledTimes(2));
    expect(ownApi.listOwnSemesterAllocationRuns).toHaveBeenCalledTimes(1);
  });
  it('isolates own-history failures from current planner availability', async () => {
    vi.mocked(ownApi.listOwnSemesterAllocationRuns).mockRejectedValue(
      new Error('Own history offline'),
    );
    renderPlanner();
    expect(await screen.findByText('Saved recommendations')).toBeVisible();
    const history = screen.getByRole('region', { name: 'Your saved semester simulations' });
    expect(await within(history).findByRole('alert')).toHaveTextContent('Could not confirm');
    expect(
      within(history).queryByRole('button', { name: 'View result 1' }),
    ).not.toBeInTheDocument();
    expect(api.getCurrentStudentProgress).toHaveBeenCalledTimes(1);
  });
});
