import React, { useEffect, useState } from 'react';
import type { Course, Recommendation } from '../../types';
import { Badge, Button, Card } from '@components/ui';
import { getRecommendations } from '../../lib/api';
import { 
  Sparkles, 
  BookOpen, 
  Target, 
  TrendingUp,
  Plus,
  Check
} from 'lucide-react';
import { difficultyColors, categoryLabels, formatCredits } from '../../lib/utils';

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
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchRecommendations();
  }, [userId]);

  const fetchRecommendations = async () => {
    try {
      setIsLoading(true);
      const response = await getRecommendations(userId, {
        maxCredits: 18,
        maxDifficulty: 3.5,
      });
      
      if (response.success) {
        setRecommendations(response.data);
      } else {
        setError('Failed to load recommendations');
      }
    } catch (err) {
      setError('Failed to load recommendations');
    } finally {
      setIsLoading(false);
    }
  };

  if (isLoading) {
    return (
      <Card title="Smart Recommendations" subtitle="AI-powered course suggestions">
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
        </div>
      </Card>
    );
  }

  if (error) {
    return (
      <Card title="Smart Recommendations" subtitle="AI-powered course suggestions">
        <div className="text-center py-8 text-red-500">
          <p>{error}</p>
          <Button 
            variant="secondary" 
            className="mt-4"
            onClick={fetchRecommendations}
          >
            Retry
          </Button>
        </div>
      </Card>
    );
  }

  if (!recommendations || recommendations.courses.length === 0) {
    return (
      <Card title="Smart Recommendations" subtitle="AI-powered course suggestions">
        <div className="text-center py-8 text-gray-500">
          <Target size={48} className="mx-auto mb-4 opacity-50" />
          <p>No recommendations available</p>
          <p className="text-sm mt-2">Complete more prerequisites to get suggestions</p>
        </div>
      </Card>
    );
  }

  return (
    <Card 
      title="Smart Recommendations" 
      subtitle={`${recommendations.stats.recommendedCount} courses recommended`}
    >
      {/* Stats Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="text-center p-3 bg-blue-50 rounded-lg">
          <div className="text-xl font-bold text-blue-600">
            {recommendations.stats.recommendedCount}
          </div>
          <div className="text-xs text-blue-600">Courses</div>
        </div>
        <div className="text-center p-3 bg-green-50 rounded-lg">
          <div className="text-xl font-bold text-green-600">
            {recommendations.stats.totalRecommendedCredits}
          </div>
          <div className="text-xs text-green-600">Credits</div>
        </div>
        <div className="text-center p-3 bg-purple-50 rounded-lg">
          <div className="text-xl font-bold text-purple-600">
            {recommendations.stats.averageDifficulty.toFixed(1)}
          </div>
          <div className="text-xs text-purple-600">Avg Difficulty</div>
        </div>
        <div className="text-center p-3 bg-amber-50 rounded-lg">
          <div className="text-xl font-bold text-amber-600">
            {recommendations.stats.filteredCount}
          </div>
          <div className="text-xs text-amber-600">Available</div>
        </div>
      </div>

      {/* Recommendations List */}
      <div className="space-y-3">
        <h4 className="text-sm font-medium text-gray-700 flex items-center gap-2">
          <Sparkles size={16} className="text-yellow-500" />
          Recommended Courses
        </h4>
        
        {recommendations.courses.map((course, index) => {
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
                    {index < 3 && (
                      <Badge variant="warning" className="text-xs">
                        <TrendingUp size={12} className="mr-1" />
                        High Priority
                      </Badge>
                    )}
                  </div>
                  <h5 className="font-medium text-gray-800">{course.name}</h5>
                  <p className="text-sm text-gray-500 mt-1">
                    {formatCredits(course.credits)} • 
                    <span className={`ml-1 ${difficultyColors[course.difficultyLevel]}`}>
                      Difficulty Level {course.difficultyLevel}
                    </span>
                  </p>
                  
                  {course.prerequisites.length > 0 && (
                    <div className="mt-2 text-xs text-gray-500">
                      Prerequisites: {course.prerequisites.length} course(s) required
                    </div>
                  )}
                </div>
                
                {onAddToPlan && (
                  <Button
                    size="sm"
                    variant={isAdded ? "secondary" : "primary"}
                    leftIcon={isAdded ? <Check size={16} /> : <Plus size={16} />}
                    onClick={() => !isAdded && onAddToPlan(course)}
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
          <li>• Workload is balanced to avoid overload</li>
          <li>• Priority given to required and core courses</li>
          <li>• Difficulty level kept within manageable range</li>
        </ul>
      </div>
    </Card>
  );
};
