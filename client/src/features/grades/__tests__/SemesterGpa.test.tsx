import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { SemesterGpa } from '../SemesterGpa';

const terms = [
  { year: 2025, semester: 'FALL' as const, gpa100: 87.5, gradedCredits: 7, gradedCourseCount: 2 },
  { year: 2026, semester: 'SPRING' as const, gpa100: 95, gradedCredits: 3, gradedCourseCount: 1 },
];

afterEach(cleanup);

describe('recorded semester GPA section', () => {
  it('marks a legacy snapshot without term evidence as unavailable, not empty or zero', () => {
    render(<SemesterGpa />);
    expect(screen.getByRole('heading', { name: 'Recorded semester GPA' })).toBeInTheDocument();
    expect(screen.getByText(/unavailable in this saved grade snapshot/)).toBeInTheDocument();
    expect(screen.queryByText('Recorded terms')).not.toBeInTheDocument();
    expect(screen.queryByText('0.00')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('region', { name: 'Recorded semester GPA table' }),
    ).not.toBeInTheDocument();
  });

  it('distinguishes an empty recorded-term list from unavailable term evidence', () => {
    render(<SemesterGpa semesterGrades={{ terms: [], undatedAttemptCount: 0 }} />);
    expect(screen.queryByText(/unavailable/)).not.toBeInTheDocument();
    expect(screen.getByText('Recorded terms')).toBeInTheDocument();
    expect(screen.getByText(/No terms recorded yet/)).toBeInTheDocument();
    expect(screen.queryByText(/without a term/i)).not.toBeInTheDocument();
  });

  it('renders terms in server order with formatted GPA, credits and course counts', () => {
    render(<SemesterGpa semesterGrades={{ terms, undatedAttemptCount: 0 }} />);
    const region = screen.getByRole('region', { name: 'Recorded semester GPA table' });
    const rows = within(region).getAllByRole('row');
    expect(rows).toHaveLength(terms.length + 1);
    const first = within(rows[1])
      .getAllByRole('cell')
      .map((cell) => cell.textContent);
    expect(within(rows[1]).getByRole('rowheader')).toHaveTextContent('FALL 2025');
    expect(first).toEqual(['87.50', '7', '2']);
    const second = within(rows[2])
      .getAllByRole('cell')
      .map((cell) => cell.textContent);
    expect(within(rows[2]).getByRole('rowheader')).toHaveTextContent('SPRING 2026');
    expect(second).toEqual(['95.00', '3', '1']);
    expect(screen.getByText('Recorded terms').closest('div')!).toHaveTextContent('2');
  });

  it('renders a real zero term GPA as 0.00 and rounds fractional scores to two decimals', () => {
    render(
      <SemesterGpa
        semesterGrades={{
          terms: [
            { year: 2024, semester: 'FALL', gpa100: 0, gradedCredits: 4, gradedCourseCount: 1 },
            {
              year: 2025,
              semester: 'SUMMER',
              gpa100: 87.33333333333333,
              gradedCredits: 6,
              gradedCourseCount: 2,
            },
          ],
          undatedAttemptCount: 0,
        }}
      />,
    );
    expect(screen.getByText('0.00')).toBeInTheDocument();
    expect(screen.getByText('87.33')).toBeInTheDocument();
  });

  it('counts scored attempts without a term and explains that they never join a term', () => {
    render(<SemesterGpa semesterGrades={{ terms: [terms[0]], undatedAttemptCount: 3 }} />);
    const label = screen.getByText('Scored attempts without a term');
    expect(label.closest('div')!).toHaveTextContent('3');
    expect(screen.getByText(/never assigned to a term/)).toBeInTheDocument();
    expect(screen.getByText(/still count toward the GPA above/)).toBeInTheDocument();
  });

  it('explains the per-term highest-score rule and the cumulative distinction', () => {
    render(<SemesterGpa semesterGrades={{ terms, undatedAttemptCount: 0 }} />);
    expect(screen.getByText(/its own highest recorded score/)).toBeInTheDocument();
    expect(screen.getByText(/combines all of your terms/)).toBeInTheDocument();
    expect(screen.getByText(/not from an official academic calendar/)).toBeInTheDocument();
  });

  it('keeps the term table keyboard-scrollable on narrow screens', () => {
    render(<SemesterGpa semesterGrades={{ terms, undatedAttemptCount: 0 }} />);
    const region = screen.getByRole('region', { name: 'Recorded semester GPA table' });
    expect(region).toHaveAttribute('tabindex', '0');
    expect(within(region).getByRole('table')).toHaveClass('min-w-[560px]');
  });
});
