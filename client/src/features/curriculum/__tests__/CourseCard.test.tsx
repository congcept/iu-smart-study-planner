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
  return {
    ...callbacks,
    button: screen.getByRole('button', { name: /: (Mark (in)?complete|Show prerequisites)$/ }),
  };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('compact course node controls', () => {
  it.each([
    { state: 'available', props: {}, status: 'Available', action: 'Mark complete' },
    {
      state: 'completed',
      props: { isCompleted: true },
      status: 'Done',
      action: 'Mark incomplete',
    },
    {
      state: 'planned',
      props: { isPlanned: true },
      status: 'Planned',
      action: 'Mark complete',
    },
    {
      state: 'recommended',
      props: { isRecommended: true },
      status: 'Next',
      action: 'Mark complete',
    },
    {
      state: 'locked',
      props: { isLocked: true },
      status: 'Locked · prerequisites',
      action: 'Show prerequisites',
    },
    {
      state: 'planned and locked',
      props: { isPlanned: true, isLocked: true },
      status: 'Planned · prerequisites',
      action: 'Show prerequisites',
    },
    {
      state: 'recommended and locked',
      props: { isRecommended: true, isLocked: true },
      status: 'Next · prerequisites',
      action: 'Show prerequisites',
    },
  ])(
    'includes visible credits and status in the accessible name for $state',
    ({ props, status, action }) => {
      const { button } = showCard({ ...props, course: { ...course, category: 'MAJOR_ELECTIVE' } });
      expect(button).toHaveTextContent(`IT002IU 4 cr Data Structures ${status}`);
      expect(button).toHaveAccessibleName(`IT002IU 4 cr Data Structures ${status}: ${action}`);
    },
  );

  it('includes the visible Unplan label in the planning control accessible name', () => {
    showCard({ isPlanned: true });
    const button = screen.getByRole('button', { name: /: Remove from plan$/ });
    expect(button).toHaveTextContent('Unplan');
    expect(button).toHaveAccessibleName(/^Unplan IT002IU Data Structures: Remove from plan$/);
  });

  it.each([
    {
      state: 'available',
      isCompleted: false,
      isPlanned: false,
      isLocked: false,
      action: 'Add to plan',
    },
    {
      state: 'planned',
      isCompleted: false,
      isPlanned: true,
      isLocked: false,
      action: 'Remove from plan',
    },
    {
      state: 'completed',
      isCompleted: true,
      isPlanned: false,
      isLocked: false,
      action: 'Move to plan',
    },
    {
      state: 'locked',
      isCompleted: false,
      isPlanned: false,
      isLocked: true,
      action: 'Add to plan',
    },
  ])(
    'offers a focusable touch-sized plan control for a $state course, preserving right-click',
    (props) => {
      const { button, onToggleComplete, onTogglePlanned, onCompleteToPlanned } = showCard(props);
      const planButton = screen.getByRole('button', {
        name: new RegExp(`IT002IU Data Structures: ${props.action}$`),
      });
      expect(planButton).toBeVisible();
      expect(planButton).toHaveTextContent(props.isPlanned ? 'Unplan' : 'Plan');
      expect(planButton).toHaveClass('min-h-11');
      expect(planButton).toHaveAttribute('type', 'button');
      expect(planButton.tabIndex).toBe(0);
      planButton.focus();
      expect(planButton).toHaveFocus();
      expect(planButton).toHaveAttribute('aria-pressed', String(props.isPlanned));

      fireEvent.click(planButton);
      const action = props.isCompleted ? onCompleteToPlanned : onTogglePlanned;
      expect(action).toHaveBeenCalledExactlyOnceWith(course.id);
      // Context menus bubble from either control to the same desktop fast path.
      fireEvent.contextMenu(planButton);
      fireEvent.contextMenu(button);
      expect(action).toHaveBeenCalledTimes(3);
      expect(action.mock.calls).toEqual([[course.id], [course.id], [course.id]]);
      expect(props.isCompleted ? onTogglePlanned : onCompleteToPlanned).not.toHaveBeenCalled();
      expect(onToggleComplete).not.toHaveBeenCalled();
      expect(playLockedSound).not.toHaveBeenCalled();
    },
  );

  it.each(['completion', 'planning'])(
    'highlights prerequisites when the %s control receives focus',
    (control) => {
      const onPrereqsHover = vi.fn();
      const onPrereqsLeave = vi.fn();
      const { button } = showCard({ isLocked: true, onPrereqsHover, onPrereqsLeave });
      const target =
        control === 'completion' ? button : screen.getByRole('button', { name: /: Add to plan$/ });
      target.focus();
      expect(onPrereqsHover).toHaveBeenCalledExactlyOnceWith(['IT001IU']);
      expect(onPrereqsLeave).not.toHaveBeenCalled();
      target.blur();
      expect(onPrereqsLeave).toHaveBeenCalledOnce();
    },
  );

  it.each(['hover', 'focus'])(
    'does not double-fire highlights when %s precedes the other interaction',
    (first) => {
      const onPrereqsHover = vi.fn();
      const onPrereqsLeave = vi.fn();
      const { button } = showCard({ isLocked: true, onPrereqsHover, onPrereqsLeave });
      const planButton = screen.getByRole('button', { name: /: Add to plan$/ });
      if (first === 'hover') {
        fireEvent.mouseEnter(button);
        button.focus();
      } else {
        button.focus();
        fireEvent.mouseEnter(button);
      }
      planButton.focus();
      expect(onPrereqsHover).toHaveBeenCalledExactlyOnceWith(['IT001IU']);
      expect(onPrereqsLeave).not.toHaveBeenCalled();

      if (first === 'hover') fireEvent.mouseLeave(planButton);
      else planButton.blur();
      expect(onPrereqsLeave).not.toHaveBeenCalled();
      if (first === 'hover') planButton.blur();
      else fireEvent.mouseLeave(planButton);
      expect(onPrereqsLeave).toHaveBeenCalledOnce();
      expect(onPrereqsHover).toHaveBeenCalledOnce();
    },
  );

  it.each(['progress', 'pending', 'gpa-path'] as const)(
    'disables both controls and explains why when disabledReason=%s',
    (disabledReason) => {
      const { button, onToggleComplete, onTogglePlanned, onCompleteToPlanned } = showCard({
        disabledReason,
      });
      const planButton = screen.getByRole('button', { name: /: Add to plan$/ });
      for (const control of [button, planButton]) {
        expect(control).toBeDisabled();
        expect(control).toHaveClass('min-h-11');
        expect(control).toHaveClass(
          disabledReason === 'pending' ? 'disabled:cursor-wait' : 'disabled:cursor-not-allowed',
        );
        expect(control).toHaveAccessibleDescription(/Saving another course|Editing is paused/);
        fireEvent.click(control);
        fireEvent.contextMenu(control);
        fireEvent.keyDown(control, { key: 'F10', shiftKey: true });
        fireEvent.keyDown(control, { key: 'ContextMenu' });
      }
      expect(planButton).toHaveAttribute(
        'aria-describedby',
        button.getAttribute('aria-describedby'),
      );
      expect(onToggleComplete).not.toHaveBeenCalled();
      expect(onTogglePlanned).not.toHaveBeenCalled();
      expect(onCompleteToPlanned).not.toHaveBeenCalled();
    },
  );

  it.each([false, true])('allows the completion button to toggle completed=%s', (isCompleted) => {
    const { button, onToggleComplete, onTogglePlanned } = showCard({ isCompleted });
    expect(button).toHaveAccessibleName(
      new RegExp(`^IT002IU .*: Mark ${isCompleted ? 'incomplete' : 'complete'}$`),
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
      disabledReason: 'pending',
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

  it('only presents a busy cursor while a save is actually in flight', () => {
    const pending = showCard({ disabledReason: 'pending' });
    expect(pending.button).toHaveClass('disabled:cursor-wait');
    expect(screen.getByText(/Saving another course right now/)).toBeVisible();

    cleanup();
    const paused = showCard({ disabledReason: 'gpa-path' });
    expect(paused.button).toHaveClass('disabled:cursor-not-allowed');
    expect(paused.button).not.toHaveClass('disabled:cursor-wait');
    expect(screen.getByText(/paused until your GPA path is confirmed/)).toBeVisible();
  });

  it('points the disabled button at its explanation for assistive technology', () => {
    const { button } = showCard({ disabledReason: 'progress' });
    const describedBy = button.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy!)).toHaveTextContent(
      'Editing is paused until your saved progress finishes loading.',
    );
  });

  it('opens prerequisites instead of completing a locked course and allows closing them', () => {
    const { button, onToggleComplete } = showCard({ isLocked: true });
    expect(button).toHaveAccessibleName(/^IT002IU .*: Show prerequisites$/);
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
