import React, { useState } from 'react';
import type { Course, WorkloadAnalysis } from '../../types';
import { Badge, Card, ProgressBar } from '@components/ui';
import { analyzeWorkload } from '../../lib/api';
import { AlertTriangle, CheckCircle, Lightbulb, Calculator, BookOpen } from 'lucide-react';
import { riskLevelColors, riskLevelLabels, categoryLabels } from '../../lib/utils';

interface WorkloadAnalyzerProps {
  selectedCourses: Course[];
  onClear?: () => void;
}

export const WorkloadAnalyzer: React.FC<WorkloadAnalyzerProps> = ({ selectedCourses, onClear }) => {
  const [analysis, setAnalysis] = useState<WorkloadAnalysis | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  const handleAnalyze = async () => {
    if (selectedCourses.length === 0) return;

    setIsAnalyzing(true);
    try {
      const courseIds = selectedCourses.map((c) => c.id);
      const response = await analyzeWorkload(courseIds);
      if (response.success) {
        setAnalysis(response.data);
      }
    } catch (error) {
      console.error('Failed to analyze workload:', error);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const totalCredits = selectedCourses.reduce((sum, c) => sum + c.credits, 0);
  const avgDifficulty =
    selectedCourses.length > 0
      ? selectedCourses.reduce((sum, c) => sum + c.difficultyLevel, 0) / selectedCourses.length
      : 0;

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
            {isAnalyzing ? 'Analyzing...' : 'Analyze'}
          </button>
        </div>
      }
    >
      {/* Selected Courses Summary */}
      <div className="mb-6">
        <h4 className="text-sm font-medium text-gray-700 mb-2">Selected Courses</h4>
        <div className="space-y-2 max-h-40 overflow-y-auto">
          {selectedCourses.map((course) => (
            <div
              key={course.id}
              className="flex items-center justify-between p-2 bg-gray-50 rounded-lg"
            >
              <div className="flex items-center gap-2">
                <BookOpen size={16} className="text-gray-400" />
                <span className="text-sm font-medium">{course.code}</span>
                <span className="text-sm text-gray-600">{course.name}</span>
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
          <div className="text-2xl font-bold text-gray-900">{avgDifficulty.toFixed(1)}</div>
          <div className="text-sm text-gray-500">Avg Difficulty</div>
        </div>
      </div>

      {/* Analysis Results */}
      {analysis && (
        <div className="border-t pt-6">
          <h4 className="text-sm font-medium text-gray-700 mb-4">Analysis Results</h4>

          {/* Risk Level */}
          <div className="mb-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-gray-600">Risk Level</span>
              <Badge className={riskLevelColors[analysis.riskLevel]}>
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
              <span className="text-sm text-green-700">Your semester plan looks balanced!</span>
            </div>
          )}
        </div>
      )}
    </Card>
  );
};
