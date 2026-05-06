import { useCallback, useEffect, useMemo, useState } from 'react';
import { getCurriculum, planSemester } from '@/lib/api';
import { useAppStore } from '@/lib/store';
import type { YearSemesterGroup, Course, IntensityMode } from '@/types';
import { CourseCard } from './CourseCard';
import { IntensitySlider } from './IntensitySlider';

interface ElectiveGroup {
  name: string;
  selectCount: number;
  courses: Course[];
  remaining: number;
}

interface SemesterDisplay {
  group: YearSemesterGroup;
  requiredCourses: Course[];
  electiveGroups: ElectiveGroup[];
  requiredCredits: number;
  electiveCredits: number;
}

export const CurriculumProgressMap = () => {
  const [groups, setGroups] = useState<YearSemesterGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [intensityMode, setIntensityMode] = useState<IntensityMode>('normal');
  const [recommendationsEnabled, setRecommendationsEnabled] = useState(true);

  const { toggleCourseComplete, toggleCoursePlanned, completeToPlanned } = useAppStore();
  const completedIds = useAppStore((state) => state.completedIds);
  const plannedIds = useAppStore((state) => state.plannedIds);
  const completedIdsSet = useMemo(() => new Set(completedIds), [completedIds]);
  const plannedIdsSet = useMemo(() => new Set(plannedIds), [plannedIds]);

  const [recommendedIds, setRecommendedIds] = useState<Set<string>>(new Set());
  const [highlightedPrereqIds, setHighlightedPrereqIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    const fetchPlan = async () => {
      if (!recommendationsEnabled) {
        setRecommendedIds(new Set());
        return;
      }
      try {
        const response = await planSemester(intensityMode, completedIds);
        if (response.success && response.data) {
          setRecommendedIds(new Set(response.data.nextRecommendedIds));
        }
      } catch {
        // Planning failure is non-critical, just don't highlight
      }
    };

    fetchPlan();
  }, [intensityMode, completedIds, recommendationsEnabled]);

  useEffect(() => {
    const fetchCurriculum = async () => {
      try {
        const response = await getCurriculum();
        if (response.success && response.data) {
          setGroups(response.data);
        } else {
          setError(response.error || 'Failed to fetch curriculum');
        }
      } catch {
        setError('Failed to connect to server');
      } finally {
        setLoading(false);
      }
    };

    fetchCurriculum();
  }, []);

  const allCourses = useMemo(() => groups.flatMap((g) => g.courses), [groups]);

  const isCourseAvailable = useCallback(
    (course: Course) => {
      return course.prerequisites.every((p) => completedIdsSet.has(p.prerequisiteId));
    },
    [completedIdsSet],
  );

  const handleToggleComplete = useCallback(
    (courseId: string) => {
      toggleCourseComplete(courseId);
    },
    [toggleCourseComplete],
  );

  const handleTogglePlanned = useCallback(
    (courseId: string) => {
      toggleCoursePlanned(courseId);
    },
    [toggleCoursePlanned],
  );

  const handleCompleteToPlanned = useCallback(
    (courseId: string) => {
      completeToPlanned(courseId);
    },
    [completeToPlanned],
  );

  const handlePrereqsHover = useCallback((prereqIds: string[]) => {
    setHighlightedPrereqIds(new Set(prereqIds));
  }, []);

  const handlePrereqsLeave = useCallback(() => {
    setHighlightedPrereqIds(new Set());
  }, []);

  const semesterDisplays = useMemo((): SemesterDisplay[] => {
    return groups.map((group) => {
      const requiredCourses: Course[] = [];
      const electiveByGroup = new Map<string, { selectCount: number; courses: Course[] }>();

      for (const course of group.courses) {
        if (course.electiveGroup) {
          if (!electiveByGroup.has(course.electiveGroup)) {
            electiveByGroup.set(course.electiveGroup, {
              selectCount: course.electiveSelectCount ?? 1,
              courses: [],
            });
          }
          electiveByGroup.get(course.electiveGroup)!.courses.push(course);
        } else {
          requiredCourses.push(course);
        }
      }

      const electiveGroups: ElectiveGroup[] = Array.from(electiveByGroup.entries()).map(
        ([name, data]) => {
          const completedInGroup = data.courses.filter((c) => completedIdsSet.has(c.id)).length;
          return {
            name,
            selectCount: data.selectCount,
            courses: data.courses,
            remaining: Math.max(0, data.selectCount - completedInGroup),
          };
        },
      );

      const requiredCredits = requiredCourses.reduce((sum, c) => sum + c.credits, 0);
      const electiveCredits = electiveGroups.reduce((sum, eg) => {
        if (eg.courses.length > 0 && eg.courses[0].credits) {
          return sum + eg.courses[0].credits * eg.selectCount;
        }
        return sum;
      }, 0);

      return {
        group,
        requiredCourses,
        electiveGroups,
        requiredCredits,
        electiveCredits,
      };
    });
  }, [groups, completedIdsSet]);

  const REQUIRED_CREDITS = 130;
  const REQUIRED_YEARS = 4;

  const completedCredits = useMemo(() => {
    const seenIds = new Set<string>();
    let total = 0;
    for (const course of allCourses) {
      if (completedIdsSet.has(course.id) && !seenIds.has(course.id)) {
        seenIds.add(course.id);
        total += course.credits;
      }
    }
    return total;
  }, [allCourses, completedIdsSet]);

  const plannedCredits = useMemo(() => {
    const seenIds = new Set<string>();
    let total = 0;
    for (const course of allCourses) {
      if (plannedIdsSet.has(course.id) && !seenIds.has(course.id)) {
        seenIds.add(course.id);
        total += course.credits;
      }
    }
    return total;
  }, [allCourses, plannedIdsSet]);

  if (loading) return <div className="p-8 text-center text-gray-500">Loading curriculum...</div>;
  if (error) return <div className="p-8 text-center text-red-600">Error: {error}</div>;

  return (
    <div className="space-y-4 overflow-hidden w-full max-w-full">
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-4 bg-white rounded-lg p-4 border border-gray-200 overflow-hidden">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-gray-700">Recommendations</span>
          <button
            onClick={() => setRecommendationsEnabled(!recommendationsEnabled)}
            className={`relative w-10 h-6 rounded-full transition-colors duration-200 ${
              recommendationsEnabled ? 'bg-blue-500' : 'bg-gray-300'
            }`}
          >
            <span
              className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform duration-200 ${
                recommendationsEnabled ? 'translate-x-4' : 'translate-x-0'
              }`}
            />
          </button>
        </div>

        <IntensitySlider mode={intensityMode} onChange={setIntensityMode} disabled={!recommendationsEnabled} />

        <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-gray-600 min-w-0">
          <span>
            <span className="font-medium">Program:</span>{' '}
            <span className="font-bold text-gray-900">{REQUIRED_YEARS} years, {REQUIRED_CREDITS} credits</span>
          </span>
          <span>
            <span className="font-medium">Completed:</span>{' '}
            <span className="font-bold text-green-600">{completedCredits} / {REQUIRED_CREDITS} credits</span>
          </span>
          <span>
            <span className="font-medium">Planned:</span>{' '}
            <span className={`font-bold ${plannedCredits > 24 ? 'text-red-600' : 'text-blue-600'}`}>
              {plannedCredits} / 24 credits
            </span>
          </span>
        </div>
      </div>

      <div
        className="w-full rounded-lg border border-gray-200 bg-gray-50 overflow-auto"
        style={{ height: 'calc(100vh - 500px)' }}
      >
        <div className="inline-flex gap-3 p-3">
          {semesterDisplays.map(({ group, requiredCourses, electiveGroups, requiredCredits, electiveCredits }) => {
            const semesterLabel =
              group.semester === 1 ? 'Semester 1' : group.semester === 2 ? 'Semester 2' : 'Summer';

            return (
              <div
                key={`${group.year}-${group.semester}`}
                className="w-48 shrink-0"
              >
                <div className="bg-gray-100 rounded-t-lg px-2.5 py-1.5 border-b-2 border-blue-500">
                  <h3 className="font-bold text-sm text-gray-800">
                    Year {group.year} - {semesterLabel}
                  </h3>
                </div>

                <div className="bg-gray-50 rounded-b-lg p-1.5 space-y-1.5 border border-gray-200 border-t-0">
                  {requiredCourses.map((course) => {
                    const isCompleted = completedIdsSet.has(course.id);
                    const isLocked = !isCompleted && !isCourseAvailable(course);
                    const isRecommended = !isCompleted && recommendedIds.has(course.id);
                    const isPlanned = !isCompleted && plannedIdsSet.has(course.id);

                    return (
                      <CourseCard
                        key={course.id}
                        course={course}
                        isCompleted={isCompleted}
                        isPlanned={isPlanned}
                        isLocked={isLocked}
                        isRecommended={isRecommended}
                        isHighlighted={highlightedPrereqIds.has(course.id)}
                        onToggleComplete={handleToggleComplete}
                        onTogglePlanned={handleTogglePlanned}
                        onCompleteToPlanned={handleCompleteToPlanned}
                        onPrereqsHover={handlePrereqsHover}
                        onPrereqsLeave={handlePrereqsLeave}
                      />
                    );
                  })}

                  {electiveGroups.map((eg) => {
                    const completedCourses = eg.courses.filter((c) => completedIdsSet.has(c.id));
                    const isComplete = eg.remaining === 0;

                    if (isComplete) {
                      return (
                        <div key={eg.name} className="mt-2 pt-2 border-t-2 border-dashed border-amber-300">
                          <p className="text-xs font-semibold text-green-700 mb-1.5 truncate">
                            {eg.name.replace(/\s*\(.*?\)\s*/g, '')} ✓
                          </p>
                          {completedCourses.map((course) => (
                            <CourseCard
                              key={`${eg.name}-${course.id}`}
                              course={course}
                              isCompleted={true}
                              isPlanned={false}
                              isLocked={false}
                              isRecommended={false}
                              isHighlighted={highlightedPrereqIds.has(course.id)}
                              onToggleComplete={handleToggleComplete}
                              onTogglePlanned={handleTogglePlanned}
                              onCompleteToPlanned={handleCompleteToPlanned}
                              onPrereqsHover={handlePrereqsHover}
                              onPrereqsLeave={handlePrereqsLeave}
                            />
                          ))}
                        </div>
                      );
                    }

                    return (
                      <div key={eg.name} className="mt-2 pt-2 border-t-2 border-dashed border-amber-300">
                        <div className="flex items-center justify-between mb-1">
                          <p className="text-xs font-semibold text-amber-700 truncate">
                            {eg.name.replace(/\s*\(.*?\)\s*/g, '')}
                          </p>
                          <span className="text-xs font-medium bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded-full shrink-0 ml-1">
                            {eg.remaining}
                          </span>
                        </div>
                        <div className="space-y-1.5">
                          {eg.courses.map((course) => {
                            const isCompleted = completedIdsSet.has(course.id);
                            const isLocked = !isCompleted && !isCourseAvailable(course);
                            const isRecommended = !isCompleted && recommendedIds.has(course.id);
                            const isPlanned = !isCompleted && plannedIdsSet.has(course.id);

                            return (
                              <CourseCard
                                key={`${eg.name}-${course.id}`}
                                course={course}
                                isCompleted={isCompleted}
                                isPlanned={isPlanned}
                                isLocked={isLocked}
                                isRecommended={isRecommended}
                                isHighlighted={highlightedPrereqIds.has(course.id)}
                                onToggleComplete={handleToggleComplete}
                                onTogglePlanned={handleTogglePlanned}
                                onCompleteToPlanned={handleCompleteToPlanned}
                                onPrereqsHover={handlePrereqsHover}
                                onPrereqsLeave={handlePrereqsLeave}
                              />
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
