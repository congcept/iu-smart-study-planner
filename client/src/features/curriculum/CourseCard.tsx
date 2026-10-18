import React, { useCallback, useId, useState } from 'react';
import type { Course } from '@/types';
import { playLockedSound } from '@/lib/sounds';
import { CourseRatingBadge } from './CourseRatingBadge';

interface CourseCardProps {
  course: Course;
  isCompleted: boolean;
  isPlanned: boolean;
  isLocked: boolean;
  isRecommended: boolean;
  /**
   * Why editing is unavailable. A card that is paused for an unrelated reason
   * must not present itself as busy, so the reason is explicit rather than a
   * bare boolean.
   */
  disabledReason?: 'progress' | 'pending' | 'gpa-path';
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
  disabledReason,
  isHighlighted = false,
  isBlurred = false,
  onToggleComplete,
  onTogglePlanned,
  onCompleteToPlanned,
  onPrereqsHover,
  onPrereqsLeave,
}) => {
  const [showPrerequisites, setShowPrerequisites] = useState(false);

  const disabled = disabledReason !== undefined;
  const disabledNoteId = useId();
  // Only a genuine in-flight save reads as busy. A card paused because progress
  // or the GPA path is unresolved is simply unavailable.
  const disabledNote =
    disabledReason === 'pending'
      ? 'Saving another course right now. Try again once the save finishes.'
      : disabledReason === 'progress'
        ? 'Editing is paused until your saved progress finishes loading.'
        : disabledReason === 'gpa-path'
          ? 'Editing is paused until your GPA path is confirmed.'
          : undefined;

  const handleClick = useCallback(() => {
    if (disabled) return;
    if (isLocked) {
      playLockedSound();
      setShowPrerequisites((open) => !open);
    } else {
      onToggleComplete(course.id);
    }
  }, [course.id, disabled, isLocked, onToggleComplete]);

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      if (disabled) return;
      if (isCompleted) {
        onCompleteToPlanned(course.id);
      } else {
        onTogglePlanned(course.id);
      }
    },
    [course.id, disabled, isCompleted, onTogglePlanned, onCompleteToPlanned],
  );

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
      <button
        type="button"
        disabled={disabled}
        onClick={handleClick}
        onKeyDown={(event) => {
          if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
            event.preventDefault();
            if (disabled || event.repeat) return;
            if (isCompleted) onCompleteToPlanned(course.id);
            else onTogglePlanned(course.id);
          }
        }}
        aria-label={`${course.code} ${course.name}: ${isLocked ? 'Show prerequisites' : isCompleted ? 'Mark incomplete' : 'Mark complete'}`}
        aria-pressed={isLocked ? undefined : isCompleted}
        aria-expanded={isLocked ? showPrerequisites : undefined}
        aria-describedby={disabledNote ? disabledNoteId : undefined}
        className={`min-h-11 w-full cursor-pointer rounded text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-700 ${
          disabledReason === 'pending' ? 'disabled:cursor-wait' : 'disabled:cursor-not-allowed'
        }`}
      >
        <span className="flex items-center justify-between gap-1 text-[11px] leading-tight">
          <span className="flex min-w-0 items-center gap-1 font-semibold text-gray-700">
            {(course.category === 'ELECTIVE' ||
              course.category === 'FREE_ELECTIVE' ||
              course.category === 'MAJOR_ELECTIVE') && (
              <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
            )}
            <span className="truncate">{course.code}</span>
          </span>
          <span className="shrink-0 text-gray-600">{course.credits} cr</span>
        </span>
        <span className="mt-0.5 block break-words text-xs font-medium leading-snug text-gray-900">
          {course.name}
        </span>
        <span
          className={`mt-0.5 block text-[11px] font-semibold leading-tight ${
            isCompleted
              ? 'text-green-700'
              : isPlanned
                ? 'text-blue-700'
                : isRecommended
                  ? 'text-amber-700'
                  : 'text-gray-700'
          }`}
        >
          {status}
          {isLocked ? ' · prerequisites' : ''}
        </span>
      </button>

      <CourseRatingBadge course={course} compact />

      {disabledNote && (
        <p id={disabledNoteId} className="mt-1 text-[11px] leading-tight text-gray-500">
          {disabledNote}
        </p>
      )}

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
