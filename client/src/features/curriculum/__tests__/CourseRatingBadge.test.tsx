import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CourseRatingBadge } from '../CourseRatingBadge';

describe('CourseRatingBadge', () => {
  it('explains an unrated shared estimate instead of claiming votes', () => {
    render(<CourseRatingBadge course={{ ratingDifficulty: 4.5, ratingCount: 0 }} />);
    expect(screen.getByText('Difficulty 4.5 / 5')).toBeInTheDocument();
    expect(screen.getByText('No ratings yet')).toBeInTheDocument();
    expect(screen.getByText(/Estimate uses the shared mean/)).toBeInTheDocument();
  });
  it.each([
    [1, '1 rating'],
    [50, '50 ratings'],
  ])('shows confidence count %s', (count, label) => {
    render(<CourseRatingBadge course={{ ratingDifficulty: 2.345, ratingCount: count }} />);
    expect(screen.getByText('Difficulty 2.3 / 5')).toBeInTheDocument();
    expect(screen.getByText(label)).toBeInTheDocument();
  });
  it.each([
    {},
    { ratingDifficulty: 3 },
    { ratingCount: 0 },
    { ratingDifficulty: NaN, ratingCount: 0 },
    { ratingDifficulty: 6, ratingCount: 0 },
    { ratingDifficulty: 3, ratingCount: -1 },
    { ratingDifficulty: 3, ratingCount: 1.5 },
  ])('does not fabricate metadata for an unsupported row', (course) => {
    const { container } = render(<CourseRatingBadge course={course} />);
    expect(container).toBeEmptyDOMElement();
  });
});
