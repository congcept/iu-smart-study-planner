import React, { useState, useCallback } from 'react';
import type { Course } from '@/types';
import { categoryColors } from '@lib/utils';

interface CourseCardProps {
  course: Course;
  isCompleted: boolean;
  isPlanned: boolean;
  isLocked: boolean;
  isRecommended: boolean;
  onToggleComplete: (courseId: string) => void;
  onTogglePlanned: (courseId: string) => void;
  onCompleteToPlanned: (courseId: string) => void;
}

export const CourseCard: React.FC<CourseCardProps> = ({
  course,
  isCompleted,
  isPlanned,
  isLocked,
  isRecommended,
  onToggleComplete,
  onTogglePlanned,
  onCompleteToPlanned,
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

  if (isCompleted) {
    borderColor = 'border-green-500';
    statusIcon = <span className="text-green-600 font-bold text-xs">DONE</span>;
  } else if (isPlanned) {
    borderColor = 'border-blue-500 ring-1 ring-blue-200';
    statusIcon = <span className="text-blue-600 font-bold text-xs">PLANNED</span>;
  } else if (isRecommended) {
    borderColor = 'border-amber-500 ring-2 ring-amber-200';
    statusIcon = <span className="text-amber-600 font-bold text-xs">RECOMMENDED</span>;
  } else if (isLocked) {
    borderColor = 'border-gray-200';
    opacity = 'opacity-50';
    statusIcon = <span className="text-gray-400 font-bold text-xs">LOCKED</span>;
  }

  if (hovered && !isLocked) {
    borderColor = isCompleted ? 'border-green-600' : 'border-blue-500';
  }

  return (
    <div
      onClick={handleClick}
      onContextMenu={handleContextMenu}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className={`
        bg-white rounded-md shadow-sm border-2 p-1.5
        transition-all duration-150 hover:shadow-md
        ${borderColor} ${opacity}
        ${!isLocked ? 'cursor-pointer hover:scale-[1.02]' : 'cursor-not-allowed'}
      `}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] font-bold text-gray-700">{course.code}</span>
          <span className={`w-1.5 h-1.5 rounded-full ${categoryColor}`} />
          <span className="text-[10px] text-gray-500">{course.credits} cr</span>
        </div>
        {statusIcon}
      </div>

      <h4 className="font-medium text-[10px] text-gray-900 leading-tight line-clamp-2">
        {course.name}
      </h4>

      {course.prerequisites.length > 0 && hovered && (
        <div className="mt-1 bg-gray-50 rounded px-1.5 py-1 space-y-0.5">
          <p className="text-[10px] text-gray-600 font-medium">Requires:</p>
          {course.prerequisites.map((prereq) => (
            <span key={prereq.id} className="block text-[10px] text-gray-500">
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
