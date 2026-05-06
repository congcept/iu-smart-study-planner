import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getCurriculum, getUserProgress, planSemester } from '@/lib/api';
import { useAppStore } from '@/lib/store';
import type { YearSemesterGroup, Course, IntensityMode, StudentRecord } from '@/types';
import { CourseCard } from './CourseCard';
import { IntensitySlider } from './IntensitySlider';
import { ProgressBar } from '@components/ui';
import { GraduationCap, BookOpen, Target, Award, Clock } from 'lucide-react';
import { categoryLabels } from '@/lib/utils';

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

  const [progress, setProgress] = useState<{
    completed: StudentRecord[];
    inProgress: StudentRecord[];
    planned: StudentRecord[];
    available: Course[];
    progress: {
      totalCourses: number;
      completedCourses: number;
      totalCredits: number;
      completedCredits: number;
      percentage: number;
    };
  } | null>(null);

  useEffect(() => {
    const fetchProgress = async () => {
      try {
        const usersResponse = await fetch('/api/users');
        const usersJson = await usersResponse.json();
        if (usersJson.success && usersJson.data && usersJson.data.length > 0) {
          const userId = usersJson.data[0].id;
          const progressResponse = await fetch(`/api/users/${userId}/progress`);
          const progressJson = await progressResponse.json();
          if (progressJson.success && progressJson.data) {
            setProgress(progressJson.data);
          }
        }
      } catch {
        // Progress fetch failure is non-critical
      }
    };
    fetchProgress();
  }, []);

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

  const creditsPerSemester = useMemo(() => {
    switch (intensityMode) {
      case 'low': return 9;
      case 'normal': return 15;
      case 'high': return 18;
      case 'max': return 21;
    }
  }, [intensityMode]);

  const eta = useMemo(() => {
    const remainingCredits = REQUIRED_CREDITS - completedCredits;
    if (remainingCredits <= 0) return 'Completed';
    const semestersNeeded = Math.ceil(remainingCredits / creditsPerSemester);
    const now = new Date();
    const currentMonth = now.getMonth();
    let startYear = currentMonth >= 8 ? now.getFullYear() + 1 : now.getFullYear();
    let startSem = currentMonth >= 8 ? 1 : currentMonth >= 1 ? 2 : 1;

    let sem = startSem;
    let year = startYear;
    for (let i = 0; i < semestersNeeded; i++) {
      if (sem === 3) {
        sem = 1;
        year++;
      } else {
        sem++;
      }
    }

    const semLabels = ['', 'Spring', 'Summer', 'Fall'];
    return `${semLabels[sem]} ${year}`;
  }, [completedCredits, creditsPerSemester]);

  const frameRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [scale, setScale] = useState(1);
  const [isDragging, setIsDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0 });
  const panStart = useRef({ x: 0, y: 0 });

  const clampPan = useCallback((px: number, py: number, s: number) => {
    if (!frameRef.current || !contentRef.current) return { x: px, y: py };
    const fw = frameRef.current.clientWidth;
    const fh = frameRef.current.clientHeight;
    const cw = contentRef.current.scrollWidth * s;
    const ch = contentRef.current.scrollHeight * s;

    const maxX = 0;
    const minX = Math.min(0, fw - cw);
    const maxY = 0;
    const minY = Math.min(0, fh - ch);

    return {
      x: Math.max(minX, Math.min(maxX, px)),
      y: Math.max(minY, Math.min(maxY, py)),
    };
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    setIsDragging(true);
    dragStart.current = { x: e.clientX, y: e.clientY };
    panStart.current = { ...pan };
  }, [pan]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDragging) return;
    const dx = e.clientX - dragStart.current.x;
    const dy = e.clientY - dragStart.current.y;
    const nx = panStart.current.x + dx;
    const ny = panStart.current.y + dy;
    setPan(clampPan(nx, ny, scale));
  }, [isDragging, scale, clampPan]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
    const newScale = Math.min(2, Math.max(1, scale * zoomFactor));

    if (frameRef.current) {
      const rect = frameRef.current.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;

      const nx = cx - (cx - pan.x) * (newScale / scale);
      const ny = cy - (cy - pan.y) * (newScale / scale);
      setPan(clampPan(nx, ny, newScale));
    }

    setScale(newScale);
  }, [scale, pan, clampPan]);

  const handleDoubleClick = useCallback(() => {
    setPan({ x: 0, y: 0 });
    setScale(1);
  }, []);

  useEffect(() => {
    setPan((p) => clampPan(p.x, p.y, scale));
  }, [scale, clampPan]);

  const handleZoomIn = useCallback(() => {
    setScale((s) => {
      const ns = Math.min(2, s * 1.25);
      if (frameRef.current) {
        const fw = frameRef.current.clientWidth;
        const fh = frameRef.current.clientHeight;
        setPan((p) => clampPan(fw / 2 - (fw / 2 - p.x) * (ns / s), fh / 2 - (fh / 2 - p.y) * (ns / s), ns));
      }
      return ns;
    });
  }, [clampPan]);

  const handleZoomOut = useCallback(() => {
    setScale((s) => {
      const ns = Math.max(1, s * 0.8);
      if (frameRef.current) {
        const fw = frameRef.current.clientWidth;
        const fh = frameRef.current.clientHeight;
        setPan((p) => clampPan(fw / 2 - (fw / 2 - p.x) * (ns / s), fh / 2 - (fh / 2 - p.y) * (ns / s), ns));
      }
      return ns;
    });
  }, [clampPan]);

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
          <span>
            <span className="font-medium">ETA:</span>{' '}
            <span className="font-bold text-amber-600">{eta}</span>
          </span>
        </div>
      </div>

      <div
        ref={frameRef}
        className={`relative w-full rounded-lg border border-gray-200 bg-gray-50 overflow-hidden select-none ${isDragging ? 'cursor-grabbing' : 'cursor-grab'}`}
        style={{ height: 'calc(100vh - 500px)' }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onWheel={handleWheel}
        onDoubleClick={handleDoubleClick}
      >
        <div
          className="absolute top-0 left-0 right-0 z-10 origin-top-left pointer-events-none"
          style={{
            transform: `translateX(${pan.x}px) scale(${scale})`,
            transition: isDragging ? 'none' : 'transform 0.1s ease-out',
          }}
        >
          <div className="bg-gray-50/90 backdrop-blur-sm shadow-sm border-b border-gray-200">
            <div className="inline-flex gap-3 p-3 pt-1.5">
            {semesterDisplays.map(({ group }) => {
              const semesterLabel =
                group.semester === 1 ? 'Semester 1' : group.semester === 2 ? 'Semester 2' : 'Summer';
              return (
                <div
                  key={`header-${group.year}-${group.semester}`}
                  className="w-48 shrink-0"
                >
                  <div className="bg-gray-100 rounded-t-lg px-2.5 py-1.5 border-b-2 border-blue-500">
                    <h3 className="font-bold text-sm text-gray-800">
                      Year {group.year} - {semesterLabel}
                    </h3>
                  </div>
                </div>
              );
            })}
            </div>
          </div>
        </div>

        <div
          ref={contentRef}
          className="inline-flex gap-3 p-3 origin-top-left"
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})`,
            transition: isDragging ? 'none' : 'transform 0.1s ease-out',
          }}
        >
          {semesterDisplays.map(({ group, requiredCourses, electiveGroups, requiredCredits, electiveCredits }) => {
            const semesterLabel =
              group.semester === 1 ? 'Semester 1' : group.semester === 2 ? 'Semester 2' : 'Summer';

            return (
              <div
                key={`${group.year}-${group.semester}`}
                className="w-48 shrink-0"
              >
                <div className="bg-gray-100 px-2.5 py-1.5 border-b-2 border-transparent h-[34px]" />

                <div className="bg-gray-50 rounded-b-lg p-1.5 space-y-1.5 border border-gray-200 border-t-0 rounded-t-lg">
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

        <div className="absolute bottom-3 right-3 flex items-center gap-2 bg-white rounded-lg shadow-md px-3 py-1.5 border border-gray-200">
          <button
            onClick={handleZoomOut}
            className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-gray-100 text-gray-600 font-bold text-lg leading-none"
          >
            −
          </button>
          <span className="text-xs font-medium text-gray-500 w-10 text-center">{Math.round(scale * 100)}%</span>
          <button
            onClick={handleZoomIn}
            className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-gray-100 text-gray-600 font-bold text-lg leading-none"
          >
            +
          </button>
          <div className="w-px h-4 bg-gray-300" />
          <button
            onClick={() => { setPan({ x: 0, y: 0 }); setScale(1); }}
            className="text-[10px] font-medium text-gray-500 hover:text-gray-700 px-1"
          >
            Reset
          </button>
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

      {progress && (
        <div className="mt-8 space-y-6">
          <div className="bg-white rounded-lg p-6 border border-gray-200">
            <h3 className="text-lg font-semibold mb-4">Overall Progress</h3>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
              <div className="p-4 bg-blue-50 rounded-lg text-center">
                <GraduationCap size={28} className="mx-auto mb-2 text-blue-600" />
                <div className="text-xl font-bold">{progress.progress.completedCourses}</div>
                <div className="text-sm text-gray-600">Courses Completed</div>
              </div>
              <div className="p-4 bg-green-50 rounded-lg text-center">
                <Award size={28} className="mx-auto mb-2 text-green-600" />
                <div className="text-xl font-bold">{progress.progress.completedCredits}</div>
                <div className="text-sm text-gray-600">Credits Earned</div>
              </div>
              <div className="p-4 bg-amber-50 rounded-lg text-center">
                <Clock size={28} className="mx-auto mb-2 text-amber-600" />
                <div className="text-xl font-bold">{progress.inProgress.length}</div>
                <div className="text-sm text-gray-600">In Progress</div>
              </div>
              <div className="p-4 bg-purple-50 rounded-lg text-center">
                <BookOpen size={28} className="mx-auto mb-2 text-purple-600" />
                <div className="text-xl font-bold">{progress.available.length}</div>
                <div className="text-sm text-gray-600">Available</div>
              </div>
            </div>
            <div className="space-y-4">
              <div>
                <div className="flex justify-between mb-1">
                  <span className="text-sm font-medium text-gray-700">Courses Completed</span>
                  <span className="text-sm text-gray-500">{progress.progress.completedCourses} / {progress.progress.totalCourses}</span>
                </div>
                <ProgressBar progress={progress.progress.completedCourses} max={progress.progress.totalCourses} />
              </div>
              <div>
                <div className="flex justify-between mb-1">
                  <span className="text-sm font-medium text-gray-700">Credits Completed</span>
                  <span className="text-sm text-gray-500">{progress.progress.completedCredits} / {progress.progress.totalCredits}</span>
                </div>
                <ProgressBar progress={progress.progress.completedCredits} max={progress.progress.totalCredits} />
              </div>
            </div>
            <div className="mt-4 p-3 bg-gray-50 rounded-lg flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Target size={18} className="text-blue-600" />
                <span className="font-medium">Degree Progress</span>
              </div>
              <span className="text-xl font-bold text-blue-600">{progress.progress.percentage}%</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
