import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RatingCourseChoiceDTO, RatingCourseChoicesDTO } from '@iu-study-planner/shared';
import { getRatingCourseChoices, getScopedOwnRatings } from '@/lib/ratingsApi';
import { RatingDashboard } from '../RatingDashboard';

vi.mock('@/lib/ratingsApi', () => ({
  getRatingCourseChoices: vi.fn(),
  getScopedOwnRatings: vi.fn(),
  rateCourse: vi.fn(),
}));

const ownerId = '11111111-1111-4111-8111-111111111111';
const courseId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const course: RatingCourseChoiceDTO = {
  id: courseId,
  code: 'MA001IU',
  name: 'Calculus',
  avgRating: null,
  ratingCount: 0,
  ratingDifficulty: 3,
  ratingPriorMean: 3,
  ratingPriorSource: 'GLOBAL_SEED',
  yourRating: null,
  membership: 'UNASSIGNED',
};
const choices: RatingCourseChoicesDTO = {
  scope: { userId: ownerId, curriculumId: null },
  courses: [course],
};

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe('selected course rating group name', () => {
  it('exposes the selected course rating accessible name on a group', async () => {
    vi.mocked(getRatingCourseChoices).mockResolvedValue(choices);
    vi.mocked(getScopedOwnRatings).mockResolvedValue({
      scope: { userId: ownerId, curriculumId: null },
      ratings: [],
    });

    render(<RatingDashboard userId={ownerId} />);
    const courseSelect = await screen.findByRole('combobox', { name: /^Course$/ });
    fireEvent.change(courseSelect, { target: { value: courseId } });

    expect(screen.getByRole('group', { name: 'Selected course rating' })).toBeInTheDocument();
  });
});
