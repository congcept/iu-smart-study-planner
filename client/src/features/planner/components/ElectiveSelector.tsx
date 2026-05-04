import React, { useState } from 'react';
import type { Course } from '@/types';
import { Badge, Button, Card, Checkbox } from '@components/ui';
import { CheckPlus, List, Zap } from 'lucide-react';

interface ElectiveGroup {
  name: string;
  selectCount: number;
  courses: Course[];
}

interface ElectiveSelectorProps {
  electiveGroups: ElectiveGroup[];
  onCourseSelect: (course: Course) => void;
  onCourseDeselect: (course: Course) => void;
  selectedCourses: Course[];
}

export const ElectiveSelector: React.FC<ElectiveSelectorProps> = ({ 
  electiveGroups, 
  onCourseSelect, 
  onCourseDeselect,
  selectedCourses
}) => {
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  const toggleGroup = (groupName: string) => {
    setExpandedGroups(prev => {
      const newSet = new Set(prev);
      if (newSet.has(groupName)) {
        newSet.delete(groupName);
      } else {
        newSet.add(groupName);
      }
      return newSet;
    });
  };

  const isGroupExpanded = (groupName: string) => expandedGroups.has(groupName);

  const isCourseSelected = (course: Course) => 
    selectedCourses.some(selected => selected.id === course.id);

  return (
    <Card title="Elective Course Selection" subtitle="Choose courses from elective groups">
      {electiveGroups.length === 0 ? (
        <div className="text-center py-8 text-gray-500">
          <List size={32} className="mx-auto mb-4 opacity-50" />
          <p>No elective groups available</p>
        </div>
      ) : (
        <div className="space-y-4">
          {electiveGroups.map((group, index) => (
            <div key={index} className="border rounded-lg overflow-hidden">
              <div className="flex items-center justify-between p-4 bg-gray-50 cursor-pointer" onClick={() => toggleGroup(group.name)}>
                <div className="flex items-center gap-3">
                  <Zap size={20} className="text-primary-500" />
                  <div>
                    <h4 className="font-medium text-gray-900">{group.name}</h4>
                    <p className="text-sm text-gray-500">
                      Select {group.selectCount} {group.selectCount === 1 ? 'course' : 'courses'}
                    </p>
                  </div>
                </div>
                <div className="text-sm text-gray-500">
                  {isCourseSelected(group.courses.filter(c => isCourseSelected(c)).length) > 0 
                    ? `${group.courses.filter(c => isCourseSelected(c)).length}/${group.selectCount} selected`
                    : '0/' + group.selectCount + ' selected'}
                </div>
                <ChevronDown size={16} className={`transition-transform duration-200 ${isGroupExpanded(group.name) ? 'rotate-180' : ''}`} />
              </div>
              
              {isGroupExpanded(group.name) && (
                <div className="divide-y divide-gray-100">
                  {group.courses.map((course, courseIndex) => (
                    <div key={course.id} className="flex items-start p-4 hover:bg-gray-50">
                      <Checkbox 
                        checked={isCourseSelected(course)} 
                        onCheckedChange={() => {
                          if (isCourseSelected(course)) {
                            onCourseDeselect(course);
                          } else {
                            onCourseSelect(course);
                          }
                        }}
                        className="h-4 w-4 flex-shrink-0 mt-1"
                      />
                      <div className="flex-1 ml-3 space-y-1">
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <span className="font-bold text-gray-900">{course.code}</span>
                            <Badge variant={course.category === 'REQUIRED' ? 'info' : 'default'}>
                              {course.category}
                            </Badge>
                          </div>
                          <div className="text-xs text-gray-500">
                            {course.credits} cr
                          </div>
                        </div>
                        <p className="text-sm text-gray-600">{course.name}</p>
                        {course.prerequisites.length > 0 && (
                          <div className="text-xs text-gray-500">
                            Prerequisites: {course.prerequisites.length}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                  
                  {/* Group selection summary */}
                  <div className="p-4 pt-2 bg-gray-50">
                    <div className="flex items-center justify-between text-sm font-medium">
                      <span>Selected:</span>
                      <span className={`${isCourseSelected(group.courses.filter(c => isCourseSelected(c)).length) >= group.selectCount ? 'text-green-600' : 'text-red-600'}`}>
                        {group.courses.filter(c => isCourseSelected(c)).length}/{group.selectCount}
                      </span>
                    </div>
                    {isCourseSelected(group.courses.filter(c => isCourseSelected(c)).length) >= group.selectCount && (
                      <div className="mt-2 text-xs text-green-600">
                        Requirement met! You can select additional courses if desired.
                      </div>
                    )}
                    {isCourseSelected(group.courses.filter(c => isCourseSelected(c)).length) < group.selectCount && (
                      <div className="mt-2 text-xs text-red-600">
                        Please select {group.selectCount - group.courses.filter(c => isCourseSelected(c)).length} more course(s)
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
};

// Helper component for chevron down icon
const ChevronDown: React.FC<{size?: number; className?: string}> = ({ size = 16, className = '' }) => (
  <svg 
    width={size} 
    height={size} 
    viewBox="0 0 24 24" 
    fill="none" 
    xmlns="http://www.w3.org/2000/svg"
    className={className}
  >
    <path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>
);