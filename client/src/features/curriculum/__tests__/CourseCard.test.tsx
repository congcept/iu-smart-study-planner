import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { playLockedSound } from '@/lib/sounds';
import type { Course } from '@/types';
import { CourseCard } from '../CourseCard';

vi.mock('@/lib/sounds', () => ({ playLockedSound: vi.fn() }));

const course: Course = {
  id: 'course-id',
  code: 'IT002IU',
  name: 'Data Structures',
  credits: 4,
  difficultyLevel: 2,
  category: 'REQUIRED',
  semesterOffered: ['FALL'],
  prerequisites: [
    {
      id: 'prerequisite-id',
      courseId: 'course-id',
      prerequisiteId: 'IT001IU',
      isStrict: true,
      isCorequisite: false,
    },
  ],
  isPrerequisiteFor: [],
  createdAt: '',
  updatedAt: '',
};

function showCard(overrides: Partial<ComponentProps<typeof CourseCard>> = {}) {
  const callbacks = {
    onToggleComplete: vi.fn(),
    onTogglePlanned: vi.fn(),
    onCompleteToPlanned: vi.fn(),
  };
  render(
    <CourseCard
      course={course}
      isCompleted={false}
      isPlanned={false}
      isLocked={false}
      isRecommended={false}
      {...callbacks}
      {...overrides}
    />,
  );
  return { ...callbacks, button: screen.getByRole('button') };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('compact course node controls', () => {
  it.each([false, true])('allows the completion button to toggle completed=%s', (isCompleted) => {
    const { button, onToggleComplete, onTogglePlanned } = showCard({ isCompleted });
    expect(button).toHaveAccessibleName(
      `IT002IU Data Structures: Mark ${isCompleted ? 'incomplete' : 'complete'}`,
    );
    expect(button).toHaveAttribute('aria-pressed', String(isCompleted));
    fireEvent.click(button);
    expect(onToggleComplete).toHaveBeenCalledExactlyOnceWith(course.id);
    expect(onTogglePlanned).not.toHaveBeenCalled();
  });

  it.each([false, true])('right-click plans or moves a completed=%s course', (isCompleted) => {
    const { button, onToggleComplete, onTogglePlanned, onCompleteToPlanned } = showCard({
      isCompleted,
    });
    fireEvent.contextMenu(button);
    expect(isCompleted ? onCompleteToPlanned : onTogglePlanned).toHaveBeenCalledExactlyOnceWith(
      course.id,
    );
    expect(isCompleted ? onTogglePlanned : onCompleteToPlanned).not.toHaveBeenCalled();
    expect(onToggleComplete).not.toHaveBeenCalled();
  });

  it.each([{ key: 'F10', shiftKey: true }, { key: 'ContextMenu' }])(
    'offers keyboard planning with $key',
    (shortcut) => {
      const { button, onTogglePlanned, onToggleComplete } = showCard({ isLocked: true });
      button.focus();
      fireEvent.keyDown(button, shortcut);
      expect(onTogglePlanned).toHaveBeenCalledExactlyOnceWith(course.id);
      expect(onToggleComplete).not.toHaveBeenCalled();
      expect(button).toHaveAttribute('aria-expanded', 'false');
    },
  );

  it('moves a completed course to planned with the keyboard shortcut', () => {
    const { button, onCompleteToPlanned, onTogglePlanned } = showCard({ isCompleted: true });
    fireEvent.keyDown(button, { key: 'F10', shiftKey: true });
    expect(onCompleteToPlanned).toHaveBeenCalledExactlyOnceWith(course.id);
    expect(onTogglePlanned).not.toHaveBeenCalled();
  });

  it('does not plan on an unmodified F10 key', () => {
    const { button, onTogglePlanned, onCompleteToPlanned } = showCard();
    fireEvent.keyDown(button, { key: 'F10' });
    expect(onTogglePlanned).not.toHaveBeenCalled();
    expect(onCompleteToPlanned).not.toHaveBeenCalled();
  });

  it('blocks completion, right-click and keyboard planning while editing is disabled', () => {
    const { button, onToggleComplete, onTogglePlanned, onCompleteToPlanned } = showCard({
      disabled: true,
    });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    fireEvent.contextMenu(button);
    fireEvent.keyDown(button, { key: 'F10', shiftKey: true });
    fireEvent.keyDown(button, { key: 'ContextMenu' });
    expect(onToggleComplete).not.toHaveBeenCalled();
    expect(onTogglePlanned).not.toHaveBeenCalled();
    expect(onCompleteToPlanned).not.toHaveBeenCalled();
  });

  it('opens prerequisites instead of completing a locked course and allows closing them', () => {
    const { button, onToggleComplete } = showCard({ isLocked: true });
    expect(button).toHaveAccessibleName('IT002IU Data Structures: Show prerequisites');
    fireEvent.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('IT001IU')).toBeVisible();
    expect(playLockedSound).toHaveBeenCalledOnce();
    expect(onToggleComplete).not.toHaveBeenCalled();
    fireEvent.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('IT001IU')).not.toBeInTheDocument();
  });
});
