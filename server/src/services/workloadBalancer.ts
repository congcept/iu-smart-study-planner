import { Course, StudentRecord } from '@prisma/client';

interface WorkloadAnalysis {
  totalCredits: number;
  averageDifficulty: number;
  workloadScore: number;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  recommendations: string[];
}

interface RecommendationInput {
  availableCourses: (Course & { prerequisites: any[] })[];
  maxCredits: number;
  maxDifficulty: number;
  userHistory: StudentRecord[];
}

class WorkloadBalancer {
  /**
   * Calculate the workload score based on credits and difficulty
   * Score = (totalCredits * 0.4) + (avgDifficulty * totalCredits * 0.6)
   */
  private calculateWorkloadScore(courses: Course[]): number {
    const totalCredits = courses.reduce((sum, c) => sum + c.credits, 0);
    const avgDifficulty = courses.length > 0
      ? courses.reduce((sum, c) => sum + c.difficultyLevel, 0) / courses.length
      : 0;
    
    return (totalCredits * 0.4) + (avgDifficulty * totalCredits * 0.6);
  }

  /**
   * Determine risk level based on workload score
   */
  private determineRiskLevel(score: number): WorkloadAnalysis['riskLevel'] {
    if (score <= 20) return 'LOW';
    if (score <= 35) return 'MEDIUM';
    if (score <= 50) return 'HIGH';
    return 'CRITICAL';
  }

  /**
   * Analyze a semester's workload and provide insights
   */
  analyzeSemesterWorkload(courses: Course[]): WorkloadAnalysis {
    const totalCredits = courses.reduce((sum, c) => sum + c.credits, 0);
    const averageDifficulty = courses.length > 0
      ? courses.reduce((sum, c) => sum + c.difficultyLevel, 0) / courses.length
      : 0;
    
    const workloadScore = this.calculateWorkloadScore(courses);
    const riskLevel = this.determineRiskLevel(workloadScore);
    const recommendations: string[] = [];

    // Generate recommendations
    if (totalCredits > 18) {
      recommendations.push(`Consider reducing credits from ${totalCredits} to 18 or fewer`);
    }
    if (totalCredits < 12) {
      recommendations.push(`Consider adding more courses to reach at least 12 credits`);
    }
    if (averageDifficulty > 3.5) {
      recommendations.push('High average difficulty detected. Consider balancing with easier courses');
    }
    if (courses.filter(c => c.difficultyLevel >= 4).length > 2) {
      recommendations.push('Multiple high-difficulty courses detected. Spread them across semesters');
    }

    // Add category-specific recommendations
    const categoryCount = new Map<string, number>();
    courses.forEach(c => {
      const count = categoryCount.get(c.category) || 0;
      categoryCount.set(c.category, count + 1);
    });

    const highConcentrationCategories = Array.from(categoryCount.entries())
      .filter(([_, count]) => count > 3);
    
    if (highConcentrationCategories.length > 0) {
      recommendations.push('Consider diversifying course categories for better balance');
    }

    return {
      totalCredits,
      averageDifficulty: Math.round(averageDifficulty * 100) / 100,
      workloadScore: Math.round(workloadScore * 100) / 100,
      riskLevel,
      recommendations,
    };
  }

  /**
   * Calculate course recommendations with workload balancing
   */
  calculateRecommendations(input: RecommendationInput): Course[] {
    const { availableCourses, maxCredits, maxDifficulty, userHistory } = input;
    
    // Sort by priority factors
    const scoredCourses = availableCourses.map(course => {
      let priorityScore = 0;

      // Higher priority for required courses
      if (course.category === 'REQUIRED') priorityScore += 10;
      if (course.category === 'CORE') priorityScore += 8;
      
      // Higher priority for courses that unlock many other courses
      const unlocksCount = course.isPrerequisiteFor?.length || 0;
      priorityScore += unlocksCount * 2;

      // Consider user's past performance on similar difficulty levels
      const similarDifficultyCourses = userHistory.filter(
        r => r.course.difficultyLevel === course.difficultyLevel
      );
      if (similarDifficultyCourses.length > 0) {
        const avgPerformance = similarDifficultyCourses.reduce(
          (sum, r) => sum + (r.gradePoints || 0), 0
        ) / similarDifficultyCourses.length;
        
        // If user struggles with this difficulty, lower priority slightly
        if (avgPerformance < 2.5) {
          priorityScore -= 2;
        } else if (avgPerformance > 3.5) {
          priorityScore += 1;
        }
      }

      // Penalize very high difficulty courses slightly
      if (course.difficultyLevel >= 4) {
        priorityScore -= 1;
      }

      return { course, priorityScore };
    });

    // Sort by priority score (descending)
    scoredCourses.sort((a, b) => b.priorityScore - a.priorityScore);

    // Select courses while respecting constraints
    const selected: Course[] = [];
    let currentCredits = 0;
    let currentDifficultySum = 0;

    for (const { course } of scoredCourses) {
      const projectedCredits = currentCredits + course.credits;
      const projectedDifficulty = (currentDifficultySum + course.difficultyLevel) / (selected.length + 1);

      // Check constraints
      if (projectedCredits > maxCredits) continue;
      if (projectedDifficulty > maxDifficulty && selected.length >= 3) continue;

      // Check if adding this course would exceed workload score threshold
      const projectedWorkload = this.calculateWorkloadScore([...selected, course]);
      if (projectedWorkload > 50 && selected.length >= 4) continue;

      selected.push(course);
      currentCredits += course.credits;
      currentDifficultySum += course.difficultyLevel;
    }

    return selected;
  }

  /**
   * Validate if a semester plan is feasible
   */
  validateSemesterPlan(courses: Course[], userCompletedCourseIds: Set<string>): {
    isValid: boolean;
    errors: string[];
    warnings: string[];
  } {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Check prerequisites
    courses.forEach(course => {
      if (course.prerequisites) {
        course.prerequisites.forEach((prereq: any) => {
          if (!userCompletedCourseIds.has(prereq.prerequisiteId)) {
            errors.push(`Missing prerequisite: ${prereq.prerequisite?.code || 'Unknown'} for ${course.code}`);
          }
        });
      }
    });

    // Check workload constraints
    const totalCredits = courses.reduce((sum, c) => sum + c.credits, 0);
    const avgDifficulty = courses.length > 0
      ? courses.reduce((sum, c) => sum + c.difficultyLevel, 0) / courses.length
      : 0;

    if (totalCredits > 21) {
      errors.push(`Total credits (${totalCredits}) exceeds maximum allowed (21)`);
    }
    if (totalCredits < 9) {
      warnings.push(`Total credits (${totalCredits}) is below recommended minimum (12)`);
    }
    if (avgDifficulty > 4) {
      warnings.push('Very high average difficulty. Consider balancing workload');
    }

    // Check for schedule conflicts (would need actual schedule data)
    // This is a placeholder for future implementation
    
    return {
      isValid: errors.length === 0,
      errors,
      warnings,
    };
  }
}

export default WorkloadBalancer;
