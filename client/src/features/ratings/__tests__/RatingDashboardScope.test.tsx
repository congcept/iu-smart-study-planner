import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  AccountWriteScopeDTO,
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
const owner = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const another = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const historicalId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const context = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const changedContext = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const scope = (userId = owner, curriculumId: string | null = context): AccountWriteScopeDTO => ({
  userId,
  curriculumId,
});
const choice = (overrides: Partial<RatingCourseChoiceDTO> = {}): RatingCourseChoiceDTO => ({
  id,
  code: 'MA001IU',
  name: 'Calculus',
  avgRating: null,
  ratingCount: 0,
  ratingDifficulty: 3,
  ratingPriorMean: 3,
  ratingPriorSource: 'CURRICULUM_SEED',
  yourRating: null,
  membership: 'CURRENT_CURRICULUM',
  ...overrides,
});
const choices = (courses = [choice()], currentScope = scope()): RatingCourseChoicesDTO => ({
  scope: currentScope,
  courses,
});
const ownVotes = (
  rating: number | null = null,
  currentScope = scope(),
): ScopedOwnCourseRatingsDTO => ({
  scope: currentScope,
  ratings: rating === null ? [] : [{ courseId: id, rating }],
});
const pending = (currentScope = scope()) => ({
  courseId: id,
  rating: 4,
  expectedScope: currentScope,
});
const journal = (userId = owner) => `pending_course_rating:${userId}`;
const saved: SubmittedCourseRatingDTO = {
  yourRating: 4,
  average: 4,
  count: 1,
  distribution: { 1: 0, 2: 0, 3: 0, 4: 1, 5: 0 },
  difficulty: 3.5,
  priorMean: 3.4,
  priorSource: 'CURRICULUM_RATINGS',
};
let storage: Map<string, string>;
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
async function selectCourse(courseId = id, rating = '4') {
  const select = await screen.findByRole('combobox', { name: /^Course$/ });
  fireEvent.change(select, { target: { value: courseId } });
  fireEvent.change(screen.getByRole('combobox', { name: 'Your difficulty rating' }), {
    target: { value: rating },
  });
}
const save = () => fireEvent.click(screen.getByRole('button', { name: 'Save rating' }));
const focus = () =>
  act(() => {
    window.dispatchEvent(new Event('focus'));
  });
