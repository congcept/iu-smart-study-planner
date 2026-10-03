import React, { useEffect, useRef, useState } from 'react';

import type { Course, WorkloadAnalysis } from '@/types';
import { analyzeWorkload } from '@/lib/api';
import { categoryLabels, formatCredits } from '@/lib/utils';
import { Badge, Button, Card } from '@components/ui';

interface WorkloadAnalyzerProps {
  selectedCourses: Course[];
  onClear?: () => void;
}

const bandLabels: Record<WorkloadAnalysis['riskLevel'], string> = {
  LOW: 'Lower estimate',
  MEDIUM: 'Moderate estimate',
  HIGH: 'Higher estimate',
  CRITICAL: 'Highest estimate',
};

export const WorkloadAnalyzer: React.FC<WorkloadAnalyzerProps> = ({ selectedCourses, onClear }) => {
  const selectionKey = selectedCourses
    .map((course) => course.id)
    .sort()
    .join('|');
  const currentSelection = useRef(selectionKey);
  useEffect(() => {
    currentSelection.current = selectionKey;
  }, [selectionKey]);
  const requestId = useRef(0);
  const [result, setResult] = useState<{ key: string; data: WorkloadAnalysis } | null>(null);
  const [analyzingKey, setAnalyzingKey] = useState<string | null>(null);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const analysis = result?.key === selectionKey ? result.data : null;
  const isAnalyzing = analyzingKey === selectionKey;
  const hasError = errorKey === selectionKey;
  const totalCredits = selectedCourses.reduce((sum, course) => sum + course.credits, 0);

  const handleAnalyze = async () => {
    if (selectedCourses.length === 0 || isAnalyzing) return;
    const currentRequest = ++requestId.current;
    const key = selectionKey;
    setAnalyzingKey(key);
    setErrorKey(null);
    try {
      const response = await analyzeWorkload(selectedCourses.map((course) => course.id));
      if (currentRequest !== requestId.current || currentSelection.current !== key) return;
      if (!response.success || !response.data) throw new Error('Analysis unavailable');
      setResult({ key, data: response.data });
    } catch {
      if (currentRequest === requestId.current && currentSelection.current === key) {
        setResult(null);
        setErrorKey(key);
      }
    } finally {
      if (currentRequest === requestId.current) setAnalyzingKey(null);
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
              {isAnalyzing ? 'Calculating…' : 'Calculate estimate'}
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
                </div>
                <span className="text-sm text-gray-700">{formatCredits(course.credits)}</span>
              </li>
            ))}
          </ul>

          <p className="mt-4 max-w-2xl text-sm text-gray-700">
            This estimate combines credits with seeded course difficulty. It does not check
            timetables, teaching capacity or your personal study time.
          </p>

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
                    Heuristic score {analysis.workloadScore.toFixed(1)} · Average seeded difficulty{' '}
                    {analysis.averageDifficulty.toFixed(1)}
                  </p>
                </div>
                <Badge variant="default">{bandLabels[analysis.riskLevel]}</Badge>
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
                  No threshold notes were triggered for this selection. Check your timetable and
                  commitments before choosing a semester load.
                </p>
              )}
            </section>
          )}
        </>
      )}
    </Card>
  );
};
