import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SubmittedCourseRatingDTO } from '@iu-study-planner/shared';
import { getCourses, getCurrentStudentProgress } from '@/lib/api';
import { getOwnRatings, rateCourse } from '@/lib/ratingsApi';
import type { Course } from '@/types';
import { RatingDashboard } from '../RatingDashboard';
vi.mock('@/lib/api', () => ({ getCourses: vi.fn(), getCurrentStudentProgress: vi.fn() }));
vi.mock('@/lib/ratingsApi', () => ({ getOwnRatings: vi.fn(), rateCourse: vi.fn() }));
const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const other = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const course = (courseId: string, code: string): Course => ({
  id: courseId,
  code,
  name: 'Calculus',
  credits: 4,
  category: 'CORE',
  difficultyLevel: 2,
  prerequisites: [],
  ratingCount: 0,
  ratingDifficulty: 3,
  semesterOffered: [],
  isPrerequisiteFor: [],
  createdAt: '',
  updatedAt: '',
});
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
  vi.mocked(getCourses).mockResolvedValue({
    success: true,
    data: [course(id, 'MA001IU'), course(other, 'MA003IU')],
  });
  vi.mocked(getCurrentStudentProgress).mockResolvedValue({
    completedIds: { [id]: null },
    plannedIds: [other],
  });
  vi.mocked(getOwnRatings).mockResolvedValue([]);
  vi.mocked(rateCourse).mockResolvedValue(saved);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