beforeEach(() => {
  vi.resetAllMocks();
  storage = new Map();
  vi.stubGlobal('sessionStorage', {
    getItem: vi.fn((key: string) => storage.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => storage.set(key, value)),
    removeItem: vi.fn((key: string) => storage.delete(key)),
  });
  vi.mocked(getRatingCourseChoices).mockImplementation(async (userId) =>
    choices([choice()], scope(userId)),
  );
  vi.mocked(getScopedOwnRatings).mockImplementation(async (userId) =>
    ownVotes(null, scope(userId)),
  );
  vi.mocked(rateCourse).mockResolvedValue(saved);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('rating choices and confirmed write scope', () => {
  it('uses contextual difficulty and explains globally rateable historical completions', async () => {
    vi.mocked(getRatingCourseChoices).mockResolvedValue(
      choices([
        choice(),
        choice({
          id: historicalId,
          code: 'IT001IU',
          name: 'Historical programming',
          membership: 'OTHER_HISTORY',
          ratingDifficulty: 2,
          ratingPriorMean: 2,
          ratingPriorSource: 'GLOBAL_RATINGS',
        }),
      ]),
    );
    render(<RatingDashboard userId={owner} />);
    await selectCourse();
    expect(screen.getByText(/3\.0|3 \/ 5|3\/5/)).toBeInTheDocument();
    await selectCourse(historicalId);
    expect(screen.getByText(/outside your current curriculum.*global mean/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save rating' })).toBeEnabled();
  });

  it('locks while loading and never writes without current completed-choice proof', async () => {
    const load = deferred<RatingCourseChoicesDTO>();
    vi.mocked(getRatingCourseChoices).mockReturnValueOnce(load.promise);
    render(<RatingDashboard userId={owner} />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading');
    expect(screen.queryByRole('button', { name: 'Save rating' })).not.toBeInTheDocument();
    expect(rateCourse).not.toHaveBeenCalled();
    await act(async () => load.resolve(choices([])));
    expect(screen.queryByRole('button', { name: 'Save rating' })).not.toBeInTheDocument();
  });

  it.each(['wrong owner', 'malformed course'] as const)(
    'rejects %s choice snapshots without changing retained recovery data',
    async (caseName) => {
      const raw = JSON.stringify(pending());
      storage.set(journal(), raw);
      const bad =
        caseName === 'wrong owner'
          ? choices([choice()], scope(another))
          : { ...choices(), courses: [{ ...choice(), ratingCount: -1 }] };
      vi.mocked(getRatingCourseChoices).mockResolvedValue(bad);
      render(<RatingDashboard userId={owner} />);
      await screen.findByRole('button', { name: 'Reload courses' });
      expect(storage.get(journal())).toBe(raw);
      expect(rateCourse).not.toHaveBeenCalled();
      expect(screen.queryByRole('combobox', { name: /^Course$/ })).not.toBeInTheDocument();
    },
  );

  it('uses explicitly null scope for an unassigned completed-course save', async () => {
    vi.mocked(getRatingCourseChoices).mockResolvedValue(
      choices(
        [choice({ membership: 'UNASSIGNED', ratingPriorSource: 'GLOBAL_SEED' })],
        scope(owner, null),
      ),
    );
    vi.mocked(getScopedOwnRatings).mockResolvedValue(ownVotes(4, scope(owner, null)));
    render(<RatingDashboard userId={owner} />);
    await selectCourse();
    save();
    await waitFor(() => expect(storage.has(journal())).toBe(false));
    expect(rateCourse).toHaveBeenCalledWith(id, { rating: 4, expectedScope: scope(owner, null) });
  });

  it('journals the confirmed context before posting and keeps a double click locked through confirmation', async () => {
    const confirmation = deferred<ScopedOwnCourseRatingsDTO>();
    vi.mocked(getScopedOwnRatings).mockReturnValueOnce(confirmation.promise);
    render(<RatingDashboard userId={owner} />);
    await selectCourse();
    const button = screen.getByRole('button', { name: 'Save rating' });
    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() => expect(getScopedOwnRatings).toHaveBeenCalled());
    expect(rateCourse).toHaveBeenCalledTimes(1);
    expect(rateCourse).toHaveBeenCalledWith(id, { rating: 4, expectedScope: scope() });
    expect(JSON.parse(storage.get(journal())!)).toEqual(pending());
    expect(screen.getByRole('combobox', { name: /^Course$/ })).toBeDisabled();
    expect(screen.getByRole('combobox', { name: 'Your difficulty rating' })).toBeDisabled();
    expect(storage.has(journal())).toBe(true);
    await act(async () => confirmation.resolve(ownVotes(4)));
    await waitFor(() => expect(storage.has(journal())).toBe(false));
  });

  it('retains a pending vote when successful POST confirmation returns a different desired vote', async () => {
    vi.mocked(getScopedOwnRatings).mockResolvedValue(ownVotes(2));
    render(<RatingDashboard userId={owner} />);
    await selectCourse();
    save();
    await waitFor(() => expect(getScopedOwnRatings).toHaveBeenCalled());
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Retry same rating' })).toBeInTheDocument(),
    );
    expect(JSON.parse(storage.get(journal())!)).toEqual(pending());
    expect(screen.getByRole('combobox', { name: 'Your difficulty rating' })).toBeDisabled();
  });

  it('recovers a lost POST from matching scoped own-vote evidence even after course uncompletion', async () => {
    vi.mocked(rateCourse).mockRejectedValueOnce(new Error('Lost response'));
    vi.mocked(getScopedOwnRatings).mockResolvedValue(ownVotes(4));
    vi.mocked(getRatingCourseChoices)
      .mockResolvedValueOnce(choices())
      .mockResolvedValue(choices([]));
    render(<RatingDashboard userId={owner} />);
    await selectCourse();
    save();
    await waitFor(() => expect(storage.has(journal())).toBe(false));
    expect(rateCourse).toHaveBeenCalledTimes(1);
    expect(getScopedOwnRatings).toHaveBeenCalledWith(owner);
  });

  it.each(['different context', 'wrong owner'] as const)(
    'retains a committed-looking vote with %s evidence',
    async (caseName) => {
      const badScope =
        caseName === 'different context' ? scope(owner, changedContext) : scope(another);
      vi.mocked(getScopedOwnRatings).mockResolvedValue(ownVotes(4, badScope));
      render(<RatingDashboard userId={owner} />);
      await selectCourse();
      save();
      await screen.findByRole('button', { name: 'Clear pending retry' });
      expect(JSON.parse(storage.get(journal())!)).toEqual(pending());
      expect(rateCourse).toHaveBeenCalledTimes(1);
    },
  );

  it('keeps pending recovery after the confirmation endpoint fails', async () => {
    vi.mocked(getScopedOwnRatings).mockRejectedValue(new Error('Offline confirmation'));
    render(<RatingDashboard userId={owner} />);
    await selectCourse();
    save();
    await screen.findByRole('button', { name: 'Retry same rating' });
    expect(JSON.parse(storage.get(journal())!)).toEqual(pending());
    expect(rateCourse).toHaveBeenCalledTimes(1);
  });

  it('invalidates old completed-course proof after a plain adapter verification error and blocks retry until a strict reload succeeds', async () => {
    const reload = deferred<RatingCourseChoicesDTO>();
    vi.mocked(getRatingCourseChoices)
      .mockResolvedValueOnce(choices())
      .mockReturnValueOnce(reload.promise);
    vi.mocked(getScopedOwnRatings).mockRejectedValueOnce(
      new Error('Could not verify your own ratings'),
    );
    render(<RatingDashboard userId={owner} />);
    await selectCourse();
    save();
    await waitFor(() => expect(getRatingCourseChoices).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole('option', { name: /MA001IU/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry same rating' })).not.toBeInTheDocument();
    expect(JSON.parse(storage.get(journal())!)).toEqual(pending());
    expect(rateCourse).toHaveBeenCalledTimes(1);
    await act(async () => reload.reject(new Error('Offline strict choices')));
    await screen.findByRole('button', { name: 'Reload courses' });
    expect(screen.queryByRole('combobox', { name: /^Course$/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry same rating' })).not.toBeInTheDocument();
    expect(rateCourse).toHaveBeenCalledTimes(1);
    expect(JSON.parse(storage.get(journal())!)).toEqual(pending());
    fireEvent.click(screen.getByRole('button', { name: 'Reload courses' }));
    const retry = await screen.findByRole('button', { name: 'Retry same rating' });
    expect(retry).toBeEnabled();
    expect(rateCourse).toHaveBeenCalledTimes(1);
  });

  it('blocks another write when the strict choices refresh fails after a confirmed save', async () => {
    vi.mocked(getScopedOwnRatings).mockResolvedValue(ownVotes(4));
    vi.mocked(getRatingCourseChoices)
      .mockResolvedValueOnce(choices())
      .mockRejectedValue(new Error('Offline refreshed choices'));
    render(<RatingDashboard userId={owner} />);
    await selectCourse();
    save();
    await screen.findByRole('button', { name: 'Reload courses' });
    expect(storage.has(journal())).toBe(false);
    expect(screen.queryByRole('combobox', { name: /^Course$/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save rating' })).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /MA001IU/ })).not.toBeInTheDocument();
    expect(rateCourse).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Reload courses' }));
    await waitFor(() => expect(getRatingCourseChoices).toHaveBeenCalledTimes(3));
    expect(screen.queryByRole('button', { name: 'Save rating' })).not.toBeInTheDocument();
    expect(rateCourse).toHaveBeenCalledTimes(1);
  });

  it('does not release its journal when browser storage removal fails after confirmed save', async () => {
    vi.mocked(getScopedOwnRatings).mockResolvedValue(ownVotes(4));
    vi.mocked(sessionStorage.removeItem).mockImplementation(() => {
      throw new Error('Storage denied');
    });
    render(<RatingDashboard userId={owner} />);
    await selectCourse();
    save();
    await waitFor(() => expect(sessionStorage.removeItem).toHaveBeenCalled());
    expect(JSON.parse(storage.get(journal())!)).toEqual(pending());
    expect(screen.getByRole('combobox', { name: 'Your difficulty rating' })).toBeDisabled();
    expect(rateCourse).toHaveBeenCalledTimes(1);
  });

  it('suppresses focus reloads during POST and scoped confirmation', async () => {
    const post = deferred<SubmittedCourseRatingDTO>();
    const confirmation = deferred<ScopedOwnCourseRatingsDTO>();
    vi.mocked(rateCourse).mockReturnValueOnce(post.promise);
    vi.mocked(getScopedOwnRatings).mockReturnValueOnce(confirmation.promise);
    render(<RatingDashboard userId={owner} />);
    await selectCourse();
    save();
    focus();
    expect(getRatingCourseChoices).toHaveBeenCalledTimes(1);
    await act(async () => post.resolve(saved));
    await waitFor(() => expect(getScopedOwnRatings).toHaveBeenCalledTimes(1));
    focus();
    expect(getRatingCourseChoices).toHaveBeenCalledTimes(1);
    await act(async () => confirmation.resolve(ownVotes(4)));
    await waitFor(() => expect(storage.has(journal())).toBe(false));
  });

  it('refreshes focus proof, locks while loading and does not rebind a pending request after context change', async () => {
    storage.set(journal(), JSON.stringify(pending()));
    const reload = deferred<RatingCourseChoicesDTO>();
    vi.mocked(getRatingCourseChoices)
      .mockResolvedValueOnce(choices())
      .mockReturnValueOnce(reload.promise);
    render(<RatingDashboard userId={owner} />);
    await screen.findByRole('button', { name: 'Retry same rating' });
    focus();
    await waitFor(() => expect(getRatingCourseChoices).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole('button', { name: 'Retry same rating' })).not.toBeInTheDocument();
    await act(async () => reload.resolve(choices([choice()], scope(owner, changedContext))));
    await screen.findByRole('button', { name: 'Clear pending retry' });
    expect(JSON.parse(storage.get(journal())!)).toEqual(pending());
    expect(rateCourse).not.toHaveBeenCalled();
  });

  it('reloads after a 409 but leaves the old scoped payload blocked for explicit local resolution', async () => {
    vi.mocked(rateCourse).mockRejectedValueOnce({
      isAxiosError: true,
      response: { status: 409, headers: {}, data: { error: 'Curriculum changed' } },
    });
    vi.mocked(getScopedOwnRatings).mockResolvedValue(ownVotes(null, scope(owner, changedContext)));
    vi.mocked(getRatingCourseChoices)
      .mockResolvedValueOnce(choices())
      .mockResolvedValue(choices([choice()], scope(owner, changedContext)));
    render(<RatingDashboard userId={owner} />);
    await selectCourse();
    save();
    await screen.findByRole('button', { name: 'Clear pending retry' });
    await waitFor(() => expect(getRatingCourseChoices).toHaveBeenCalledTimes(2));
    expect(JSON.parse(storage.get(journal())!)).toEqual(pending());
    expect(rateCourse).toHaveBeenCalledTimes(1);
  });
});

describe('durable rating retry scope and account isolation', () => {
  it.each([
    ['scope-less', JSON.stringify({ courseId: id, rating: 4 })],
    ['wrong owner', JSON.stringify(pending(scope(another)))],
    ['corrupt', '{bad'],
  ])('retains %s journals without automatically writing or rebinding them', async (_label, raw) => {
    storage.set(journal(), raw);
    render(<RatingDashboard userId={owner} />);
    await screen.findByRole('button', { name: 'Clear pending retry' });
    expect(storage.get(journal())).toBe(raw);
    expect(rateCourse).not.toHaveBeenCalled();
    const saveButton = screen.queryByRole('button', { name: 'Save rating' });
    if (saveButton) {
      fireEvent.click(saveButton);
      expect(rateCourse).not.toHaveBeenCalled();
    }
  });

  it('blocks a pending vote whose old context no longer matches completed choices', async () => {
    storage.set(journal(), JSON.stringify(pending()));
    vi.mocked(getRatingCourseChoices).mockResolvedValue(
      choices([choice()], scope(owner, changedContext)),
    );
    render(<RatingDashboard userId={owner} />);
    await screen.findByRole('button', { name: 'Clear pending retry' });
    expect(JSON.parse(storage.get(journal())!)).toEqual(pending());
    expect(rateCourse).not.toHaveBeenCalled();
  });

  it('blocks retries for courses that are no longer completed without posting or dropping the journal', async () => {
    storage.set(journal(), JSON.stringify(pending()));
    vi.mocked(getRatingCourseChoices).mockResolvedValue(choices([]));
    render(<RatingDashboard userId={owner} />);
    await screen.findByRole('button', { name: 'Clear pending retry' });
    expect(JSON.parse(storage.get(journal())!)).toEqual(pending());
    expect(rateCourse).not.toHaveBeenCalled();
  });

  it('can confirm a remounted uncompleted pending vote using only the saved-rating read', async () => {
    storage.set(journal(), JSON.stringify(pending()));
    vi.mocked(getRatingCourseChoices).mockResolvedValue(choices([]));
    const confirmation = deferred<ScopedOwnCourseRatingsDTO>();
    vi.mocked(getScopedOwnRatings).mockReturnValueOnce(confirmation.promise);
    render(<RatingDashboard userId={owner} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Check saved rating' }));
    expect(storage.has(journal())).toBe(true);
    expect(rateCourse).not.toHaveBeenCalled();
    await act(async () => confirmation.resolve(ownVotes(4)));
    await waitFor(() => expect(storage.has(journal())).toBe(false));
    expect(rateCourse).not.toHaveBeenCalled();
    expect(getScopedOwnRatings).toHaveBeenCalledWith(owner);
  });

  it('clears pending recovery only explicitly in this tab and rehydrates before another choice', async () => {
    storage.set(journal(), JSON.stringify({ courseId: id, rating: 4 }));
    render(<RatingDashboard userId={owner} />);
    const clear = await screen.findByRole('button', { name: 'Clear pending retry' });
    expect(screen.getByText(/may already|already.*saved/i)).toBeInTheDocument();
    const reload = deferred<RatingCourseChoicesDTO>();
    vi.mocked(getRatingCourseChoices).mockReturnValueOnce(reload.promise);
    fireEvent.click(clear);
    expect(storage.has(journal())).toBe(false);
    expect(rateCourse).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Save rating' })).not.toBeInTheDocument();
    await act(async () => reload.resolve(choices()));
    await selectCourse();
    expect(screen.getByRole('button', { name: 'Save rating' })).toBeEnabled();
    expect(rateCourse).not.toHaveBeenCalled();
  });

  it('unlocks after read-only confirmation resolves a valid pending retry whose storage rewrite failed', async () => {
    storage.set(journal(), JSON.stringify(pending()));
    vi.mocked(sessionStorage.setItem).mockImplementation(() => {
      throw new Error('Storage denied');
    });
    vi.mocked(getScopedOwnRatings).mockResolvedValue(ownVotes(4));
    vi.mocked(getRatingCourseChoices)
      .mockResolvedValueOnce(choices())
      .mockResolvedValue(
        choices([
          choice({
            yourRating: 4,
            avgRating: 4,
            ratingCount: 1,
            ratingDifficulty: 4,
            ratingPriorMean: 4,
            ratingPriorSource: 'CURRICULUM_RATINGS',
          }),
        ]),
      );
    render(<RatingDashboard userId={owner} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Retry same rating' }));
    await screen.findByRole('alert');
    expect(JSON.parse(storage.get(journal())!)).toEqual(pending());
    expect(rateCourse).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Check saved rating' }));
    await waitFor(() => expect(storage.has(journal())).toBe(false));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save rating' })).toBeEnabled());
    expect(screen.getByRole('combobox', { name: /^Course$/ })).toBeEnabled();
    expect(screen.getByRole('combobox', { name: 'Your difficulty rating' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Clear pending retry' })).not.toBeInTheDocument();
    expect(rateCourse).not.toHaveBeenCalled();
    expect(getScopedOwnRatings).toHaveBeenCalledWith(owner);
  });

  it('does not clear a journal if explicit local removal is denied', async () => {
    storage.set(journal(), '{bad');
    vi.mocked(sessionStorage.removeItem).mockImplementation(() => {
      throw new Error('Storage denied');
    });
    render(<RatingDashboard userId={owner} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Clear pending retry' }));
    expect(storage.get(journal())).toBe('{bad');
    expect(rateCourse).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Clear pending retry' })).toBeInTheDocument();
  });

  it('ignores stale A to B to A choice loads without deleting the original journal', async () => {
    storage.set(journal(), JSON.stringify(pending()));
    const old = deferred<RatingCourseChoicesDTO>();
    vi.mocked(getRatingCourseChoices).mockReturnValueOnce(old.promise);
    const { rerender } = render(<RatingDashboard userId={owner} />);
    rerender(<RatingDashboard userId={another} />);
    await screen.findByRole('button', { name: 'Save rating' });
    rerender(<RatingDashboard userId={owner} />);
    await screen.findByRole('button', { name: 'Retry same rating' });
    await act(async () => old.resolve(choices([choice()], scope(owner, changedContext))));
    expect(screen.getByRole('button', { name: 'Retry same rating' })).toBeInTheDocument();
    expect(JSON.parse(storage.get(journal())!)).toEqual(pending());
    expect(rateCourse).not.toHaveBeenCalled();
  });

  it('ignores stale A to B to A confirmed saves without deleting the original journal', async () => {
    const confirmation = deferred<ScopedOwnCourseRatingsDTO>();
    vi.mocked(getScopedOwnRatings).mockReturnValueOnce(confirmation.promise);
    const { rerender } = render(<RatingDashboard userId={owner} />);
    await selectCourse();
    save();
    await waitFor(() => expect(getScopedOwnRatings).toHaveBeenCalledTimes(1));
    rerender(<RatingDashboard userId={another} />);
    await screen.findByRole('button', { name: 'Save rating' });
    rerender(<RatingDashboard userId={owner} />);
    await screen.findByRole('button', { name: 'Retry same rating' });
    await act(async () => confirmation.resolve(ownVotes(4)));
    expect(screen.getByRole('button', { name: 'Retry same rating' })).toBeInTheDocument();
    expect(JSON.parse(storage.get(journal())!)).toEqual(pending());
    expect(rateCourse).toHaveBeenCalledTimes(1);
  });
});
