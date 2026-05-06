import React, { useState, useCallback } from 'react';
import type { Course } from '@/types';
import { categoryColors } from '@lib/utils';

interface CourseCardProps {
  course: Course;
  isCompleted: boolean;
  isPlanned: boolean;
  isLocked: boolean;
  isRecommended: boolean;
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
  isHighlighted = false,
  isBlurred = false,
  onToggleComplete,
  onTogglePlanned,
  onCompleteToPlanned,
  onPrereqsHover,
  onPrereqsLeave,
}) => {
  const [hovered, setHovered] = useState(false);

  const handleClick = useCallback(() => {
    if (!isLocked) {
      onToggleComplete(course.id);
    }
  }, [course.id, isLocked, onToggleComplete]);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    if (isCompleted) {
      onCompleteToPlanned(course.id);
    } else {
      onTogglePlanned(course.id);
    }
  }, [course.id, isCompleted, onTogglePlanned, onCompleteToPlanned]);

  const categoryColor = categoryColors[course.category] || 'bg-gray-500';

  let borderColor = 'border-gray-300';
  let opacity = 'opacity-100';
  let statusIcon = null;
  let highlightRing = '';

  if (isCompleted) {
    borderColor = 'border-green-500';
    statusIcon = <span className="text-green-600 font-bold text-[11px]">DONE</span>;
  } else if (isPlanned) {
    borderColor = 'border-blue-500 ring-1 ring-blue-200';
    statusIcon = <span className="text-blue-600 font-bold text-[11px]">PLANNED</span>;
  } else if (isRecommended) {
    borderColor = 'border-amber-500 ring-2 ring-amber-200';
    statusIcon = <span className="text-amber-600 font-bold text-[11px]">NEXT</span>;
  } else if (isLocked) {
    borderColor = 'border-gray-200';
    opacity = 'opacity-50';
    statusIcon = <span className="text-gray-400 font-bold text-[11px]">LOCKED</span>;
  }

  if (isHighlighted) {
    highlightRing = 'ring-2 ring-violet-500 bg-violet-50 scale-[1.02] shadow-md';
  }

  if (isBlurred) {
    opacity = 'opacity-25 blur-[1px]';
  } else if (hovered && !isLocked) {
    borderColor = isCompleted ? 'border-green-600' : 'border-blue-500';
  }

  return (
    <div
      onClick={handleClick}
      onContextMenu={handleContextMenu}
      onMouseEnter={() => {
        setHovered(true);
        if (isLocked && onPrereqsHover) {
          onPrereqsHover(course.prerequisites.map((p) => p.prerequisiteId));
        }
      }}
      onMouseLeave={() => {
        setHovered(false);
        if (onPrereqsLeave) {
          onPrereqsLeave();
        }
      }}
      className={`
        bg-white rounded-md shadow-sm border-2 p-2
        transition-all duration-150 hover:shadow-md
        ${borderColor} ${opacity} ${highlightRing}
        ${!isLocked ? 'cursor-pointer hover:scale-[1.02]' : 'cursor-not-allowed'}
      `}
    >
      <div className="flex items-center justify-between gap-1.5">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-[11px] font-bold text-gray-700 truncate">{course.code}</span>
          <span className={`w-2 h-2 rounded-full shrink-0 ${categoryColor}`} />
          <span className="text-[11px] text-gray-500 shrink-0">{course.credits} cr</span>
        </div>
        {statusIcon}
      </div>

      <h4 className="font-medium text-[11px] text-gray-900 leading-snug break-words">
        {course.name}
      </h4>

      {course.prerequisites.length > 0 && hovered && isLocked && (
        <div className="mt-1.5 bg-gray-50 rounded px-2 py-1.5 space-y-0.5">
          <p className="text-[11px] text-gray-600 font-medium">Requires:</p>
          {course.prerequisites.map((prereq) => (
            <span key={prereq.id} className="block text-[11px] text-gray-500">
              {prereq.prerequisite
                ? `${prereq.prerequisite.code} - ${prereq.prerequisite.name}`
                : prereq.prerequisiteId}
            </span>
          ))}
        </div>
      )}
    </div>
  );
};
