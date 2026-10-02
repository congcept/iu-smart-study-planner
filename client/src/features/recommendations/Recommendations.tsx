import React, { useCallback, useEffect, useRef, useState } from 'react';

import type { Course, Recommendation } from '@/types';
import { getRecommendations } from '@/lib/api';
import { categoryLabels, formatCredits } from '@/lib/utils';
import { Badge, Button, Card } from '@components/ui';
import { Check, Plus } from 'lucide-react';

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
  const [recommendations, setRecommendations] = useState<Recommendation | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const requestId = useRef(0);

  const fetchRecommendations = useCallback(async () => {
    const currentRequest = ++requestId.current;
    setIsLoading(true);
    setHasError(false);
    try {
      const response = await getRecommendations(userId, { maxCredits: 18, maxDifficulty: 3.5 });
      if (currentRequest !== requestId.current) return;
      if (!response.success || !response.data) throw new Error('Suggestions unavailable');
      setRecommendations(response.data);
    } catch {
      if (currentRequest === requestId.current) {
        setRecommendations(null);
        setHasError(true);
      }
    } finally {
      if (currentRequest === requestId.current) setIsLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    void fetchRecommendations();
    return () => {
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
          <div
            aria-hidden="true"
            className="h-8 w-8 animate-spin rounded-full border-2 border-gray-200 border-t-primary-600"
          />
          Loading suggestions…
        </div>
      </Card>
    );
  }

  if (hasError || !recommendations) {
    return (
      <Card title="Course suggestions">
        <div role="alert" className="space-y-3 py-4">
          <p className="text-sm text-gray-700">
            We couldn’t load course suggestions. Check your connection and try again.
          </p>
          <Button variant="secondary" onClick={() => void fetchRecommendations()}>
            Retry loading
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <Card
      title="Course suggestions"
      subtitle={`${recommendations.courses.length} courses for an 18-credit planning limit`}
    >
      <p className="mb-5 max-w-2xl text-sm text-gray-700">
        Suggestions use recorded prerequisites, course category and a seeded difficulty estimate.
        They do not account for your timetable or confirmed course capacity.
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
                    {formatCredits(course.credits)} · Seeded difficulty {course.difficultyLevel}
                    {course.prerequisites.length > 0 &&
                      ` · ${course.prerequisites.length} recorded prerequisites`}
                  </p>
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
                    onClick={() => onAddToPlan(course)}
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
