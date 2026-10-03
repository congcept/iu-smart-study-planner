import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { Course, WorkloadAnalysis } from '@/types';
import { Badge, Card, ProgressBar } from '@components/ui';
import { analyzeWorkload } from '@/lib/api';
import { AlertTriangle, CheckCircle, Lightbulb, Calculator, BookOpen } from 'lucide-react';
import { riskLevelColors, riskLevelLabels, categoryLabels } from '@/lib/utils';
import { CourseRatingBadge } from '../curriculum/CourseRatingBadge';

interface WorkloadAnalyzerProps {
  selectedCourses: Course[];
  onClear?: () => void;
}

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
  const [analyzing, setAnalyzing] = useState<{
    key: string;
    request: number;
  } | null>(null);
  const [failure, setFailure] = useState<{
    key: string;
    request: number;
  } | null>(null);
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

  if (selectedCourses.length === 0) {
    return (
      <Card title="Workload Analyzer" subtitle="Select courses to analyze your semester workload">
        <div className="text-center py-8 text-gray-500">
          <Calculator size={48} className="mx-auto mb-4 opacity-50" />
          <p>No courses selected</p>
          <p className="text-sm mt-2">Add courses to see workload analysis</p>
        </div>
      </Card>
    );
  }

  return (
    <Card
      title="Workload Analyzer"
      subtitle={`${selectedCourses.length} course(s) selected`}
      headerAction={
        <div className="flex gap-2">
          {onClear && (
            <button onClick={onClear} className="text-sm text-gray-500 hover:text-gray-700">
              Clear
            </button>
          )}
          <button
            onClick={handleAnalyze}
            disabled={isAnalyzing || selectedCourses.length === 0}
            className="px-4 py-2 bg-primary-600 text-white rounded-lg text-sm font-medium hover:bg-primary-700 disabled:opacity-50"
          >
            {isAnalyzing ? 'Analyzing...' : hasError ? 'Retry analysis' : 'Analyze'}
          </button>
        </div>
      }
    >
      {isAnalyzing && (
        <p role="status" className="mb-4 text-sm text-gray-700">
          Calculating your workload estimate…
        </p>
      )}
      {hasError && (
        <p role="alert" className="mb-4 text-sm text-red-700">
          We couldn’t calculate this selection. Check your connection and retry the analysis.
        </p>
      )}
      {/* Selected Courses Summary */}
      <div className="mb-6">
        <h4 className="text-sm font-medium text-gray-700 mb-2">Selected Courses</h4>
        <div className="space-y-2 max-h-40 overflow-y-auto">
          {selectedCourses.map((course) => (
            <div
              key={course.id}
              className="flex items-center justify-between p-2 bg-gray-50 rounded-lg"
            >
              <div>
                <div className="flex items-center gap-2">
                  <BookOpen size={16} className="text-gray-400" />
                  <span className="text-sm font-medium">{course.code}</span>
                  <span className="text-sm text-gray-600">{course.name}</span>
                </div>
                {hasDifficultyEstimate(course) ? (
                  <CourseRatingBadge course={course} />
                ) : (
                  <p className="text-xs text-gray-700">Difficulty estimate unavailable</p>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={course.category === 'REQUIRED' ? 'info' : 'default'}>
                  {categoryLabels[course.category]}
                </Badge>
                <span className="text-sm text-gray-500">{course.credits} cr</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        <div className="p-4 bg-gray-50 rounded-lg">
          <div className="text-2xl font-bold text-gray-900">{totalCredits}</div>
          <div className="text-sm text-gray-500">Total Credits</div>
        </div>
        <div className="p-4 bg-gray-50 rounded-lg">
          <div className="text-2xl font-bold text-gray-900">
            {avgDifficulty === null ? 'Unknown' : avgDifficulty.toFixed(1)}
          </div>
          <div className="text-sm text-gray-500">Avg Rating Difficulty</div>
          {missingEstimateCount > 0 && (
            <p className="text-xs text-gray-700">
              {missingEstimateCount} of {selectedCourses.length} courses have no difficulty
              estimate.
            </p>
          )}
        </div>
      </div>

      <p className="mb-4 text-sm text-gray-700">
        This estimate combines credits with rating-based difficulty estimates. It does not validate
        prerequisites, timetable conflicts, teaching capacity or your personal study time.
      </p>
      {/* Analysis Results */}
      {analysis && (
        <section aria-label="Workload result" className="border-t pt-6">
          <h4 className="text-sm font-medium text-gray-700 mb-4">Analysis Results</h4>
          <p className="mb-4 text-sm text-gray-700">
            Server estimate: {analysis.totalCredits} credits · Average rating difficulty{' '}
            {analysis.averageDifficulty.toFixed(1)} / 5
          </p>

          {/* Risk Level */}
          <div className="mb-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-gray-600">Heuristic workload band</span>
              <Badge
                variant={
                  analysis.riskLevel === 'CRITICAL' || analysis.riskLevel === 'HIGH'
                    ? 'error'
                    : analysis.riskLevel === 'MEDIUM'
                      ? 'warning'
                      : 'success'
                }
              >
                {riskLevelLabels[analysis.riskLevel]}
              </Badge>
            </div>
            <div className={`h-2 rounded-full ${riskLevelColors[analysis.riskLevel]} opacity-30`}>
              <div
                className={`h-full rounded-full ${riskLevelColors[analysis.riskLevel]} transition-all duration-500`}
                style={{
                  width:
                    analysis.riskLevel === 'LOW'
                      ? '25%'
                      : analysis.riskLevel === 'MEDIUM'
                        ? '50%'
                        : analysis.riskLevel === 'HIGH'
                          ? '75%'
                          : '100%',
                }}
              />
            </div>
          </div>

          {/* Workload Score */}
          <div className="mb-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-gray-600">Workload Score</span>
              <span className="text-lg font-semibold">{analysis.workloadScore.toFixed(1)}</span>
            </div>
            <ProgressBar progress={analysis.workloadScore} max={60} size="sm" showLabel={false} />
          </div>

          {/* Recommendations */}
          {analysis.recommendations.length > 0 && (
            <div className="mt-4">
              <h5 className="text-sm font-medium text-gray-700 mb-2 flex items-center gap-2">
                <Lightbulb size={16} className="text-yellow-500" />
                Recommendations
              </h5>
              <ul className="space-y-2">
                {analysis.recommendations.map((rec, index) => (
                  <li key={index} className="flex items-start gap-2 text-sm text-gray-600">
                    <AlertTriangle size={14} className="mt-0.5 text-amber-500 flex-shrink-0" />
                    {rec}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* All Clear Message */}
          {analysis.recommendations.length === 0 && (
            <div className="flex items-center gap-2 p-3 bg-green-50 rounded-lg">
              <CheckCircle size={20} className="text-green-500" />
              <span className="text-sm text-green-700">
                No workload thresholds were triggered. This is an estimate; prerequisites and
                timetable conflicts still need checking.
              </span>
            </div>
          )}
        </section>
      )}
    </Card>
  );
};
