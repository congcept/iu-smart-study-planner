import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { analyzeWorkload } from '@/lib/api';
import type { ApiResponse, Course, WorkloadAnalysis } from '@/types';
import { WorkloadAnalyzer } from '../WorkloadAnalyzer';

vi.mock('@/lib/api', () => ({ analyzeWorkload: vi.fn() }));
function course(id: string, overrides: Partial<Course> = {}): Course {
  return {
    id,
    code: id,
    name: `Course ${id}`,
    credits: 3,
    category: 'REQUIRED',
    difficultyLevel: 5,
    ratingDifficulty: 2.5,
    ratingCount: 8,
    semesterOffered: ['FALL'],
    prerequisites: [],
    isPrerequisiteFor: [],
    createdAt: '',
    updatedAt: '',
    ...overrides,
  };
}
const response = (score = 18.2): ApiResponse<WorkloadAnalysis> => ({
  success: true,
  data: {
    totalCredits: 7,
    averageDifficulty: 4.4,
    workloadScore: score,
    riskLevel: 'HIGH',
    recommendations: ['Review teaching capacity independently'],
  },
});
function pending() {
  let resolve: (value: ApiResponse<WorkloadAnalysis>) => void = () => {};
  const promise = new Promise<ApiResponse<WorkloadAnalysis>>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
function calculate() {
  fireEvent.click(
    screen.getByRole('button', { name: /^(Analyze|Calculate estimate|Retry analysis)$/i }),
  );
}
beforeEach(() => {
  vi.resetAllMocks();
});
afterEach(cleanup);

describe('selected-course workload analysis', () => {
  it('shows rating estimates and their actual counts instead of the seed difficulty', () => {
    render(
      <WorkloadAnalyzer
        selectedCourses={[course('A'), course('B', { ratingDifficulty: 3.5, ratingCount: 0 })]}
      />,
    );
    expect(screen.getByText('Difficulty 2.5 / 5')).toBeVisible();
    expect(screen.getByText('8 ratings')).toBeVisible();
    expect(screen.getByText('Difficulty 3.5 / 5')).toBeVisible();
    expect(screen.getByText('No ratings yet')).toBeVisible();
    expect(
      screen.getByText((text) => text === '3.0' || text === 'Average rating difficulty: 3.0 / 5'),
    ).toBeVisible();
    expect(screen.queryByText('Difficulty 5.0 / 5')).toBeNull();
    expect(screen.queryByText(/seeded/i)).toBeNull();
    expect(analyzeWorkload).not.toHaveBeenCalled();
  });

  it('keeps a partial missing estimate unknown without substituting a seed or averaging only known courses', () => {
    render(
      <WorkloadAnalyzer
        selectedCourses={[
          course('A'),
          course('B', { ratingDifficulty: undefined, ratingCount: undefined }),
        ]}
      />,
    );
    expect(screen.getByText(/Unknown/)).toBeVisible();
    expect(screen.getByText('1 of 2 courses have no difficulty estimate.')).toBeVisible();
    expect(screen.getByText('Difficulty estimate unavailable')).toBeVisible();
    expect(screen.queryByText('Difficulty 5.0 / 5')).toBeNull();
  });

  it.each([{ ratingDifficulty: Number.NaN }, { ratingCount: -1 }, { ratingCount: undefined }])(
    'does not present malformed rating metadata as a known difficulty',
    (overrides) => {
      render(<WorkloadAnalyzer selectedCourses={[course('A', overrides)]} />);
      expect(screen.getByText(/Unknown/)).toBeVisible();
      expect(screen.getByText('Difficulty estimate unavailable')).toBeVisible();
      expect(screen.queryByText('Difficulty 2.5 / 5')).toBeNull();
    },
  );

  it('uses authoritative server numbers and includes physical training in the selected request', async () => {
    vi.mocked(analyzeWorkload).mockResolvedValue(response());
    render(<WorkloadAnalyzer selectedCourses={[course('A'), course('PT001IU', { credits: 2 })]} />);
    expect(
      screen.getByText((text) => text === '5' || text === '2 selected courses · 5 credits'),
    ).toBeVisible();
    calculate();
    const result = await screen.findByRole('region', { name: 'Workload result' });
    expect(analyzeWorkload).toHaveBeenCalledWith(['A', 'PT001IU']);
    expect(result).toHaveTextContent('Server estimate: 7 credits');
    expect(result).toHaveTextContent(/Average rating difficulty 4.4/);
    expect(result).toHaveTextContent('18.2');
    expect(result).toHaveTextContent('Review teaching capacity independently');
    expect(screen.getByText(/does not validate/)).toHaveTextContent('prerequisites');
  });

  it('describes an empty heuristic warning list without claiming a feasible semester', async () => {
    vi.mocked(analyzeWorkload).mockResolvedValue({
      ...response(),
      data: { ...response().data!, recommendations: [] },
    });
    render(<WorkloadAnalyzer selectedCourses={[course('A')]} />);
    calculate();
    const result = await screen.findByRole('region', { name: 'Workload result' });
    expect(result).toHaveTextContent('No workload thresholds were triggered');
    expect(result).toHaveTextContent('prerequisites and timetable conflicts still need checking');
    expect(result).not.toHaveTextContent('looks balanced');
  });

  it('does not let an old selection request clear or replace a newer pending result', async () => {
    const first = pending();
    const second = pending();
    vi.mocked(analyzeWorkload)
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const view = render(<WorkloadAnalyzer selectedCourses={[course('A')]} />);
    calculate();
    view.rerender(<WorkloadAnalyzer selectedCourses={[course('B')]} />);
    calculate();
    await act(async () => first.resolve(response(11.1)));
    expect(screen.queryByRole('region', { name: 'Workload result' })).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent('Calculating your workload estimate');
    await act(async () => second.resolve(response(29.9)));
    expect(screen.getByRole('region', { name: 'Workload result' })).toHaveTextContent('29.9');
    expect(screen.queryByText('11.1')).toBeNull();
    expect(analyzeWorkload).toHaveBeenCalledTimes(2);
  });

  it('invalidates an A-to-B-to-A request even though the final course IDs match', async () => {
    const stale = pending();
    vi.mocked(analyzeWorkload)
      .mockReturnValueOnce(stale.promise)
      .mockResolvedValueOnce(response(25.5));
    const view = render(<WorkloadAnalyzer selectedCourses={[course('A')]} />);
    calculate();
    view.rerender(<WorkloadAnalyzer selectedCourses={[course('B')]} />);
    view.rerender(<WorkloadAnalyzer selectedCourses={[course('A')]} />);
    await act(async () => stale.resolve(response(11.1)));
    expect(screen.queryByRole('region', { name: 'Workload result' })).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
    calculate();
    expect(await screen.findByRole('region', { name: 'Workload result' })).toHaveTextContent(
      '25.5',
    );
    expect(analyzeWorkload).toHaveBeenCalledTimes(2);
  });

  it('hides previous results while reanalyzing, changing or clearing a selection', async () => {
    const fresh = pending();
    vi.mocked(analyzeWorkload).mockResolvedValueOnce(response()).mockReturnValueOnce(fresh.promise);
    const view = render(<WorkloadAnalyzer selectedCourses={[course('A')]} />);
    calculate();
    await screen.findByRole('region', { name: 'Workload result' });
    calculate();
    expect(screen.queryByRole('region', { name: 'Workload result' })).toBeNull();
    view.rerender(<WorkloadAnalyzer selectedCourses={[course('B')]} />);
    expect(screen.queryByRole('region', { name: 'Workload result' })).toBeNull();
    view.rerender(<WorkloadAnalyzer selectedCourses={[]} />);
    await act(async () => fresh.resolve(response(33.3)));
    expect(screen.queryByRole('region', { name: 'Workload result' })).toBeNull();
    expect(
      screen.queryByRole('button', { name: /Analyze|Calculate estimate|Retry analysis/ }),
    ).toBeNull();
  });

  it.each(['transport failure', 'unsuccessful response'] as const)(
    'offers a working retry after %s without showing a stale result',
    async (kind) => {
      const mock = vi.mocked(analyzeWorkload);
      if (kind === 'transport failure') mock.mockRejectedValueOnce(new Error('Offline'));
      else mock.mockResolvedValueOnce({ success: false, error: 'Unavailable' });
      mock.mockResolvedValueOnce(response());
      render(<WorkloadAnalyzer selectedCourses={[course('A')]} />);
      calculate();
      expect(await screen.findByRole('alert')).toHaveTextContent(
        'couldn’t calculate this selection',
      );
      expect(screen.queryByRole('region', { name: 'Workload result' })).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: 'Retry analysis' }));
      await screen.findByRole('region', { name: 'Workload result' });
      expect(screen.queryByRole('alert')).toBeNull();
      expect(analyzeWorkload).toHaveBeenCalledTimes(2);
    },
  );

  it.each([
    ['missing data', undefined],
    ['null data', null],
    ['missing fields', {}],
    ['text credits', { ...response().data!, totalCredits: '7' }],
    ['negative credits', { ...response().data!, totalCredits: -1 }],
    ['nonfinite credits', { ...response().data!, totalCredits: Number.NaN }],
    ['missing score', { ...response().data!, workloadScore: undefined }],
    ['negative score', { ...response().data!, workloadScore: -1 }],
    ['nonfinite score', { ...response().data!, workloadScore: Number.POSITIVE_INFINITY }],
    ['negative difficulty', { ...response().data!, averageDifficulty: -1 }],
    ['out-of-range difficulty', { ...response().data!, averageDifficulty: 5.1 }],
    ['nonfinite difficulty', { ...response().data!, averageDifficulty: Number.NaN }],
    ['unknown risk', { ...response().data!, riskLevel: 'UNKNOWN' }],
    ['missing notes', { ...response().data!, recommendations: undefined }],
    ['text notes', { ...response().data!, recommendations: 'Review teaching capacity' }],
    ['non-text note', { ...response().data!, recommendations: [{}] }],
  ])('recovers from a malformed successful response: %s', async (_description, data) => {
    vi.mocked(analyzeWorkload)
      .mockResolvedValueOnce({ success: true, data } as ApiResponse<WorkloadAnalysis>)
      .mockResolvedValueOnce(response());
    render(<WorkloadAnalyzer selectedCourses={[course('A')]} />);
    calculate();
    expect(await screen.findByRole('alert')).toHaveTextContent('couldn’t calculate this selection');
    expect(screen.queryByRole('region', { name: 'Workload result' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Retry analysis' }));
    expect(await screen.findByRole('region', { name: 'Workload result' })).toHaveTextContent(
      '18.2',
    );
    expect(screen.queryByRole('alert')).toBeNull();
    expect(analyzeWorkload).toHaveBeenCalledTimes(2);
  });

  it.each([0, 5])('accepts a valid difficulty boundary of %s', async (averageDifficulty) => {
    vi.mocked(analyzeWorkload).mockResolvedValue({
      success: true,
      data: {
        totalCredits: 0,
        workloadScore: 0,
        averageDifficulty,
        riskLevel: 'LOW',
        recommendations: [],
      },
    });
    render(<WorkloadAnalyzer selectedCourses={[course('A')]} />);
    calculate();
    expect(await screen.findByRole('region', { name: 'Workload result' })).toHaveTextContent(
      'Server estimate: 0 credits',
    );
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('ignores a request that settles after unmount while a new analyzer is in use', async () => {
    const stale = pending();
    vi.mocked(analyzeWorkload)
      .mockReturnValueOnce(stale.promise)
      .mockResolvedValueOnce(response(22.2));
    const old = render(<WorkloadAnalyzer selectedCourses={[course('A')]} />);
    calculate();
    old.unmount();
    render(<WorkloadAnalyzer selectedCourses={[course('B')]} />);
    calculate();
    await screen.findByRole('region', { name: 'Workload result' });
    await act(async () => stale.resolve(response(11.1)));
    expect(screen.getByRole('region', { name: 'Workload result' })).toHaveTextContent('22.2');
    expect(screen.queryByText('11.1')).toBeNull();
  });
});
