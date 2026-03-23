import React, { useCallback, useMemo } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  Node,
  Edge,
  Panel,
  NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { Course, CourseNodeData } from '@/types';
import { categoryColors, difficultyColors, difficultyLabels } from '@lib/utils';
import { CheckCircle2, Circle, Lock, BookOpen } from 'lucide-react';

interface CurriculumGraphProps {
  courses: Course[];
  completedCourseIds: string[];
  inProgressCourseIds?: string[];
  onCourseClick?: (course: Course) => void;
  height?: string;
}

const CourseNode: React.FC<NodeProps<Node<CourseNodeData>>> = ({ data }) => {
  const { course, isCompleted, isInProgress, isAvailable, onClick } = data;

  const getStatusIcon = () => {
    if (isCompleted) return <CheckCircle2 size={16} className="text-green-500" />;
    if (isInProgress) return <Circle size={16} className="text-blue-500 fill-blue-500" />;
    if (isAvailable) return <BookOpen size={16} className="text-primary-500" />;
    return <Lock size={16} className="text-gray-400" />;
  };

  const getStatusBorder = () => {
    if (isCompleted) return 'border-green-500 ring-2 ring-green-200';
    if (isInProgress) return 'border-blue-500 ring-2 ring-blue-200';
    if (isAvailable) return 'border-primary-500';
    return 'border-gray-300 opacity-60';
  };

  const categoryColor = categoryColors[course.category] || 'bg-gray-500';

  return (
    <div
      onClick={() => onClick?.(course)}
      className={`
        bg-white rounded-lg shadow-md border-2 p-3 w-48 cursor-pointer
        transition-all duration-200 hover:shadow-lg hover:scale-105
        ${getStatusBorder()}
      `}
    >
      <div className="flex items-start justify-between mb-2">
        <span className="text-xs font-bold text-gray-600">{course.code}</span>
        {getStatusIcon()}
      </div>

      <h4 className="font-semibold text-sm text-gray-900 mb-1 line-clamp-2">
        {course.name}
      </h4>

      <div className="flex items-center gap-2 text-xs">
        <span className={`w-2 h-2 rounded-full ${categoryColor}`} />
        <span className="text-gray-600">{course.credits} credits</span>
      </div>

      <div className="flex items-center gap-1 mt-2">
        <span className={`text-xs font-medium ${difficultyColors[course.difficultyLevel]}`}>
          Level {course.difficultyLevel}
        </span>
        <span className="text-xs text-gray-400">
          ({difficultyLabels[course.difficultyLevel]})
        </span>
      </div>

      {course.prerequisites.length > 0 && (
        <div className="mt-2 pt-2 border-t border-gray-100">
          <span className="text-xs text-gray-500">
            {course.prerequisites.length} prerequisite(s)
          </span>
        </div>
      )}
    </div>
  );
};

const nodeTypes = {
  course: CourseNode,
};

export const CurriculumGraph: React.FC<CurriculumGraphProps> = ({
  courses,
  completedCourseIds,
  inProgressCourseIds = [],
  onCourseClick,
  height = '600px',
}) => {
  const completedIdsSet = useMemo(() => new Set(completedCourseIds), [completedCourseIds]);
  const inProgressIdsSet = useMemo(() => new Set(inProgressCourseIds), [inProgressCourseIds]);

  // Calculate node positions based on course level/semester
  const getNodePosition = useCallback((course: Course, index: number) => {
    // Group courses by difficulty level and category
    const level = course.difficultyLevel;
    const categoryIndex = ['REQUIRED', 'CORE', 'ELECTIVE', 'MAJOR_ELECTIVE'].indexOf(course.category);

    const x = categoryIndex >= 0 ? categoryIndex * 300 : 0;
    const y = (level - 1) * 150 + (index % 3) * 20;

    return { x, y };
  }, []);

  const initialNodes: Node<CourseNodeData>[] = useMemo(() => {
    return courses.map((course, index) => {
      const isCompleted = completedIdsSet.has(course.id);
      const isInProgress = inProgressIdsSet.has(course.id);

      // Check if available (all prerequisites completed)
      const isAvailable = course.prerequisites.every(
        p => completedIdsSet.has(p.prerequisiteId)
      ) && !isCompleted && !isInProgress;

      const position = getNodePosition(course, index);

      return {
        id: course.id,
        type: 'course',
        position,
        data: {
          course,
          isCompleted,
          isInProgress,
          isAvailable,
          onClick: onCourseClick,
        },
      };
    });
  }, [courses, completedIdsSet, inProgressIdsSet, onCourseClick, getNodePosition]);

  const initialEdges: Edge[] = useMemo(() => {
    const edges: Edge[] = [];

    courses.forEach(course => {
      course.prerequisites.forEach(prereq => {
        edges.push({
          id: `${prereq.prerequisiteId}-${course.id}`,
          source: prereq.prerequisiteId,
          target: course.id,
          type: 'smoothstep',
          animated: !completedIdsSet.has(prereq.prerequisiteId),
          style: {
            stroke: completedIdsSet.has(prereq.prerequisiteId) ? '#22c55e' : '#94a3b8',
            strokeWidth: 2,
          },
          markerEnd: {
            type: 'arrowclosed',
            color: completedIdsSet.has(prereq.prerequisiteId) ? '#22c55e' : '#94a3b8',
          },
        });
      });
    });

    return edges;
  }, [courses, completedIdsSet]);

  const [nodes, , onNodesChange] = useNodesState(initialNodes);
  const [edges, , onEdgesChange] = useEdgesState(initialEdges);

  return (
    <div style={{ height }} className="border rounded-lg overflow-hidden">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        fitView
        attributionPosition="bottom-right"
      >
        <Background color="#e2e8f0" gap={16} />
        <Controls />
        <MiniMap
          nodeStrokeWidth={3}
          zoomable
          pannable
        />
        <Panel position="top-left" className="bg-white p-4 rounded-lg shadow-md">
          <h3 className="font-semibold text-gray-900 mb-2">Legend</h3>
          <div className="space-y-2 text-sm">
            <div className="flex items-center gap-2">
              <CheckCircle2 size={16} className="text-green-500" />
              <span>Completed</span>
            </div>
            <div className="flex items-center gap-2">
              <Circle size={16} className="text-blue-500 fill-blue-500" />
              <span>In Progress</span>
            </div>
            <div className="flex items-center gap-2">
              <BookOpen size={16} className="text-primary-500" />
              <span>Available</span>
            </div>
            <div className="flex items-center gap-2">
              <Lock size={16} className="text-gray-400" />
              <span>Locked</span>
            </div>
          </div>
        </Panel>
      </ReactFlow>
    </div>
  );
};
