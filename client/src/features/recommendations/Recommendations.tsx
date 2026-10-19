import React, { useCallback, useEffect, useRef, useState } from 'react';

import type { Course, Recommendation } from '@/types';
import { getRecommendations } from '@/lib/api';
import { categoryLabels, formatCredits } from '@/lib/utils';
import { Badge, Button, Card, ErrorBanner, LoadingSpinner } from '@components/ui';
import { Check, Plus } from 'lucide-react';

import { CourseRatingBadge } from '../curriculum/CourseRatingBadge';

function isRecommendation(value: unknown): value is Recommendation {
  if (
    !value ||
    typeof value !== 'object' ||
    !('courses' in value) ||
    !Array.isArray(value.courses) ||
    !('stats' in value) ||
    !value.stats ||
    typeof value.stats !== 'object'
  )
    return false;
  const stats = value.stats as Record<string, unknown>;
  if (
    !('gpaPath' in stats) ||
    (stats.gpaPath !== null && stats.gpaPath !== 'THESIS' && stats.gpaPath !== 'ALTERNATIVE')
  )
    return false;
  for (const field of [
    'totalAvailable',
    'filteredCount',
    'recommendedCount',
    'totalRecommendedCredits',
  ] as const) {
    if (
      !(field in stats) ||
      typeof stats[field] !== 'number' ||
      !Number.isSafeInteger(stats[field]) ||
      stats[field] < 0
    )
      return false;
  }
  if (
    !('averageDifficulty' in stats) ||
    typeof stats.averageDifficulty !== 'number' ||
    !Number.isFinite(stats.averageDifficulty) ||
    stats.averageDifficulty < 0 ||
    stats.averageDifficulty > 5
  )
    return false;
  return value.courses.every(
    (course: unknown) =>
      !!course &&
      typeof course === 'object' &&
      'id' in course &&
      typeof course.id === 'string' &&
      'code' in course &&
      typeof course.code === 'string' &&
      'name' in course &&
      typeof course.name === 'string' &&
      'credits' in course &&
      typeof course.credits === 'number' &&
      Number.isFinite(course.credits) &&
      course.credits >= 0 &&
      'prerequisites' in course &&
      Array.isArray(course.prerequisites),
  );
}

interface RecommendationsProps {
  userId: string;
  onAddToPlan?: (course: Course) => void;
  addedCourseIds?: string[];
}

