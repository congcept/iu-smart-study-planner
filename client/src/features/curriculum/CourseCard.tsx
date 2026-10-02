import React, { useCallback } from 'react';
import type { Course } from '@/types';
import { playLockedSound } from '@/lib/sounds';

interface CourseCardProps {
  course: Course;
  isCompleted: boolean;
  isPlanned: boolean;
  isLocked: boolean;
  isRecommended: boolean;
  disabled?: boolean;
  isHighlighted?: boolean;
  isBlurred?: boolean;
  onToggleComplete: (courseId: string) => void;
  onTogglePlanned: (courseId: string) => void;
  onCompleteToPlanned: (courseId: string) => void;
  onPrereqsHover?: (prereqIds: string[]) => void;
  onPrereqsLeave?: () => void;
}

export const CourseCard: React.FC<CourseCardProps> = ({
  course,
  isCompleted,
  isPlanned,
  isLocked,
  isRecommended,
  disabled = false,
  isHighlighted = false,
  isBlurred = false,
  onToggleComplete,
  onTogglePlanned,
  onCompleteToPlanned,
  onPrereqsHover,
  onPrereqsLeave,
}) => {
  const handleClick = useCallback(() => {
    if (disabled) return;
    if (isLocked) {
      playLockedSound();
    } else {
      onToggleComplete(course.id);
    }
  }, [course.id, disabled, isLocked, onToggleComplete]);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    if (disabled) return;
    if (isCompleted) {
      onCompleteToPlanned(course.id);
    } else {
      onTogglePlanned(course.id);
    }
  }, [course.id, disabled, isCompleted, onTogglePlanned, onCompleteToPlanned]);

  let borderColor = 'border-gray-300';
  let status = 'Available';

  if (isCompleted) {
    borderColor = 'border-green-500';
    status = 'Done';
  } else if (isPlanned) {
    borderColor = 'border-blue-500 ring-1 ring-blue-200';
    status = 'Planned';
  } else if (isRecommended) {
    borderColor = 'border-amber-500 ring-2 ring-amber-200';
    status = 'Next';
  } else if (isLocked) {
    borderColor = 'border-gray-200';
    status = 'Locked';
  }

  const planLabel = isCompleted ? 'Move to plan' : isPlanned ? 'Remove plan' : 'Plan';
  const handlePlan = useCallback(() => {
    if (disabled) return;
    if (isCompleted) onCompleteToPlanned(course.id);
    else onTogglePlanned(course.id);
  }, [course.id, disabled, isCompleted, onCompleteToPlanned, onTogglePlanned]);

  return (
    <div
      onContextMenu={handleContextMenu}
      onMouseEnter={() => {
        if (isLocked && onPrereqsHover) {
          onPrereqsHover(course.prerequisites.map((p) => p.prerequisiteId));
        }
      }}
      onMouseLeave={() => {
        if (onPrereqsLeave) {
          onPrereqsLeave();
        }
      }}
      className={`
        bg-white rounded-md border p-2 space-y-1.5
        ${isHighlighted ? 'ring-2 ring-violet-500' : ''}
        ${isBlurred ? 'opacity-50' : ''}
        ${borderColor}
      `}
    >
      <button
        type="button"
        disabled={disabled}
        aria-disabled={isLocked || disabled}
        onClick={handleClick}
        aria-label={`${course.code} ${course.name}: ${isLocked ? 'Locked until prerequisites are complete' : isCompleted ? 'Mark incomplete' : 'Mark complete'}`}
        aria-pressed={isCompleted}
        className="block min-h-11 w-full rounded text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-700"
      >
        <div className="flex items-center justify-between gap-1.5">
          <span className="text-xs font-semibold text-gray-700">{course.code}</span>
          <span className="text-xs text-gray-600">{course.credits} cr</span>
        </div>
        <span className="block text-sm font-medium text-gray-900 leading-snug break-words">
          {course.name}
        </span>
        <span className={`block mt-1 text-xs font-semibold ${
          isCompleted ? 'text-green-700' : isPlanned ? 'text-blue-700' : isRecommended ? 'text-amber-700' : 'text-gray-700'
        }`}>{status}</span>
      </button>

      {course.prerequisites.length > 0 && isLocked && (
        <details className="text-xs text-gray-700">
          <summary className="min-h-11 cursor-pointer rounded py-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-700">Prerequisites</summary>
          <div className="mt-1 space-y-1">
          {course.prerequisites.map((prereq) => (
            <span key={prereq.id} className="block text-gray-700">
              {prereq.prerequisite
                ? `${prereq.prerequisite.code} - ${prereq.prerequisite.name}`
                : prereq.prerequisiteId}
            </span>
          ))}
          </div>
        </details>
      )}
      <button
        type="button"
        disabled={disabled}
        onClick={handlePlan}
        aria-label={`${planLabel}: ${course.code} ${course.name}`}
        className="min-h-11 w-full rounded border border-gray-200 px-2 text-xs font-medium text-primary-700 hover:bg-primary-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-700 disabled:opacity-50"
      >
        {planLabel}
      </button>
    </div>
  );
};
