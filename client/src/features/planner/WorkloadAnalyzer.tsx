import React, { useCallback, useEffect, useRef, useState } from 'react';

import type { Course, WorkloadAnalysis } from '@/types';
import { analyzeWorkload } from '@/lib/api';
import { categoryLabels, formatCredits } from '@/lib/utils';
import { Badge, Button, Card } from '@components/ui';
import { CourseRatingBadge } from '../curriculum/CourseRatingBadge';

interface WorkloadAnalyzerProps {
  selectedCourses: Course[];
  onClear?: () => void;
}

type BadgeVariant = NonNullable<React.ComponentProps<typeof Badge>['variant']>;

const bandLabels: Record<WorkloadAnalysis['riskLevel'], string> = {
  LOW: 'Lower estimate',
  MEDIUM: 'Moderate estimate',
  HIGH: 'Higher estimate',
  CRITICAL: 'Highest estimate',
};

const riskVariants: Record<WorkloadAnalysis['riskLevel'], BadgeVariant> = {
  LOW: 'success',
  MEDIUM: 'info',
  HIGH: 'warning',
  CRITICAL: 'error',
};

function hasDifficultyEstimate(course: Course): boolean {
  return (
    course.ratingDifficulty !== undefined &&
    Number.isFinite(course.ratingDifficulty) &&
    course.ratingDifficulty >= 1 &&
    course.ratingDifficulty <= 5 &&
    course.ratingCount !== undefined &&
    Number.isSafeInteger(course.ratingCount) &&
    course.ratingCount >= 0
  );
}

function isWorkloadAnalysis(value: unknown): value is WorkloadAnalysis {
  if (typeof value !== 'object' || value === null) return false;
  const data = value as Record<string, unknown>;
  const isNonnegativeNumber = (number: unknown): number is number =>
    typeof number === 'number' && Number.isFinite(number) && number >= 0;
  return (
    isNonnegativeNumber(data.totalCredits) &&
    isNonnegativeNumber(data.workloadScore) &&
    isNonnegativeNumber(data.averageDifficulty) &&
    data.averageDifficulty <= 5 &&
    (data.riskLevel === 'LOW' ||
      data.riskLevel === 'MEDIUM' ||
      data.riskLevel === 'HIGH' ||
      data.riskLevel === 'CRITICAL') &&
    Array.isArray(data.recommendations) &&
    data.recommendations.every((recommendation: unknown) => typeof recommendation === 'string')
  );
}

