import '@testing-library/jest-dom/vitest';
import { StrictMode, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiResponse, Course, Recommendation } from '@/types';
import { getRecommendations } from '@/lib/api';
import { Recommendations } from '../Recommendations';

const handlers = vi.hoisted(() => new Map<string, () => void>());
vi.mock('@/lib/api', () => ({ getRecommendations: vi.fn() }));
vi.mock('@components/ui', async (importOriginal) => {
  const original = await importOriginal<typeof import('@components/ui')>();
  return {
    ...original,
    Button: ({
      children,
      onClick,
      ...props
    }: ButtonHTMLAttributes<HTMLButtonElement> & { children?: ReactNode }) => {
      if (typeof children === 'string' && onClick)
        handlers.set(children, () => onClick({} as React.MouseEvent<HTMLButtonElement>));
      return (
        <button {...props} onClick={onClick}>
          {children}
        </button>
      );
    },
  };
});
const course = (code: string): Course => ({
  id: code,
  code,
  name: `${code} course`,
  credits: 3,
  difficultyLevel: 5,
  category: 'CORE',
  semesterOffered: ['FALL'],
  prerequisites: [],
  isPrerequisiteFor: [],
  createdAt: '',
  updatedAt: '',
  ratingDifficulty: 2.4,
  ratingCount: 7,
});
const response = (
  code = 'NEW',
  gpaPath: Recommendation['stats']['gpaPath'] = 'THESIS',
): ApiResponse<Recommendation> => ({
  success: true,
  data: {
    courses: code ? [course(code)] : [],
    stats: {
      gpaPath,
      totalAvailable: 4,
      filteredCount: 4,
      recommendedCount: code ? 1 : 0,
      totalRecommendedCredits: code ? 3 : 0,
      averageDifficulty: code ? 2.4 : 0,
    },
  },
});
function deferred() {
  let resolve!: (value: ApiResponse<Recommendation>) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<ApiResponse<Recommendation>>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
beforeEach(() => {
  vi.resetAllMocks();
  handlers.clear();
});
afterEach(cleanup);

describe('account-scoped recommendations', () => {
  it('requests signed-in suggestions and shows estimated difficulty with actual counts', async () => {
    vi.mocked(getRecommendations).mockResolvedValue(response());
    render(<Recommendations userId="A" />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading suggestions');
    expect(await screen.findByText('NEW')).toBeInTheDocument();
    expect(getRecommendations).toHaveBeenCalledWith('A', { maxCredits: 18, maxDifficulty: 3.5 });
    expect(screen.getByText('Difficulty 2.4 / 5')).toBeInTheDocument();
    expect(screen.getByText('7 ratings')).toBeInTheDocument();
    expect(screen.queryByText(/seeded|AI-powered|Difficulty Level/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Add/ })).not.toBeInTheDocument();
  });
  it.each([
    ['THESIS', /recorded GPA selects the Thesis path/],
    ['ALTERNATIVE', /recorded GPA selects the alternative path/],
    [
      null,
      /Suggestions may include both Year 4, Semester 2 paths; your manual curriculum choice is not applied here/,
    ],
  ] as const)('explains the server path %s even when no courses fit', async (path, copy) => {
    vi.mocked(getRecommendations).mockResolvedValue(response('', path));
    render(<Recommendations userId="A" />);
    expect(await screen.findByText(copy)).toBeInTheDocument();
    expect(screen.getByText('No courses fit these planning limits.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Refresh suggestions' })).toBeInTheDocument();
  });
  it('reports a real zero-vote estimate without falling back to seed difficulty', async () => {
    const value = response();
    value.data!.courses[0].ratingCount = 0;
    vi.mocked(getRecommendations).mockResolvedValue(value);
    render(<Recommendations userId="A" />);
    expect(await screen.findByText('No ratings yet')).toBeInTheDocument();
    expect(screen.getByText('Difficulty 2.4 / 5')).toBeInTheDocument();
  });
  it('clears old results on refresh and replaces them with the new snapshot', async () => {
    const next = deferred();
    vi.mocked(getRecommendations)
      .mockResolvedValueOnce(response('OLD'))
      .mockReturnValueOnce(next.promise);
    render(<Recommendations userId="A" />);
    await screen.findByText('OLD');
    fireEvent.click(screen.getByRole('button', { name: 'Refresh suggestions' }));
    expect(screen.queryByText('OLD')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument();
    await act(async () => next.resolve(response('NEW')));
    expect(screen.getByText('NEW')).toBeInTheDocument();
  });
  it('shows failure and retry then clears the error on success', async () => {
    vi.mocked(getRecommendations)
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(response());
    render(<Recommendations userId="A" />);
    expect(await screen.findByRole('alert')).toHaveTextContent('couldn’t load course suggestions');
    fireEvent.click(screen.getByRole('button', { name: 'Retry loading' }));
    expect(await screen.findByText('NEW')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
  it('treats a failed or missing-data envelope as a retryable failure', async () => {
    vi.mocked(getRecommendations).mockResolvedValue({ success: false, error: 'failure' });
    render(<Recommendations userId="A" />);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });
  it('hides the previous account immediately and ignores its late response', async () => {
    const old = deferred();
    const next = deferred();
    vi.mocked(getRecommendations)
      .mockReturnValueOnce(old.promise)
      .mockReturnValueOnce(next.promise);
    const view = render(<Recommendations userId="A" />);
    view.rerender(<Recommendations userId="B" />);
    await act(async () => old.resolve(response('OLD-A')));
    expect(screen.queryByText('OLD-A')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument();
    await act(async () => next.resolve(response('NEW-B')));
    expect(screen.getByText('NEW-B')).toBeInTheDocument();
  });
  it('ignores stale account errors and stale retry handlers', async () => {
    const late = deferred();
    vi.mocked(getRecommendations)
      .mockRejectedValueOnce(new Error('A error'))
      .mockReturnValueOnce(late.promise);
    const view = render(<Recommendations userId="A" />);
    await screen.findByRole('alert');
    const oldRetry = handlers.get('Retry loading')!;
    view.rerender(<Recommendations userId="B" />);
    act(oldRetry);
    expect(getRecommendations).toHaveBeenCalledTimes(2);
    await act(async () => late.resolve(response('B')));
    expect(screen.getByText('B')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
  it('isolates A to B to A from both previous account generations and handlers', async () => {
    const first = deferred();
    const middle = deferred();
    const last = deferred();
    vi.mocked(getRecommendations)
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(middle.promise)
      .mockReturnValueOnce(last.promise);
    const view = render(<Recommendations userId="A" />);
    view.rerender(<Recommendations userId="B" />);
    view.rerender(<Recommendations userId="A" />);
    await act(async () => {
      first.resolve(response('FIRST-A'));
      middle.reject(new Error('B stale'));
    });
    expect(screen.queryByText('FIRST-A')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    await act(async () => last.resolve(response('LATEST-A')));
    expect(screen.getByText('LATEST-A')).toBeInTheDocument();
  });
  it('invalidates outstanding requests and refresh handlers after unmount', async () => {
    const next = deferred();
    vi.mocked(getRecommendations)
      .mockResolvedValueOnce(response())
      .mockReturnValueOnce(next.promise);
    const view = render(<Recommendations userId="A" />);
    await screen.findByText('NEW');
    const refresh = handlers.get('Refresh suggestions')!;
    fireEvent.click(screen.getByRole('button', { name: 'Refresh suggestions' }));
    view.unmount();
    act(refresh);
    expect(getRecommendations).toHaveBeenCalledTimes(2);
    await act(async () => next.resolve(response('UNMOUNTED')));
    expect(screen.queryByText('UNMOUNTED')).not.toBeInTheDocument();
  });
  it('keeps only the current StrictMode request', async () => {
    const stale = deferred();
    const current = deferred();
    vi.mocked(getRecommendations)
      .mockReturnValueOnce(stale.promise)
      .mockReturnValueOnce(current.promise);
    render(
      <StrictMode>
        <Recommendations userId="A" />
      </StrictMode>,
    );
    await act(async () => current.resolve(response('CURRENT')));
    await act(async () => stale.resolve(response('STALE')));
    expect(screen.getByText('CURRENT')).toBeInTheDocument();
    expect(screen.queryByText('STALE')).not.toBeInTheDocument();
  });
  it('does not reuse the first A refresh handler after switching back to A', async () => {
    vi.mocked(getRecommendations)
      .mockResolvedValueOnce(response('FIRST'))
      .mockResolvedValueOnce(response('B'))
      .mockResolvedValueOnce(response('LAST'));
    const view = render(<Recommendations userId="A" />);
    await screen.findByText('FIRST');
    const oldRefresh = handlers.get('Refresh suggestions')!;
    view.rerender(<Recommendations userId="B" />);
    await screen.findByText('B');
    view.rerender(<Recommendations userId="A" />);
    await screen.findByText('LAST');
    act(oldRefresh);
    expect(getRecommendations).toHaveBeenCalledTimes(3);
    expect(screen.getByText('LAST')).toBeInTheDocument();
  });
  it('clears prior suggestions when a refresh fails', async () => {
    vi.mocked(getRecommendations)
      .mockResolvedValueOnce(response('OLD'))
      .mockRejectedValueOnce(new Error('offline'));
    render(<Recommendations userId="A" />);
    await screen.findByText('OLD');
    fireEvent.click(screen.getByRole('button', { name: 'Refresh suggestions' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText('OLD')).not.toBeInTheDocument();
  });
  it('retains unknown estimates without displaying the individual difficulty seed', async () => {
    const value = response();
    delete value.data!.courses[0].ratingDifficulty;
    vi.mocked(getRecommendations).mockResolvedValue(value);
    render(<Recommendations userId="A" />);
    await screen.findByText('NEW');
    expect(screen.queryByText(/Difficulty Level|Difficulty 5|Seeded/)).not.toBeInTheDocument();
  });
  it('ignores an older rejection after the current account succeeds', async () => {
    const old = deferred();
    vi.mocked(getRecommendations)
      .mockReturnValueOnce(old.promise)
      .mockResolvedValueOnce(response('B'));
    const view = render(<Recommendations userId="A" />);
    view.rerender(<Recommendations userId="B" />);
    await screen.findByText('B');
    await act(async () => old.reject(new Error('stale A')));
    expect(screen.getByText('B')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
  it.each([
    ['missing GPA path', { ...response().data!.stats, gpaPath: undefined }],
    ['unknown GPA path', { ...response().data!.stats, gpaPath: 'UNKNOWN' }],
    ['nonfinite average', { ...response().data!.stats, averageDifficulty: NaN }],
    ['missing count', { ...response().data!.stats, filteredCount: undefined }],
  ])('rejects %s instead of presenting a manual GPA fallback', async (_label, stats) => {
    const malformed = { success: true, data: { courses: [course('INVALID')], stats } };
    vi.mocked(getRecommendations)
      .mockResolvedValueOnce(malformed as ApiResponse<Recommendation>)
      .mockResolvedValueOnce(response('VALID'));
    render(<Recommendations userId="A" />);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText(/No numeric GPA is recorded/)).not.toBeInTheDocument();
    expect(screen.queryByText('INVALID')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry loading' }));
    expect(await screen.findByText('VALID')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
  it('rejects malformed course arrays without rendering broken course rows', async () => {
    const malformed = { success: true, data: { courses: null, stats: response().data!.stats } };
    vi.mocked(getRecommendations).mockResolvedValue(
      malformed as unknown as ApiResponse<Recommendation>,
    );
    render(<Recommendations userId="A" />);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });
});
