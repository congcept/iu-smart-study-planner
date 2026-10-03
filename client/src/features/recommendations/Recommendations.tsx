import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Sparkles, BookOpen, Plus, Check } from 'lucide-react';
import type { Course, Recommendation } from '@/types';
import { Badge, Button, Card } from '@/components/ui';
import { getRecommendations } from '@/lib/api';
import { categoryLabels, formatCredits } from '@/lib/utils';
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
        <div role="status" className="flex items-center justify-center gap-3 py-12">
          Loading suggestions…
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
        </div>
      </Card>
    );
  }

  if (hasError || !recommendations) {
    return (
      <Card title="Course suggestions">
        <div role="alert" className="text-center py-8 text-red-500">
          <p>We couldn’t load course suggestions. Check your connection and try again.</p>
          <Button variant="secondary" className="mt-4" onClick={() => void fetchRecommendations()}>
            Retry loading
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <Card
      title="Course suggestions"
      subtitle={`${recommendations.stats.recommendedCount} courses recommended`}
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
      <p className="mb-4 text-sm text-gray-700">
        Suggestions use mandatory prerequisites, course category, highest numeric scores and
        rating-based difficulty estimates. They do not check timetables or confirmed teaching
        capacity.
      </p>
      {recommendations.courses.length === 0 && (
        <p className="mb-4">No courses fit these planning limits.</p>
      )}
      {/* Stats Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="text-center p-3 bg-blue-50 rounded-lg">
          <div className="text-xl font-bold text-blue-600">
            {recommendations.stats.recommendedCount}
          </div>
          <div className="text-xs text-blue-600">Courses</div>
        </div>
        <div className="text-center p-3 bg-green-50 rounded-lg">
          <div className="text-xl font-bold text-green-800">
            {recommendations.stats.totalRecommendedCredits}
          </div>
          <div className="text-xs text-green-800">Credits</div>
        </div>
        <div className="text-center p-3 bg-purple-50 rounded-lg">
          <div className="text-xl font-bold text-purple-600">
            {recommendations.stats.averageDifficulty.toFixed(1)}
          </div>
          <div className="text-xs text-purple-600">Avg Difficulty</div>
        </div>
        <div className="text-center p-3 bg-amber-50 rounded-lg">
          <div className="text-xl font-bold text-amber-800">
            {recommendations.stats.filteredCount}
          </div>
          <div className="text-xs text-amber-800">Available</div>
        </div>
      </div>

      {/* Recommendations List */}
      <div className="space-y-3">
        <h4 className="text-sm font-medium text-gray-700 flex items-center gap-2">
          <Sparkles size={16} className="text-yellow-500" />
          Recommended Courses
        </h4>

        {recommendations.courses.map((course) => {
          const isAdded = addedCourseIds.includes(course.id);

          return (
            <div
              key={course.id}
              className="p-4 border border-gray-200 rounded-lg hover:shadow-md transition-shadow"
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-bold text-gray-900">{course.code}</span>
                    <Badge variant="info">{categoryLabels[course.category]}</Badge>
                  </div>
                  <h5 className="font-medium text-gray-800">{course.name}</h5>
                  <p className="text-sm text-gray-500 mt-1">{formatCredits(course.credits)}</p>
                  <CourseRatingBadge course={course} />

                  {course.prerequisites.length > 0 && (
                    <div className="mt-2 text-xs text-gray-500">
                      Prerequisites: {course.prerequisites.length} course(s) required
                    </div>
                  )}
                </div>

                {onAddToPlan && (
                  <Button
                    size="sm"
                    variant={isAdded ? 'secondary' : 'primary'}
                    leftIcon={isAdded ? <Check size={16} /> : <Plus size={16} />}
                    onClick={() => {
                      if (mounted.current && owner.current.epoch === ownerEpoch && !isAdded)
                        onAddToPlan(course);
                    }}
                    disabled={isAdded}
                  >
                    {isAdded ? 'Added' : 'Add'}
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Why These Recommendations */}
      <div className="mt-6 p-4 bg-gray-50 rounded-lg">
        <h5 className="text-sm font-medium text-gray-700 mb-2 flex items-center gap-2">
          <BookOpen size={16} className="text-primary-500" />
          Why These Courses?
        </h5>
        <ul className="text-sm text-gray-600 space-y-1">
          <li>• Prerequisites are met for all recommended courses</li>
          <li>• Workload estimates guide selection within the planning limits</li>
          <li>• Priority given to required and core courses</li>
          <li>• Similar course categories and rating estimates inform numeric grade fit</li>
        </ul>
      </div>
    </Card>
  );
};
