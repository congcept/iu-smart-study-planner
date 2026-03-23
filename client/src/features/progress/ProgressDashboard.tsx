import React, { useEffect, useState } from 'react';
import type { StudentRecord, Course } from '@/types';
import { Badge, Card, ProgressBar } from '@components/ui';
import { getUserProgress } from '@/lib/api';
import {
  GraduationCap,
  BookOpen,
  Target,
  Award,
  Clock
} from 'lucide-react';
import { categoryLabels } from '@/lib/utils';

interface ProgressDashboardProps {
  userId: string;
}

export const ProgressDashboard: React.FC<ProgressDashboardProps> = ({ userId }) => {
  const [progress, setProgress] = useState<{
    completed: StudentRecord[];
    inProgress: StudentRecord[];
    planned: StudentRecord[];
    available: Course[];
    progress: {
      totalCourses: number;
      completedCourses: number;
      totalCredits: number;
      completedCredits: number;
      percentage: number;
    };
  } | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetchProgress();
  }, [userId]);

  const fetchProgress = async () => {
    try {
      setIsLoading(true);
      const response = await getUserProgress(userId);
      if (response.success) {
        setProgress(response.data);
      }
    } catch (error) {
      console.error('Failed to fetch progress:', error);
    } finally {
      setIsLoading(false);
    }
  };

  if (isLoading) {
    return (
      <Card title="Progress Dashboard">
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
        </div>
      </Card>
    );
  }

  if (!progress) {
    return (
      <Card title="Progress Dashboard">
        <div className="text-center py-8 text-gray-500">
          <p>Failed to load progress data</p>
        </div>
      </Card>
    );
  }

  const { completed, inProgress, available } = progress;

  return (
    <div className="space-y-6">
      {/* Overall Progress */}
      <Card title="Overall Progress" subtitle="Track your degree completion">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-6">
          <div className="p-4 bg-blue-50 rounded-lg text-center">
            <GraduationCap size={32} className="mx-auto mb-2 text-blue-600" />
            <div className="text-2xl font-bold text-gray-900">
              {progress.progress.completedCourses}
            </div>
            <div className="text-sm text-gray-600">Courses Completed</div>
          </div>

          <div className="p-4 bg-green-50 rounded-lg text-center">
            <Award size={32} className="mx-auto mb-2 text-green-600" />
            <div className="text-2xl font-bold text-gray-900">
              {progress.progress.completedCredits}
            </div>
            <div className="text-sm text-gray-600">Credits Earned</div>
          </div>

          <div className="p-4 bg-amber-50 rounded-lg text-center">
            <Clock size={32} className="mx-auto mb-2 text-amber-600" />
            <div className="text-2xl font-bold text-gray-900">
              {inProgress.length}
            </div>
            <div className="text-sm text-gray-600">In Progress</div>
          </div>

          <div className="p-4 bg-purple-50 rounded-lg text-center">
            <BookOpen size={32} className="mx-auto mb-2 text-purple-600" />
            <div className="text-2xl font-bold text-gray-900">
              {available.length}
            </div>
            <div className="text-sm text-gray-600">Available</div>
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-gray-700">Courses Completed</span>
              <span className="text-sm text-gray-500">
                {progress.progress.completedCourses} / {progress.progress.totalCourses}
              </span>
            </div>
            <ProgressBar
              progress={progress.progress.completedCourses}
              max={progress.progress.totalCourses}
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-gray-700">Credits Completed</span>
              <span className="text-sm text-gray-500">
                {progress.progress.completedCredits} / {progress.progress.totalCredits}
              </span>
            </div>
            <ProgressBar
              progress={progress.progress.completedCredits}
              max={progress.progress.totalCredits}
            />
          </div>
        </div>

        <div className="mt-6 p-4 bg-gray-50 rounded-lg">
          <div className="flex items-center gap-2 mb-2">
            <Target size={20} className="text-primary-600" />
            <span className="font-medium text-gray-900">Degree Progress</span>
          </div>
          <div className="text-3xl font-bold text-primary-600">
            {progress.progress.percentage}%
          </div>
          <p className="text-sm text-gray-600 mt-1">
            {progress.progress.totalCourses - progress.progress.completedCourses} more courses to graduate
          </p>
        </div>
      </Card>

      {/* Completed Courses */}
      {completed.length > 0 && (
        <Card title="Completed Courses" subtitle={`${completed.length} courses finished`}>
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {completed.map(record => (
              <div
                key={record.id}
                className="flex items-center justify-between p-3 bg-gray-50 rounded-lg"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-gray-900">
                      {record.course.code}
                    </span>
                    <Badge variant="success">{record.grade || 'Pass'}</Badge>
                  </div>
                  <p className="text-sm text-gray-600">{record.course.name}</p>
                </div>
                <div className="text-right">
                  <span className="text-sm text-gray-500">
                    {record.semester} {record.year}
                  </span>
                  <p className="text-xs text-gray-400">
                    {record.course.credits} credits
                  </p>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* In Progress */}
      {inProgress.length > 0 && (
        <Card title="In Progress" subtitle={`${inProgress.length} courses currently enrolled`}>
          <div className="space-y-2">
            {inProgress.map(record => (
              <div
                key={record.id}
                className="flex items-center justify-between p-3 bg-blue-50 rounded-lg"
              >
                <div>
                  <span className="font-semibold text-gray-900">
                    {record.course.code}
                  </span>
                  <p className="text-sm text-gray-600">{record.course.name}</p>
                </div>
                <div className="text-right">
                  <Badge variant="info">In Progress</Badge>
                  <p className="text-xs text-gray-400 mt-1">
                    {record.course.credits} credits
                  </p>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Available Courses */}
      {available.length > 0 && (
        <Card title="Available Next" subtitle={`${available.length} courses you can take`}>
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {available.slice(0, 10).map(course => (
              <div
                key={course.id}
                className="flex items-center justify-between p-3 bg-green-50 rounded-lg"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-gray-900">
                      {course.code}
                    </span>
                    <Badge variant="default">
                      {categoryLabels[course.category]}
                    </Badge>
                  </div>
                  <p className="text-sm text-gray-600">{course.name}</p>
                </div>
                <div className="text-right">
                  <span className="text-sm text-gray-500">
                    Level {course.difficultyLevel}
                  </span>
                  <p className="text-xs text-gray-400">
                    {course.credits} credits
                  </p>
                </div>
              </div>
            ))}
            {available.length > 10 && (
              <p className="text-center text-sm text-gray-500 py-2">
                + {available.length - 10} more courses available
              </p>
            )}
          </div>
        </Card>
      )}
    </div>
  );
};
