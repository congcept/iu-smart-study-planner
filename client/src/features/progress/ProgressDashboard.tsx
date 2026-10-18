import React, { useCallback, useEffect, useRef, useState } from 'react';

import type { Course, StudentRecord } from '@/types';
import { getUserProgress } from '@/lib/api';
import { categoryLabels, formatCredits, formatSemester } from '@/lib/utils';
import { Badge, Button, Card, ProgressBar } from '@components/ui';

interface ProgressDashboardProps {
  userId: string;
}

type ProgressData = {
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
};

export const ProgressDashboard: React.FC<ProgressDashboardProps> = ({ userId }) => {
  const [data, setData] = useState<ProgressData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const requestId = useRef(0);

  const fetchProgress = useCallback(async () => {
    const currentRequest = ++requestId.current;
    setIsLoading(true);
    setHasError(false);
    try {
      const response = await getUserProgress(userId);
      if (currentRequest !== requestId.current) return;
      if (!response.success || !response.data) throw new Error('Progress unavailable');
      setData(response.data);
    } catch {
      if (currentRequest === requestId.current) {
        setData(null);
        setHasError(true);
      }
    } finally {
      if (currentRequest === requestId.current) setIsLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    void fetchProgress();
    return () => {
      requestId.current += 1;
    };
  }, [fetchProgress]);

  if (isLoading) {
    return (
      <Card title="Recorded progress">
        <div
          role="status"
          className="flex items-center justify-center gap-3 py-12 text-sm text-gray-700"
        >
          <div
            aria-hidden="true"
            className="h-8 w-8 animate-spin rounded-full border-2 border-gray-200 border-t-primary-600"
          />
          Loading progress…
        </div>
      </Card>
    );
  }

  if (hasError || !data) {
    return (
      <Card title="Recorded progress">
        <div role="alert" className="space-y-3 py-4">
          <p className="text-sm text-gray-700">
            We couldn’t load your progress. Check your connection and try again.
          </p>
          <Button variant="secondary" onClick={() => void fetchProgress()}>
            Retry loading
          </Button>
        </div>
      </Card>
    );
  }

  const { completed, inProgress, available } = data;
  const counts = data.progress;

  return (
    <div className="space-y-6">
      <Card title="Recorded progress" subtitle="Courses and credits in the current catalog">
        <div className="mb-6 flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-gray-200 pb-5">
          <strong className="text-3xl font-semibold tabular-nums text-gray-900">
            {counts.completedCourses}
          </strong>
          <span className="text-gray-700">
            of {counts.totalCourses} catalog courses recorded as complete
          </span>
        </div>
        <div className="space-y-5">
          <div>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-sm">
              <span className="font-medium text-gray-900">Courses recorded as complete</span>
              <span className="tabular-nums text-gray-700">
                {counts.completedCourses} / {counts.totalCourses}
              </span>
            </div>
            <div
              role="progressbar"
              aria-label="Courses recorded as complete"
              aria-valuemin={0}
              aria-valuemax={counts.totalCourses || 1}
              aria-valuenow={counts.completedCourses}
            >
              <ProgressBar
                progress={counts.completedCourses}
                max={counts.totalCourses || 1}
                showLabel={false}
              />
            </div>
          </div>
          <div>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-sm">
              <span className="font-medium text-gray-900">Credits recorded as complete</span>
              <span className="tabular-nums text-gray-700">
                {counts.completedCredits} / {counts.totalCredits}
              </span>
            </div>
            <div
              role="progressbar"
              aria-label="Credits recorded as complete"
              aria-valuemin={0}
              aria-valuemax={counts.totalCredits || 1}
              aria-valuenow={counts.completedCredits}
            >
              <ProgressBar
                progress={counts.completedCredits}
                max={counts.totalCredits || 1}
                showLabel={false}
              />
            </div>
          </div>
        </div>
        <p className="mt-5 text-sm text-gray-700">
          This catalog count is a record summary, not a graduation or GPA calculation. Physical
          Training 1 and 2 do not count toward completed credits.
        </p>
      </Card>

      <Card title="Completed courses" subtitle={`${completed.length} recorded`}>
        {completed.length === 0 ? (
          <p className="text-sm text-gray-700">No completed courses have been recorded yet.</p>
        ) : (
          <ul className="max-h-72 space-y-2 overflow-y-auto">
            {completed.map((record) => (
              <li
                key={record.id}
                className="flex flex-wrap items-start justify-between gap-2 border-b border-gray-100 py-2 last:border-0"
              >
                <div className="min-w-0">
                  <p className="font-semibold text-gray-900">
                    {record.course.code}{' '}
                    <span className="font-normal text-gray-700">{record.course.name}</span>
                  </p>
                  <p className="text-sm text-gray-700">
                    {formatCredits(record.course.credits)}
                    {record.semester && record.year
                      ? ` · ${formatSemester(record.semester, record.year)}`
                      : ''}
                  </p>
                </div>
                {record.grade && <Badge variant="success">Grade {record.grade}</Badge>}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {inProgress.length > 0 && (
        <Card title="In progress" subtitle={`${inProgress.length} recorded`}>
          <ul className="space-y-2">
            {inProgress.map((record) => (
              <li
                key={record.id}
                className="flex flex-wrap items-baseline justify-between gap-2 border-b border-gray-100 py-2 last:border-0"
              >
                <span className="font-medium text-gray-900">
                  {record.course.code}{' '}
                  <span className="font-normal text-gray-700">{record.course.name}</span>
                </span>
                <span className="text-sm text-gray-700">
                  {formatCredits(record.course.credits)}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card
        title="Prerequisites met"
        subtitle={`${available.length} catalog courses currently eligible`}
      >
        {available.length === 0 ? (
          <p className="text-sm text-gray-700">
            No additional catalog courses currently meet the recorded prerequisites.
          </p>
        ) : (
          <>
            <ul className="max-h-72 space-y-2 overflow-y-auto">
              {available.slice(0, 10).map((course) => (
                <li
                  key={course.id}
                  className="flex flex-wrap items-start justify-between gap-2 border-b border-gray-100 py-2 last:border-0"
                >
                  <div className="min-w-0">
                    <p className="font-semibold text-gray-900">
                      {course.code} <span className="font-normal text-gray-700">{course.name}</span>
                    </p>
                    <p className="text-sm text-gray-700">{categoryLabels[course.category]}</p>
                  </div>
                  <span className="text-sm text-gray-700">{formatCredits(course.credits)}</span>
                </li>
              ))}
            </ul>
            {available.length > 10 && (
              <p className="mt-3 text-sm text-gray-700">
                Showing 10 of {available.length} eligible catalog courses.
              </p>
            )}
          </>
        )}
      </Card>
    </div>
  );
};
