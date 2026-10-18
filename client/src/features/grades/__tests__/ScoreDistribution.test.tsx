import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ScoreDistribution } from '../ScoreDistribution';

afterEach(cleanup);

function scores(values: number[]) {
  return values.map((score, i) => ({ courseId: `course-${i}`, score, credits: i + 1 }));
}

function count(label: string) {
  const row = screen.getByRole('rowheader', { name: label }).closest('tr');
  if (!row) throw new Error('Missing distribution row');
  return within(row).getByRole('cell').textContent;
}

describe('highest-score distribution', () => {
  it('places decimal boundaries and 100 into exactly one band, without credit weighting', () => {
    render(
      <ScoreDistribution
        courseScores={scores([0, 19.9999, 20, 39.9999, 40, 59.9999, 60, 79.9999, 80, 99.9999, 100])}
      />,
    );
    expect(count('0 to below 20')).toBe('2');
    expect(count('20 to below 40')).toBe('2');
    expect(count('40 to below 60')).toBe('2');
    expect(count('60 to below 80')).toBe('2');
    expect(count('80 to 100')).toBe('3');
    expect(screen.getByRole('table')).toHaveAccessibleName(
      'Courses included in GPA by highest numeric score range',
    );
    expect(
      screen.getByText(/Counts are by course, not by credits or attempts/),
    ).toBeInTheDocument();
  });

  it('shows an empty state without inventing zero-score courses or empty bars', () => {
    render(<ScoreDistribution courseScores={[]} />);
    expect(screen.getByText(/No GPA-eligible numeric scores to show yet/)).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('distinguishes one zero score from an empty distribution and shows zero-count ranges', () => {
    render(<ScoreDistribution courseScores={scores([0])} />);
    expect(count('0 to below 20')).toBe('1');
    expect(count('20 to below 40')).toBe('0');
    expect(count('40 to below 60')).toBe('0');
    expect(count('60 to below 80')).toBe('0');
    expect(count('80 to 100')).toBe('0');
    expect(screen.queryByText(/No GPA-eligible numeric scores/)).not.toBeInTheDocument();
  });

  it('updates from the supplied current summary instead of retaining a previous distribution', () => {
    const { rerender } = render(<ScoreDistribution courseScores={scores([10, 90])} />);
    expect(count('0 to below 20')).toBe('1');
    expect(count('80 to 100')).toBe('1');
    rerender(<ScoreDistribution courseScores={scores([60])} />);
    expect(count('0 to below 20')).toBe('0');
    expect(count('60 to below 80')).toBe('1');
    expect(count('80 to 100')).toBe('0');
  });
});
