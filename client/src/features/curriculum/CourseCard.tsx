import React, { useCallback, useState } from 'react';
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
  const [showPrerequisites, setShowPrerequisites] = useState(false);

  const handleClick = useCallback(() => {
    if (disabled) return;
    if (isLocked) {
      playLockedSound();
      setShowPrerequisites((open) => !open);
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
        bg-white rounded-md border-2 px-2 py-1.5 transition-colors
        ${isHighlighted ? 'ring-2 ring-violet-500' : ''}
        ${isBlurred ? 'opacity-40' : ''}
        ${borderColor}
      `}
    >
      <div className="flex items-start gap-1">
        <button
          type="button"
          disabled={disabled}
          onClick={handleClick}
          aria-label={`${course.code} ${course.name}: ${isLocked ? 'Show prerequisites' : isCompleted ? 'Mark incomplete' : 'Mark complete'}`}
          aria-pressed={isLocked ? undefined : isCompleted}
          aria-expanded={isLocked ? showPrerequisites : undefined}
          className="min-h-11 min-w-0 flex-1 rounded text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-700"
        >
          <span className="flex items-center justify-between gap-1 text-[11px] leading-tight">
            <span className="flex min-w-0 items-center gap-1 font-semibold text-gray-700">
              {(course.category === 'ELECTIVE' || course.category === 'FREE_ELECTIVE' || course.category === 'MAJOR_ELECTIVE') && (
                <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
              )}
              <span className="truncate">{course.code}</span>
            </span>
            <span className="shrink-0 text-gray-600">{course.credits} cr</span>
          </span>
          <span className="mt-0.5 block break-words text-xs font-medium leading-snug text-gray-900">
            {course.name}
          </span>
          <span className={`mt-0.5 block text-[11px] font-semibold leading-tight ${
            isCompleted ? 'text-green-700' : isPlanned ? 'text-blue-700' : isRecommended ? 'text-amber-700' : 'text-gray-700'
          }`}>{status}{isLocked ? ' · prerequisites' : ''}</span>
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={handlePlan}
          aria-label={`${planLabel}: ${course.code} ${course.name}`}
          title={`${planLabel}: ${course.code} ${course.name}`}
          className="min-h-11 w-11 shrink-0 rounded border border-gray-200 bg-gray-50 text-[11px] font-semibold text-primary-700 hover:bg-primary-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-700 disabled:opacity-50"
        >
          {isPlanned ? 'Undo' : 'Plan'}
        </button>
      </div>

      {isLocked && showPrerequisites && (
        <div className="mt-1.5 border-t border-gray-200 pt-1.5 text-xs text-gray-700">
          <p className="font-semibold">Requires</p>
          <ul className="mt-1 space-y-1">
            {course.prerequisites.map((prereq) => (
              <li key={prereq.id}>
                {prereq.prerequisite
                  ? `${prereq.prerequisite.code} - ${prereq.prerequisite.name}`
                  : prereq.prerequisiteId}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};
