import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getCurriculum } from '@/lib/api';
import { useAppStore } from '@/lib/store';
import type { Course, YearSemesterGroup } from '@/types';
import { CurriculumProgressMap } from '../CurriculumProgressMap';

vi.mock('@/lib/api', () => ({
  getCurriculum: vi.fn(),
  getCurrentStudentProgress: vi.fn(),
  saveCourseProgress: vi.fn(),
}));
vi.mock('@/lib/sounds', () => ({
  playToggleSound: vi.fn(),
  playRecommendationsSound: vi.fn(),
}));
vi.mock('../CourseCard', () => ({
  CourseCard: ({ course, isRecommended }: { course: Course; isRecommended: boolean }) => (
    <div data-testid={course.id} data-recommended={isRecommended}>
      {course.name}
    </div>
  ),
}));

function course(code: string, credits: number, id = code): Course {
  return {
    id,
    code,
    name: `Course ${id}`,
    credits,
    difficultyLevel: 2,
    category: 'REQUIRED',
    semesterOffered: ['SPRING'],
    prerequisites: [],
    isPrerequisiteFor: [],
    createdAt: '',
    updatedAt: '',
  };
}

async function showCurriculum(groups: YearSemesterGroup[]) {
  vi.mocked(getCurriculum).mockResolvedValue({ success: true, data: groups });
  render(<CurriculumProgressMap />);
  await screen.findByRole('button', { name: /GPA > 70/ });
}

beforeEach(() => {
  useAppStore.setState({
    completedIds: {},
    plannedIds: [],
    progressOwnerId: null,
    progressStatus: 'ready',
    progressError: null,
    browserProgressBackup: null,
    pendingCompletionIds: new Set(),
  });
  vi.stubGlobal(
    'requestAnimationFrame',
    vi.fn(() => 0),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('GPA path recommendation credit budget', () => {
  it('excludes hidden Thesis before spending credits in the lower-GPA path', async () => {
    await showCurriculum([
      {
        year: 4,
        semester: 2,
        courses: [course('IT058IU', 6), course('IT060IU', 9), course('IT061IU', 6)],
      },
    ]);

    fireEvent.click(screen.getByRole('button', { name: /GPA <= 70/ }));

    await waitFor(() => {
      expect(screen.getByTestId('IT060IU')).toHaveAttribute('data-recommended', 'true');
      expect(screen.getByTestId('IT061IU')).toHaveAttribute('data-recommended', 'true');
    });
    expect(screen.queryByTestId('IT058IU')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /GPA > 70/ }));
    await waitFor(() => {
      expect(screen.getByTestId('IT058IU')).toHaveAttribute('data-recommended', 'true');
    });
    expect(screen.queryByTestId('IT060IU')).toBeNull();
    expect(screen.queryByTestId('IT061IU')).toBeNull();
  });

  it('excludes an earlier-sorted alternative before spending credits in the thesis path', async () => {
    await showCurriculum([
      {
        year: 4,
        semester: 2,
        courses: [course('IT001IU', 12), course('IT058IU', 6)],
      },
    ]);

    await waitFor(() => {
      expect(screen.getByTestId('IT058IU')).toHaveAttribute('data-recommended', 'true');
    });
    expect(screen.queryByTestId('IT001IU')).toBeNull();
  });

  it.each([
    [3, 2],
    [4, 1],
    [4, 3],
  ])(
    'keeps ordinary courses in year %i semester %i eligible in both GPA modes',
    async (year, semester) => {
      await showCurriculum([
        { year, semester, courses: [course('IT001IU', 6)] },
        {
          year: 4,
          semester: 2,
          courses: [course('IT058IU', 9), course('IT060IU', 9)],
        },
      ]);

      await waitFor(() => {
        expect(screen.getByTestId('IT001IU')).toHaveAttribute('data-recommended', 'true');
        expect(screen.getByTestId('IT058IU')).toHaveAttribute('data-recommended', 'true');
      });

      fireEvent.click(screen.getByRole('button', { name: /GPA <= 70/ }));
      await waitFor(() => {
        expect(screen.getByTestId('IT001IU')).toHaveAttribute('data-recommended', 'true');
        expect(screen.getByTestId('IT060IU')).toHaveAttribute('data-recommended', 'true');
      });
    },
  );

  it('does not exclude the Thesis code outside year 4 semester 2 in the lower-GPA path', async () => {
    await showCurriculum([
      { year: 3, semester: 2, courses: [course('IT058IU', 6, 'earlier-thesis')] },
      { year: 4, semester: 2, courses: [course('IT060IU', 9)] },
    ]);

    fireEvent.click(screen.getByRole('button', { name: /GPA <= 70/ }));
    await waitFor(() => {
      expect(screen.getByTestId('earlier-thesis')).toHaveAttribute('data-recommended', 'true');
      expect(screen.getByTestId('IT060IU')).toHaveAttribute('data-recommended', 'true');
    });
  });
});