export const WorkloadAnalyzer: React.FC<WorkloadAnalyzerProps> = ({ selectedCourses, onClear }) => {
  const selectionKey = JSON.stringify(selectedCourses.map((course) => course.id).sort());
  const currentSelection = useRef(selectionKey);
  const requestId = useRef(0);
  const mounted = useRef(false);
  const activeRequest = useRef<number | null>(null);
  if (currentSelection.current !== selectionKey) {
    currentSelection.current = selectionKey;
    requestId.current++;
    activeRequest.current = null;
  }
  const invalidate = useCallback(() => {
    requestId.current++;
    activeRequest.current = null;
  }, []);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      invalidate();
    };
  }, [invalidate]);
  const [result, setResult] = useState<{
    key: string;
    request: number;
    data: WorkloadAnalysis;
  } | null>(null);
  const [analyzing, setAnalyzing] = useState<{ key: string; request: number } | null>(null);
  const [failure, setFailure] = useState<{ key: string; request: number } | null>(null);
  const isCurrentState = (value: { key: string; request: number } | null) =>
    value?.key === selectionKey && value.request === requestId.current;
  const isAnalyzing = isCurrentState(analyzing);
  const hasError = isCurrentState(failure);
  const analysis = isCurrentState(result) && !isAnalyzing ? result!.data : null;
  const totalCredits = selectedCourses.reduce((sum, course) => sum + course.credits, 0);
  const estimatedCourses = selectedCourses.filter(hasDifficultyEstimate);
  const missingEstimateCount = selectedCourses.length - estimatedCourses.length;
  const avgDifficulty =
    selectedCourses.length > 0 && missingEstimateCount === 0
      ? estimatedCourses.reduce((sum, course) => sum + course.ratingDifficulty!, 0) /
        estimatedCourses.length
      : null;

  const handleAnalyze = async () => {
    if (
      selectedCourses.length === 0 ||
      activeRequest.current !== null ||
      !mounted.current ||
      currentSelection.current !== selectionKey
    )
      return;
    const request = ++requestId.current;
    const key = selectionKey;
    activeRequest.current = request;
    setAnalyzing({ key, request });
    setFailure(null);
    setResult(null);
    const isCurrent = () =>
      mounted.current && requestId.current === request && currentSelection.current === key;
    try {
      const response = await analyzeWorkload(selectedCourses.map((course) => course.id));
      if (!isCurrent()) return;
      if (!response.success || !isWorkloadAnalysis(response.data))
        throw new Error('Analysis unavailable');
      setResult({ key, request, data: response.data });
    } catch {
      if (isCurrent()) setFailure({ key, request });
    } finally {
      if (isCurrent()) {
        activeRequest.current = null;
        setAnalyzing(null);
      }
    }
  };

  return (
    <Card
      title="Workload estimate"
      subtitle={
        selectedCourses.length > 0
          ? `${selectedCourses.length} selected courses · ${formatCredits(totalCredits)}`
          : 'Review a selected set of courses'
      }
    >
      {selectedCourses.length === 0 ? (
        <p className="text-sm text-gray-700">
          Select courses to compare their total credits and see a workload estimate.
        </p>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              onClick={() => void handleAnalyze()}
              isLoading={isAnalyzing}
              disabled={isAnalyzing}
            >
              {isAnalyzing ? 'Calculating…' : hasError ? 'Retry analysis' : 'Calculate estimate'}
            </Button>
            {onClear && (
              <Button variant="ghost" size="sm" onClick={onClear}>
                Clear selection
              </Button>
            )}
          </div>
          <ul className="max-h-56 divide-y divide-gray-200 overflow-y-auto border-y border-gray-200">
            {selectedCourses.map((course) => (
              <li
                key={course.id}
                className="flex flex-wrap items-baseline justify-between gap-2 py-3"
              >
                <div className="min-w-0">
                  <strong className="text-gray-900">{course.code}</strong>
                  <span className="ml-2 text-gray-700">{course.name}</span>
                  <p className="text-sm text-gray-700">{categoryLabels[course.category]}</p>
                  {hasDifficultyEstimate(course) ? (
                    <CourseRatingBadge course={course} />
                  ) : (
                    <p className="text-xs text-gray-700">Difficulty estimate unavailable</p>
                  )}
                </div>
                <span className="text-sm text-gray-700">{formatCredits(course.credits)}</span>
              </li>
            ))}
          </ul>

          <p className="mt-4 max-w-2xl text-sm text-gray-700">
            This estimate combines credits with rating-based difficulty estimates. It does not
            validate prerequisites, timetable conflicts, teaching capacity or your personal study
            time.
          </p>

          <p className="mt-4 text-sm text-gray-700">
            Average rating difficulty:{' '}
            {avgDifficulty === null ? 'Unknown' : `${avgDifficulty.toFixed(1)} / 5`}
          </p>
          {missingEstimateCount > 0 && (
            <p className="text-xs text-gray-700">
              {missingEstimateCount} of {selectedCourses.length} courses have no difficulty
              estimate.
            </p>
          )}
          {isAnalyzing && (
            <p role="status" className="mt-4 text-sm text-gray-700">
              Calculating your workload estimate…
            </p>
          )}
          {hasError && (
            <p role="alert" className="mt-4 text-sm text-red-700">
              We couldn’t calculate this selection. Check your connection and try again.
            </p>
          )}

          {analysis && (
            <section aria-label="Workload result" className="mt-6 border-t border-gray-200 pt-5">
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <div>
                  <h4 className="font-semibold text-gray-900">Estimated workload</h4>
                  <p className="mt-1 text-sm text-gray-700">
                    Server estimate: {analysis.totalCredits} credits · Heuristic score{' '}
                    {analysis.workloadScore.toFixed(1)} · Average rating difficulty{' '}
                    {analysis.averageDifficulty.toFixed(1)}
                  </p>
                </div>
                <Badge variant={riskVariants[analysis.riskLevel]}>
                  {bandLabels[analysis.riskLevel]}
                </Badge>
              </div>

              {analysis.recommendations.length > 0 ? (
                <div className="mt-5">
                  <h5 className="text-sm font-semibold text-gray-900">Things to review</h5>
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-gray-700">
                    {analysis.recommendations.map((recommendation, index) => (
                      <li key={`${index}-${recommendation}`}>{recommendation}</li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p className="mt-5 text-sm text-gray-700">
                  No workload thresholds were triggered. This is an estimate; prerequisites and
                  timetable conflicts still need checking.
                </p>
              )}
            </section>
          )}
        </>
      )}
    </Card>
  );
};