describe('course rating form', () => {
  it('loads authoritative completion and offers no planned courses', async () => {
    render(<RatingDashboard userId="one" />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading');
    await choose();
    expect(screen.queryByRole('option', { name: /MA003IU/ })).not.toBeInTheDocument();
    expect(screen.getByText('No ratings yet')).toBeInTheDocument();
  });
  it('shows the saved private vote when selecting a completed course', async () => {
    vi.mocked(getOwnRatings).mockResolvedValue([{ courseId: id, rating: 2 }]);
    render(<RatingDashboard userId="one" />);
    fireEvent.change(await screen.findByRole('combobox', { name: /^Course$/ }), {
      target: { value: id },
    });
    expect(screen.getByText('Your saved rating: 2 / 5')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Your difficulty rating' })).toHaveValue('2');
  });
  it('has an explicit empty state', async () => {
    vi.mocked(getCurrentStudentProgress).mockResolvedValue({ completedIds: {}, plannedIds: [] });
    render(<RatingDashboard userId="one" />);
    expect(await screen.findByText(/Complete a course in My curriculum/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save rating' })).not.toBeInTheDocument();
  });
  it('reloads after a failed initial read', async () => {
    vi.mocked(getOwnRatings).mockRejectedValueOnce(new Error('offline'));
    render(<RatingDashboard userId="one" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Reload courses' }));
    await choose();
  });
  it('rejects an empty form without posting', async () => {
    render(<RatingDashboard userId="one" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Save rating' }));
    expect(screen.getByText(/Choose a completed course and a difficulty/)).toBeInTheDocument();
    expect(rateCourse).not.toHaveBeenCalled();
  });
  it('saves one vote, clears recovery data and refreshes estimates', async () => {
    vi.mocked(getOwnRatings)
      .mockResolvedValueOnce([])
      .mockResolvedValue([{ courseId: id, rating: 4 }]);
    render(<RatingDashboard userId="one" />);
    await choose();
    fireEvent.click(screen.getByRole('button', { name: 'Save rating' }));
    expect(await screen.findByText(/Rating saved/)).toBeInTheDocument();
    await screen.findByText('Your saved rating: 4 / 5');
    expect(rateCourse).toHaveBeenCalledWith(id, { rating: 4 });
    expect(storage.has('pending_course_rating:one')).toBe(false);
    expect(getCourses).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(screen.getByRole('combobox', { name: /^Course$/ })).toHaveFocus());
  });
  it('prevents duplicate clicks while a save is pending', async () => {
    const pending = deferred<SubmittedCourseRatingDTO>();
    vi.mocked(rateCourse).mockReturnValue(pending.promise);
    render(<RatingDashboard userId="one" />);
    await choose();
    const button = screen.getByRole('button', { name: 'Save rating' });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(rateCourse).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('combobox', { name: /^Course$/ })).toBeDisabled();
    await act(async () => pending.resolve(saved));
  });
  it('locks an uncertain payload and retries exactly that vote', async () => {
    vi.mocked(rateCourse)
      .mockRejectedValueOnce(new Error('lost response'))
      .mockResolvedValue(saved);
    render(<RatingDashboard userId="one" />);
    await choose();
    fireEvent.click(screen.getByRole('button', { name: 'Save rating' }));
    const retry = await screen.findByRole('button', { name: 'Retry same rating' });
    expect(screen.getByRole('combobox', { name: 'Your difficulty rating' })).toBeDisabled();
    expect(JSON.parse(storage.get('pending_course_rating:one')!)).toEqual({
      courseId: id,
      rating: 4,
    });
    fireEvent.click(retry);
    await screen.findByText(/Rating saved/);
    expect(vi.mocked(rateCourse).mock.calls).toEqual([
      [id, { rating: 4 }],
      [id, { rating: 4 }],
    ]);
  });
  it('restores a pending vote after a remount without automatically writing', async () => {
    storage.set('pending_course_rating:one', JSON.stringify({ courseId: id, rating: 1 }));
    render(<RatingDashboard userId="one" />);
    await screen.findByRole('button', { name: 'Retry same rating' });
    expect(screen.getByRole('combobox', { name: 'Your difficulty rating' })).toHaveValue('1');
    expect(rateCourse).not.toHaveBeenCalled();
  });
  it('does not discard an uncertain vote when courses are reloaded', async () => {
    storage.set('pending_course_rating:one', JSON.stringify({ courseId: id, rating: 4 }));
    vi.mocked(getCurrentStudentProgress).mockResolvedValue({ completedIds: {}, plannedIds: [] });
    render(<RatingDashboard userId="one" />);
    await screen.findByRole('button', { name: 'Retry same rating' });
    expect(screen.getByRole('option', { name: 'Previous pending course' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Reload courses' }));
    await screen.findByRole('button', { name: 'Retry same rating' });
    expect(storage.has('pending_course_rating:one')).toBe(true);
    expect(rateCourse).not.toHaveBeenCalled();
  });
  it('explains an hourly quota and retains the pending vote', async () => {
    vi.mocked(rateCourse).mockRejectedValue({
      isAxiosError: true,
      response: { status: 429, headers: { 'retry-after': '120' } },
    });
    render(<RatingDashboard userId="one" />);
    await choose();
    fireEvent.click(screen.getByRole('button', { name: 'Save rating' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Retry this same rating in 2 minutes',
    );
    expect(storage.has('pending_course_rating:one')).toBe(true);
  });
  it('blocks writes when recovery storage cannot be written', async () => {
    vi.mocked(sessionStorage.setItem).mockImplementation(() => {
      throw new Error('storage');
    });
    render(<RatingDashboard userId="one" />);
    await choose();
    fireEvent.click(screen.getByRole('button', { name: 'Save rating' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not preserve this request');
    expect(rateCourse).not.toHaveBeenCalled();
  });
  it('blocks corrupt recovery data without deleting it', async () => {
    storage.set('pending_course_rating:one', '{bad');
    render(<RatingDashboard userId="one" />);
    await screen.findByRole('button', { name: 'Save rating' });
    expect(screen.getByRole('button', { name: 'Save rating' })).toBeDisabled();
    expect(storage.get('pending_course_rating:one')).toBe('{bad');
  });
  it('ignores a late save after switching account and leaves its journal intact', async () => {
    const pending = deferred<SubmittedCourseRatingDTO>();
    vi.mocked(rateCourse).mockReturnValue(pending.promise);
    const { rerender } = render(<RatingDashboard userId="one" />);
    await choose();
    fireEvent.click(screen.getByRole('button', { name: 'Save rating' }));
    rerender(<RatingDashboard userId="two" />);
    await screen.findByRole('button', { name: 'Save rating' });
    await act(async () => pending.resolve(saved));
    expect(screen.queryByText(/Rating saved/)).not.toBeInTheDocument();
    expect(storage.has('pending_course_rating:one')).toBe(true);
    expect(storage.has('pending_course_rating:two')).toBe(false);
  });
});