export const Recommendations: React.FC<RecommendationsProps> = ({
  userId,
  onAddToPlan,
  addedCourseIds = [],
}) => {
  const owner = useRef({ userId, epoch: 0 });
  if (owner.current.userId !== userId) {
    owner.current = { userId, epoch: owner.current.epoch + 1 };
  }
  const ownerEpoch = owner.current.epoch;
  const mounted = useRef(false);
  const requestId = useRef(0);
  const [result, setResult] = useState<{
    epoch: number;
    status: 'loading' | 'ready' | 'error';
    data?: Recommendation;
  }>({ epoch: ownerEpoch, status: 'loading' });
  const recommendations =
    result.epoch === ownerEpoch && result.status === 'ready' ? (result.data ?? null) : null;
  const isLoading = result.epoch !== ownerEpoch || result.status === 'loading';
  const hasError = result.epoch === ownerEpoch && result.status === 'error';

  const fetchRecommendations = useCallback(async () => {
    const isOwner = () => mounted.current && owner.current.epoch === ownerEpoch;
    if (!isOwner()) return;
    const currentRequest = ++requestId.current;
    const isCurrent = () => isOwner() && requestId.current === currentRequest;
    setResult({ epoch: ownerEpoch, status: 'loading' });
    try {
      const response = await getRecommendations(userId, { maxCredits: 18, maxDifficulty: 3.5 });
      if (!isCurrent()) return;
      if (!response.success || !isRecommendation(response.data))
        throw new Error('Suggestions unavailable');
      setResult({ epoch: ownerEpoch, status: 'ready', data: response.data });
    } catch {
      if (isCurrent()) setResult({ epoch: ownerEpoch, status: 'error' });
    }
  }, [userId, ownerEpoch]);

  useEffect(() => {
    mounted.current = true;
    void fetchRecommendations();
    return () => {
      mounted.current = false;
      requestId.current += 1;
    };
  }, [fetchRecommendations]);

  if (isLoading) {
    return (
      <Card title="Course suggestions">
        <div
          role="status"
          className="flex items-center justify-center gap-3 py-12 text-sm text-gray-700"
        >
          <LoadingSpinner variant="ring" />
          Loading suggestions…
        </div>
      </Card>
    );
  }

  if (hasError || !recommendations) {
    return (
      <Card title="Course suggestions">
        <ErrorBanner as="div" className="space-y-3 py-4">
          <p className="text-sm text-gray-700">
            We couldn’t load course suggestions. Check your connection and try again.
          </p>
          <Button variant="secondary" onClick={() => void fetchRecommendations()}>
            Retry loading
          </Button>
        </ErrorBanner>
      </Card>
    );
  }

  return (
    <Card
      title="Course suggestions"
      subtitle={`${recommendations.courses.length} courses · ${formatCredits(recommendations.stats.totalRecommendedCredits)} suggested · 18-credit limit`}
    >
      <p className="mb-4 text-sm text-gray-700">
        {recommendations.stats.gpaPath === 'THESIS'
          ? 'Your recorded GPA selects the Thesis path for Year 4, Semester 2.'
          : recommendations.stats.gpaPath === 'ALTERNATIVE'
            ? 'Your recorded GPA selects the alternative path for Year 4, Semester 2.'
            : 'No numeric GPA is recorded. Suggestions may include both Year 4, Semester 2 paths; your manual curriculum choice is not applied here.'}
      </p>
      <Button
        variant="secondary"
        className="mb-4 min-h-11"
        onClick={() => void fetchRecommendations()}
      >
        Refresh suggestions
      </Button>
      <p className="mb-5 max-w-2xl text-sm text-gray-700">
        Suggestions use mandatory prerequisites, course category, highest numeric scores and
        rating-based difficulty estimates. They do not account for your timetable or confirmed
        course capacity.
      </p>

      {recommendations.courses.length === 0 ? (
        <div className="border-t border-gray-200 pt-5">
          <p className="font-medium text-gray-900">No courses fit these planning limits.</p>
          <p className="mt-1 text-sm text-gray-700">
            Review your recorded prerequisites and completed courses to see what is available next.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-gray-200 border-y border-gray-200">
          {recommendations.courses.map((course) => {
            const isAdded = addedCourseIds.includes(course.id);
            return (
              <li key={course.id} className="flex flex-wrap items-start justify-between gap-3 py-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <strong className="text-gray-900">{course.code}</strong>
                    <Badge variant="info">{categoryLabels[course.category]}</Badge>
                  </div>
                  <p className="mt-1 text-gray-800">{course.name}</p>
                  <p className="mt-1 text-sm text-gray-700">
                    {formatCredits(course.credits)}
                    {course.prerequisites.length > 0 &&
                      ` · ${course.prerequisites.length} recorded prerequisites`}
                  </p>
                  <CourseRatingBadge course={course} />
                </div>
                {onAddToPlan && (
                  <Button
                    size="sm"
                    variant={isAdded ? 'secondary' : 'primary'}
                    leftIcon={
                      isAdded ? (
                        <Check size={16} aria-hidden="true" />
                      ) : (
                        <Plus size={16} aria-hidden="true" />
                      )
                    }
                    onClick={() => {
                      if (mounted.current && owner.current.epoch === ownerEpoch && !isAdded)
                        onAddToPlan(course);
                    }}
                    disabled={isAdded}
                    aria-label={
                      isAdded ? `${course.code} added to plan` : `Add ${course.code} to plan`
                    }
                  >
                    {isAdded ? 'Added' : 'Add to plan'}
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
};
