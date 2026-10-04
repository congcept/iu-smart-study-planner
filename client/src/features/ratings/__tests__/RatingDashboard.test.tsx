import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  RatingCourseChoiceDTO,
  RatingCourseChoicesDTO,
  ScopedOwnCourseRatingsDTO,
  SubmittedCourseRatingDTO,
} from '@iu-study-planner/shared';
import { getRatingCourseChoices, getScopedOwnRatings, rateCourse } from '@/lib/ratingsApi';
import { RatingDashboard } from '../RatingDashboard';
vi.mock('@/lib/ratingsApi', () => ({
  getRatingCourseChoices: vi.fn(),
  getScopedOwnRatings: vi.fn(),
  rateCourse: vi.fn(),
}));
const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const one = '11111111-1111-4111-8111-111111111111';
const two = '22222222-2222-4222-8222-222222222222';
const scope = { userId: one, curriculumId: null };
const key = (owner = one) => `pending_course_rating:${owner}`;
const course = (courseId: string, code: string): RatingCourseChoiceDTO => ({
  id: courseId,
  code,
  name: 'Calculus',
  avgRating: null,
  ratingCount: 0,
  ratingDifficulty: 3,
  ratingPriorMean: 3,
  ratingPriorSource: 'GLOBAL_SEED',
  yourRating: null,
  membership: 'UNASSIGNED',
});
function choices(owner = one, courses = [course(id, 'MA001IU')]): RatingCourseChoicesDTO {
  return { scope: { userId: owner, curriculumId: null }, courses };
}
function confirmed(rating = 4): ScopedOwnCourseRatingsDTO {
  return { scope, ratings: [{ courseId: id, rating }] };
}
const saved: SubmittedCourseRatingDTO = {
  yourRating: 4,
  average: 4,
  count: 1,
  distribution: { 1: 0, 2: 0, 3: 0, 4: 1, 5: 0 },
  difficulty: 3.5,
  priorMean: 3.4,
  priorSource: 'GLOBAL_RATINGS',
};
let storage: Map<string, string>;
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function choose(rating = '4') {
  const select = await screen.findByRole('combobox', { name: /^Course$/ });
  fireEvent.change(select, { target: { value: id } });
  fireEvent.change(screen.getByRole('combobox', { name: 'Your difficulty rating' }), {
    target: { value: rating },
  });
}
beforeEach(() => {
  vi.resetAllMocks();
  storage = new Map();
  vi.stubGlobal('sessionStorage', {
    getItem: vi.fn((key: string) => storage.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => storage.set(key, value)),
    removeItem: vi.fn((key: string) => storage.delete(key)),
  });
  vi.mocked(getRatingCourseChoices).mockImplementation(async (owner) => choices(owner));
  vi.mocked(getScopedOwnRatings).mockImplementation(async (owner) => ({
    scope: { userId: owner, curriculumId: null },
    ratings: [],
  }));
  vi.mocked(rateCourse).mockResolvedValue(saved);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
describe('course rating form', () => {
  it('loads authoritative completion and offers no planned courses', async () => {
    render(<RatingDashboard userId={one} />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading');
    await choose();
    expect(screen.queryByRole('option', { name: /MA003IU/ })).not.toBeInTheDocument();
    expect(screen.getByText('No ratings yet')).toBeInTheDocument();
  });
  it('shows the saved private vote when selecting a completed course', async () => {
    vi.mocked(getRatingCourseChoices).mockResolvedValue(
      choices(one, [
        {
          ...course(id, 'MA001IU'),
          yourRating: 2,
          ratingCount: 1,
          avgRating: 2,
        },
      ]),
    );
    render(<RatingDashboard userId={one} />);
    fireEvent.change(await screen.findByRole('combobox', { name: /^Course$/ }), {
      target: { value: id },
    });
    expect(screen.getByText('Your saved rating: 2 / 5')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Your difficulty rating' })).toHaveValue('2');
  });
  it('has an explicit empty state', async () => {
    vi.mocked(getRatingCourseChoices).mockResolvedValue(choices(one, []));
    render(<RatingDashboard userId={one} />);
    expect(await screen.findByText(/Complete a course in My curriculum/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save rating' })).not.toBeInTheDocument();
  });
  it('reloads after a failed initial read', async () => {
    vi.mocked(getRatingCourseChoices).mockRejectedValueOnce(new Error('offline'));
    render(<RatingDashboard userId={one} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Reload courses' }));
    await choose();
  });
  it('rejects an empty form without posting', async () => {
    render(<RatingDashboard userId={one} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Save rating' }));
    expect(screen.getByText(/Choose a completed course and a difficulty/)).toBeInTheDocument();
    expect(rateCourse).not.toHaveBeenCalled();
  });
  it('saves one vote, clears recovery data and refreshes estimates', async () => {
    vi.mocked(getScopedOwnRatings).mockResolvedValue(confirmed());
    vi.mocked(getRatingCourseChoices)
      .mockResolvedValueOnce(choices())
      .mockResolvedValue(
        choices(one, [{ ...course(id, 'MA001IU'), yourRating: 4, ratingCount: 1, avgRating: 4 }]),
      );
    render(<RatingDashboard userId={one} />);
    await choose();
    fireEvent.click(screen.getByRole('button', { name: 'Save rating' }));
    expect(await screen.findByText(/Rating saved/)).toBeInTheDocument();
    await screen.findByText('Your saved rating: 4 / 5');
    expect(rateCourse).toHaveBeenCalledWith(id, { rating: 4, expectedScope: scope });
    expect(storage.has(key())).toBe(false);
    expect(getRatingCourseChoices).toHaveBeenCalledTimes(2);
    expect(getScopedOwnRatings).toHaveBeenCalledWith(one);
    await waitFor(() => expect(screen.getByRole('combobox', { name: /^Course$/ })).toHaveFocus());
  });
  it('prevents duplicate clicks while a save is pending', async () => {
    const pending = deferred<SubmittedCourseRatingDTO>();
    const confirmation = deferred<ScopedOwnCourseRatingsDTO>();
    vi.mocked(rateCourse).mockReturnValue(pending.promise);
    vi.mocked(getScopedOwnRatings).mockReturnValueOnce(confirmation.promise);
    render(<RatingDashboard userId={one} />);
    await choose();
    const button = screen.getByRole('button', { name: 'Save rating' });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(rateCourse).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('combobox', { name: /^Course$/ })).toBeDisabled();
    await act(async () => pending.resolve(saved));
    expect(getScopedOwnRatings).toHaveBeenCalledExactlyOnceWith(one);
    expect(screen.getByRole('combobox', { name: /^Course$/ })).toBeDisabled();
    expect(storage.has(key())).toBe(true);
    await act(async () => confirmation.resolve(confirmed()));
    expect(storage.has(key())).toBe(false);
  });
  it('locks an uncertain payload and retries exactly that vote', async () => {
    vi.mocked(rateCourse)
      .mockRejectedValueOnce(new Error('lost response'))
      .mockResolvedValue(saved);
    render(<RatingDashboard userId={one} />);
    await choose();
    fireEvent.click(screen.getByRole('button', { name: 'Save rating' }));
    const retry = await screen.findByRole('button', { name: 'Retry same rating' });
    expect(screen.getByRole('combobox', { name: 'Your difficulty rating' })).toBeDisabled();
    expect(JSON.parse(storage.get(key())!)).toEqual({
      courseId: id,
      rating: 4,
      expectedScope: scope,
    });
    vi.mocked(getScopedOwnRatings).mockResolvedValueOnce(confirmed());
    fireEvent.click(retry);
    await screen.findByText(/Rating saved/);
    expect(vi.mocked(rateCourse).mock.calls).toEqual([
      [id, { rating: 4, expectedScope: scope }],
      [id, { rating: 4, expectedScope: scope }],
    ]);
  });
  it('restores a pending vote after a remount without automatically writing', async () => {
    storage.set(key(), JSON.stringify({ courseId: id, rating: 1, expectedScope: scope }));
    render(<RatingDashboard userId={one} />);
    await screen.findByRole('button', { name: 'Retry same rating' });
    expect(screen.getByRole('combobox', { name: 'Your difficulty rating' })).toHaveValue('1');
    expect(rateCourse).not.toHaveBeenCalled();
  });
  it('blocks a legacy scope-less journal and clears only the local pending retry on request', async () => {
    const legacy = JSON.stringify({ courseId: id, rating: 4 });
    storage.set(key(), legacy);
    render(<RatingDashboard userId={one} />);
    const clear = await screen.findByRole('button', { name: 'Clear pending retry' });
    expect(screen.getByRole('button', { name: 'Retry same rating' })).toBeDisabled();
    expect(storage.get(key())).toBe(legacy);
    expect(rateCourse).not.toHaveBeenCalled();
    fireEvent.click(clear);
    expect(storage.has(key())).toBe(false);
    expect(rateCourse).not.toHaveBeenCalled();
  });
  it('does not discard an uncertain vote when courses are reloaded', async () => {
    storage.set(key(), JSON.stringify({ courseId: id, rating: 4, expectedScope: scope }));
    vi.mocked(getRatingCourseChoices).mockResolvedValue(choices(one, []));
    render(<RatingDashboard userId={one} />);
    expect(await screen.findByRole('button', { name: 'Retry same rating' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Clear pending retry' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Previous pending course' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Reload courses' }));
    expect(await screen.findByRole('button', { name: 'Retry same rating' })).toBeDisabled();
    expect(storage.has(key())).toBe(true);
    expect(rateCourse).not.toHaveBeenCalled();
  });
  it('explains an hourly quota and retains the pending vote', async () => {
    vi.mocked(rateCourse).mockRejectedValue({
      isAxiosError: true,
      response: { status: 429, headers: { 'retry-after': '120' } },
    });
    render(<RatingDashboard userId={one} />);
    await choose();
    fireEvent.click(screen.getByRole('button', { name: 'Save rating' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Retry this same rating in 2 minutes',
    );
    expect(storage.has(key())).toBe(true);
  });
  it('blocks writes when recovery storage cannot be written', async () => {
    vi.mocked(sessionStorage.setItem).mockImplementation(() => {
      throw new Error('storage');
    });
    render(<RatingDashboard userId={one} />);
    await choose();
    fireEvent.click(screen.getByRole('button', { name: 'Save rating' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not preserve this request');
    expect(rateCourse).not.toHaveBeenCalled();
  });
  it('blocks corrupt recovery data without deleting it', async () => {
    storage.set(key(), '{bad');
    render(<RatingDashboard userId={one} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('no verified account context');
    expect(screen.queryByRole('button', { name: 'Save rating' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Clear pending retry' })).toBeEnabled();
    expect(storage.get(key())).toBe('{bad');
    expect(rateCourse).not.toHaveBeenCalled();
  });
  it('ignores a late save after switching account and leaves its journal intact', async () => {
    const pending = deferred<SubmittedCourseRatingDTO>();
    vi.mocked(rateCourse).mockReturnValue(pending.promise);
    const { rerender } = render(<RatingDashboard userId={one} />);
    await choose();
    fireEvent.click(screen.getByRole('button', { name: 'Save rating' }));
    rerender(<RatingDashboard userId={two} />);
    await screen.findByRole('button', { name: 'Save rating' });
    await act(async () => pending.resolve(saved));
    expect(screen.queryByText(/Rating saved/)).not.toBeInTheDocument();
    expect(storage.has(key())).toBe(true);
    expect(storage.has(key(two))).toBe(false);
  });
});
