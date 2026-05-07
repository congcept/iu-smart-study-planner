import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getCurriculum, getUserProgress, planSemester } from '@/lib/api';
import { useAppStore } from '@/lib/store';
import { playToggleSound, playRecommendationsSound } from '@/lib/sounds';
import type { YearSemesterGroup, Course, IntensityMode, StudentRecord } from '@/types';
import { CourseCard } from './CourseCard';
import { IntensitySlider } from './IntensitySlider';
import { GraduationCap, BookOpen, Target, ListChecks, Layers, ChevronRight } from 'lucide-react';
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

  const { toggleCourseComplete, toggleCoursePlanned, completeToPlanned } = useAppStore();
  const completedRecord = useAppStore((state) => state.completedIds);
  const plannedIds = useAppStore((state) => state.plannedIds);
  const completedIdKeys = useMemo(() => Object.keys(completedRecord), [completedRecord]);
  const completedIdsSet = useMemo(() => new Set(completedIdKeys), [completedIdKeys]);
  const plannedIdsSet = useMemo(() => new Set(plannedIds), [plannedIds]);

  const [recommendedIds, setRecommendedIds] = useState<Set<string>>(new Set());
  const [highlightedPrereqIds, setHighlightedPrereqIds] = useState<Set<string>>(new Set());
  const [hoveredLockedId, setHoveredLockedId] = useState<string | null>(null);
  const [activeElectiveGroup, setActiveElectiveGroup] = useState<string | null>(null);
  const [y4s2GpaMode, setY4s2GpaMode] = useState<'above' | 'below'>('above');

  const handlePrereqsHover = useCallback((courseId: string, prereqIds: string[]) => {
    setHighlightedPrereqIds(new Set(prereqIds));
    setHoveredLockedId(courseId);
  }, []);

  const allCourses = useMemo(() => groups.flatMap((g) => g.courses), [groups]);

  const isY4S2ThesisMode = y4s2GpaMode === 'above';

  const creditsPerSemester = useMemo(() => {
    switch (intensityMode) {
      case 'low': return 9;
      case 'normal': return 15;
      case 'high': return 18;
      case 'max': return 21;
    }
  }, [intensityMode]);

  useEffect(() => {
    if (!recommendationsEnabled) {
      setRecommendedIds(new Set());
      return;
    }

    const availableCourses = allCourses.filter(
      (c) => !completedIdsSet.has(c.id),
    );

    const unlockedCourses = availableCourses.filter((c) =>
      c.prerequisites.every((p) => completedIdsSet.has(p.prerequisiteId)),
    );

    unlockedCourses.sort((a, b) => {
      const aGroup = groups.find((g) => g.courses.some((c) => c.id === a.id));
      const bGroup = groups.find((g) => g.courses.some((c) => c.id === b.id));
      if (!aGroup || !bGroup) return 0;
      if (aGroup.year !== bGroup.year) return aGroup.year - bGroup.year;
      if (aGroup.semester !== bGroup.semester) return aGroup.semester - bGroup.semester;
      return a.code.localeCompare(b.code);
    });

    const recommended: string[] = [];
    let totalCredits = 0;

    for (const course of unlockedCourses) {
      if (isY4S2ThesisMode) {
        const courseGroup = groups.find((g) => g.courses.some((c) => c.id === course.id));
        if (courseGroup && courseGroup.year === 4 && courseGroup.semester === 2 && course.code !== 'IT058IU') {
          continue;
        }
      }

      if (totalCredits + course.credits <= creditsPerSemester) {
        recommended.push(course.id);
        totalCredits += course.credits;
      }

      if (totalCredits >= creditsPerSemester) break;
    }

    setRecommendedIds(new Set(recommended));
  }, [allCourses, completedIdsSet, recommendationsEnabled, isY4S2ThesisMode, groups, creditsPerSemester]);

  const isCourseAvailable = useCallback(
    (course: Course) => {
      return course.prerequisites.every((p) => completedIdsSet.has(p.prerequisiteId));
    },
    [completedIdsSet],
  );

  const handleToggleComplete = useCallback(
    (courseId: string, electiveGroup?: string | null) => {
      if (plannedIdsSet.has(courseId)) {
        toggleCoursePlanned(courseId);
      }
      toggleCourseComplete(courseId, electiveGroup);
    },
    [toggleCourseComplete, toggleCoursePlanned, plannedIdsSet],
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

  const handlePrereqsLeave = useCallback(() => {
    setHighlightedPrereqIds(new Set());
    setHoveredLockedId(null);
  }, []);

  const handleElectiveCardClick = useCallback((groupName: string | null) => {
    setActiveElectiveGroup((prev) => prev === groupName ? null : groupName);
  }, []);

  useEffect(() => {
    if (activeElectiveGroup && y4s2GpaMode === 'above') {
      const activeGroup = filteredElectiveGroups.find((eg) => eg.name === activeElectiveGroup);
      if (activeGroup) {
        const isY4S2Group = activeGroup.courses.some((c) => {
          const courseGroup = groups.find((g) => g.courses.some((cc) => cc.id === c.id));
          return courseGroup?.year === 4 && courseGroup?.semester === 2;
        });
        if (isY4S2Group) {
          setActiveElectiveGroup(null);
        }
      }
    }
  }, [y4s2GpaMode, activeElectiveGroup, filteredElectiveGroups, groups]);

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
          const completedInGroup = data.courses.filter(
            (c) => completedRecord[c.id] === name,
          ).length;
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
  }, [groups, completedRecord]);

  const allElectiveGroups = useMemo((): ElectiveGroup[] => {
    const result: ElectiveGroup[] = [];
    for (const sd of semesterDisplays) {
      for (const eg of sd.electiveGroups) {
        result.push(eg);
      }
    }
    return result;
  }, [semesterDisplays]);

  const filteredElectiveGroups = useMemo((): ElectiveGroup[] => {
    return allElectiveGroups.filter((eg) => {
      if (isY4S2ThesisMode) {
        const isY4S2Group = eg.courses.some((c) => {
          const courseGroup = groups.find((g) => g.courses.some((cc) => cc.id === c.id));
          return courseGroup?.year === 4 && courseGroup?.semester === 2;
        });
        if (isY4S2Group) return false;
      }
      return true;
    });
  }, [allElectiveGroups, isY4S2ThesisMode, groups]);

  const REQUIRED_CREDITS = 130;
  const REQUIRED_YEARS = 4;

  const NON_CREDIT_COURSE_IDS = useMemo(() => new Set(['PT001IU', 'PT002IU']), []);

  const completedCredits = useMemo(() => {
    const seenIds = new Set<string>();
    let total = 0;
    for (const course of allCourses) {
      if (completedRecord[course.id] !== undefined && !seenIds.has(course.id) && !NON_CREDIT_COURSE_IDS.has(course.code)) {
        seenIds.add(course.id);
        total += course.credits;
      }
    }
    return total;
  }, [allCourses, completedRecord, NON_CREDIT_COURSE_IDS]);

  const plannedCredits = useMemo(() => {
    const seenIds = new Set<string>();
    let total = 0;
    for (const course of allCourses) {
      if (plannedIdsSet.has(course.id) && !completedIdsSet.has(course.id) && !seenIds.has(course.id)) {
        seenIds.add(course.id);
        total += course.credits;
      }
    }
    return total;
  }, [allCourses, plannedIdsSet, completedIdsSet]);

  const remainingCourses = useMemo(() => {
    const target = y4s2GpaMode === 'above' ? 41 : 43;
    return Math.max(0, target - completedIdKeys.length);
  }, [completedIdKeys, y4s2GpaMode]);

  const degreeProgress = useMemo(() => {
    const target = y4s2GpaMode === 'above' ? 41 : 43;
    return Math.min(100, Math.round((completedIdKeys.length / target) * 100));
  }, [completedIdKeys, y4s2GpaMode]);

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
  const [baseScale, setBaseScale] = useState(1);
  const [zoomMultiplier, setZoomMultiplier] = useState(1);
  const scale = baseScale * zoomMultiplier;
  const [isDragging, setIsDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0 });
  const panStart = useRef({ x: 0, y: 0 });

  useEffect(() => {
    const fitToFrame = () => {
      const raf = requestAnimationFrame(() => {
        if (!frameRef.current || !contentRef.current) return;
        const fw = frameRef.current.clientWidth;
        const cw = contentRef.current.scrollWidth;
        if (cw === 0) return;
        setBaseScale((fw - 24) / (cw - 24));
        setPan({ x: 0, y: 0 });
      });
    };

    fitToFrame();
    window.addEventListener('resize', fitToFrame);
    return () => window.removeEventListener('resize', fitToFrame);
  }, [groups.length, activeElectiveGroup]);

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
    const newZoom = Math.min(2, Math.max(1, zoomMultiplier * zoomFactor));

    if (frameRef.current) {
      const rect = frameRef.current.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;

      const nx = cx - (cx - pan.x) * (newZoom / zoomMultiplier);
      const ny = cy - (cy - pan.y) * (newZoom / zoomMultiplier);
      setPan(clampPan(nx, ny, baseScale * newZoom));
    }

    setZoomMultiplier(newZoom);
  }, [baseScale, zoomMultiplier, pan, clampPan]);

  const handleDoubleClick = useCallback(() => {
    setPan({ x: 0, y: 0 });
    setZoomMultiplier(1);
  }, []);

  useEffect(() => {
    setPan((p) => clampPan(p.x, p.y, scale));
  }, [scale, clampPan]);

  const handleZoomIn = useCallback(() => {
    setZoomMultiplier((z) => {
      const nz = Math.min(2, z * 1.25);
      if (frameRef.current) {
        const fw = frameRef.current.clientWidth;
        const fh = frameRef.current.clientHeight;
        setPan((p) => clampPan(fw / 2 - (fw / 2 - p.x) * (nz / z), fh / 2 - (fh / 2 - p.y) * (nz / z), baseScale * nz));
      }
      return nz;
    });
  }, [baseScale, clampPan]);

  const handleZoomOut = useCallback(() => {
    setZoomMultiplier((z) => {
      const nz = Math.max(1, z * 0.8);
      if (frameRef.current) {
        const fw = frameRef.current.clientWidth;
        const fh = frameRef.current.clientHeight;
        setPan((p) => clampPan(fw / 2 - (fw / 2 - p.x) * (nz / z), fh / 2 - (fh / 2 - p.y) * (nz / z), baseScale * nz));
      }
      return nz;
    });
  }, [baseScale, clampPan]);

  if (loading) return <div className="p-8 text-center text-gray-500">Loading curriculum...</div>;
  if (error) return <div className="p-8 text-center text-red-600">Error: {error}</div>;

  return (
    <div className="space-y-5 overflow-hidden w-full max-w-full">
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-5 bg-white rounded-xl p-5 border border-gray-200 overflow-hidden">
        <div className="flex items-center gap-3">
          <span className="text-base font-semibold text-gray-700">Recommendations</span>
          <button
            onClick={() => { setRecommendationsEnabled(!recommendationsEnabled); playRecommendationsSound(); }}
            className={`relative w-12 h-6 rounded-lg transition-colors duration-200 ${
              recommendationsEnabled ? 'bg-blue-500' : 'bg-gray-300'
            }`}
          >
            <span
              className={`absolute top-1 left-1 w-4 h-4 bg-white rounded-md shadow transition-transform duration-200 ${
                recommendationsEnabled ? 'translate-x-6' : 'translate-x-0'
              }`}
            />
          </button>
        </div>

        <IntensitySlider mode={intensityMode} onChange={setIntensityMode} disabled={!recommendationsEnabled} />

        <div className="flex flex-wrap gap-x-5 gap-y-2 text-base text-gray-600 min-w-0">
          <span>
            <span className="font-semibold">Program:</span>{' '}
            <span className="font-bold text-gray-900 tabular-nums">{REQUIRED_YEARS} years, {REQUIRED_CREDITS} credits</span>
          </span>
          <span>
            <span className="font-semibold">Completed:</span>{' '}
            <span className="font-bold text-green-600 tabular-nums">{completedCredits} / {REQUIRED_CREDITS} credits</span>
          </span>
          <span>
            <span className="font-semibold">Planned:</span>{' '}
            <span className={`font-bold tabular-nums ${plannedCredits > 24 ? 'text-red-600' : 'text-blue-600'}`}>
              {plannedCredits} / 24 credits
            </span>
          </span>
        </div>
      </div>

      <div className="flex gap-3">
        <div
          ref={frameRef}
          className={`relative flex-1 rounded-lg border border-gray-200 bg-gray-50 overflow-hidden select-none ${isDragging ? 'cursor-grabbing' : 'cursor-grab'}`}
          style={{ height: 'calc(100vh - 500px)' }}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onWheel={handleWheel}
          onDoubleClick={handleDoubleClick}
        >
        <div
          className="absolute top-0 left-0 z-10 origin-top-left pointer-events-none"
          style={{
            transform: `translateX(${pan.x}px) scale(${scale})`,
            transition: isDragging ? 'none' : 'transform 0.1s ease-out',
            width: '99999px',
          }}
        >
          <div className="bg-gray-50/90 backdrop-blur-sm shadow-sm border-b border-gray-200 w-full">
            <div className="inline-flex gap-3 px-3 pt-0 pb-0">
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
          className="inline-flex gap-3 pt-1 px-3 pb-3 origin-top-left"
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})`,
            transition: isDragging ? 'none' : 'transform 0.1s ease-out',
          }}
        >
          {semesterDisplays.map(({ group, requiredCourses, electiveGroups }) => {
            const semesterLabel =
              group.semester === 1 ? 'Semester 1' : group.semester === 2 ? 'Semester 2' : 'Summer';

            const isY4S2 = group.year === 4 && group.semester === 2;
            const visibleRequiredCourses = isY4S2
              ? y4s2GpaMode === 'above'
                ? requiredCourses.filter((c) => c.code === 'IT058IU')
                : requiredCourses.filter((c) => c.code !== 'IT058IU')
              : requiredCourses;
            const visibleElectiveGroups = isY4S2 && y4s2GpaMode === 'above' ? [] : electiveGroups;

            return (
              <div
                key={`${group.year}-${group.semester}`}
                className="w-48 shrink-0"
              >
                <div className="bg-gray-100 px-2.5 py-1.5 border-b-2 border-transparent h-[34px]" />

                {group.year === 4 && group.semester === 2 && (
                  <div className={`flex gap-1 mt-1 mb-1 px-1 transition-all duration-150 ${hoveredLockedId !== null ? 'blur-[1px] opacity-25' : ''}`}>
                    <button
                      onClick={() => { setY4s2GpaMode('above'); playToggleSound(); }}
                      className={`flex-1 text-[10px] font-semibold py-1 rounded transition-colors ${
                        y4s2GpaMode === 'above'
                          ? 'bg-blue-600 text-white'
                          : 'bg-gray-200 text-gray-600 hover:bg-gray-300'
                      }`}
                    >
                      GPA {'>'} 70
                    </button>
                    <button
                      onClick={() => { setY4s2GpaMode('below'); playToggleSound(); }}
                      className={`flex-1 text-[10px] font-semibold py-1 rounded transition-colors ${
                        y4s2GpaMode === 'below'
                          ? 'bg-orange-600 text-white'
                          : 'bg-gray-200 text-gray-600 hover:bg-gray-300'
                      }`}
                    >
                      GPA {'<='} 70
                    </button>
                  </div>
                )}

                <div className="bg-gray-50 rounded-b-lg p-1.5 space-y-1.5 border border-gray-200 border-t-0 rounded-t-lg">
                  {visibleRequiredCourses.map((course) => {
                    const isCompleted = completedIdsSet.has(course.id);
                    const isPlanned = !isCompleted && plannedIdsSet.has(course.id);
                    const isRecommended = !isCompleted && recommendedIds.has(course.id);
                    const isLocked = !isCompleted && !isPlanned && !isCourseAvailable(course);

                    return (
                      <CourseCard
                        key={course.id}
                        course={course}
                        isCompleted={isCompleted}
                        isPlanned={isPlanned}
                        isLocked={isLocked}
                        isRecommended={isRecommended}
                        isHighlighted={highlightedPrereqIds.has(course.id)}
                        isBlurred={hoveredLockedId !== null && hoveredLockedId !== course.id && !highlightedPrereqIds.has(course.id)}
                        onToggleComplete={handleToggleComplete}
                        onTogglePlanned={handleTogglePlanned}
                        onCompleteToPlanned={handleCompleteToPlanned}
                        onPrereqsHover={(prereqIds) => handlePrereqsHover(course.id, prereqIds)}
                        onPrereqsLeave={handlePrereqsLeave}
                      />
                    );
                  })}

                  {visibleElectiveGroups.map((eg) => {
                    const completedCount = eg.courses.filter((c) => completedRecord[c.id] === eg.name).length;
                    const hasRecommended = eg.courses.some((c) => recommendedIds.has(c.id) && completedRecord[c.id] !== eg.name);
                    const hasPlanned = eg.courses.some((c) => plannedIdsSet.has(c.id) && completedRecord[c.id] !== eg.name);
                    const isComplete = eg.remaining === 0;
                    const isActive = activeElectiveGroup === eg.name;

                    let statusIcon = null;
                    let borderColor = 'border-gray-300';
                    let hoverBorder = 'hover:border-violet-500';
                    let statusRing = '';
                    if (isComplete) {
                      statusIcon = <span className="text-green-600 font-bold text-[11px]">DONE</span>;
                      borderColor = isActive ? 'border-violet-500' : 'border-green-500';
                      hoverBorder = isActive ? 'hover:border-violet-600' : 'hover:border-green-600';
                    } else if (hasPlanned) {
                      statusIcon = <span className="text-blue-600 font-bold text-[11px]">PLANNED</span>;
                      borderColor = isActive ? 'border-violet-500' : 'border-blue-500';
                      hoverBorder = isActive ? 'hover:border-violet-600' : 'hover:border-blue-600';
                      if (!isActive) statusRing = 'ring-2 ring-blue-200';
                    } else if (hasRecommended) {
                      statusIcon = <span className="text-amber-600 font-bold text-[11px]">NEXT</span>;
                      borderColor = isActive ? 'border-violet-500' : 'border-amber-500';
                      hoverBorder = isActive ? 'hover:border-violet-600' : 'hover:border-amber-600';
                      if (!isActive) statusRing = 'ring-2 ring-amber-200';
                    }

                    return (
                      <div
                        key={`${eg.name}-summary`}
                        className={`bg-white rounded-md shadow-sm border-2 p-2 ${borderColor} ${hoverBorder} ${statusRing} transition-all duration-150 hover:shadow-md hover:scale-[1.02] cursor-pointer`}
                        onClick={() => handleElectiveCardClick(eg.name)}
                      >
                        <div className="flex items-center justify-between gap-1.5">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className="w-2 h-2 rounded-full shrink-0 bg-amber-500" />
                            <span className="text-[11px] font-bold text-gray-700 truncate">{eg.name.replace(/\s*\(.*?\)\s*/g, '')}</span>
                          </div>
                          {statusIcon}
                        </div>
                        <div className="flex items-center justify-between mt-1">
                          <span className="text-[11px] text-gray-500">{completedCount}/{eg.selectCount}</span>
                          <ChevronRight size={12} className={`text-gray-400 transition-transform ${isActive ? 'rotate-90' : ''}`} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        <div className="absolute bottom-3 left-3 flex items-center gap-2 bg-white rounded-lg shadow-md px-3 py-1.5 border border-gray-200 z-20 pointer-events-auto">
          <button
            onClick={handleZoomOut}
            className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-gray-100 text-gray-600 font-bold text-lg leading-none"
          >
            −
          </button>
          <span className="text-xs font-medium text-gray-500 w-10 text-center tabular-nums">{Math.round(zoomMultiplier * 100)}%</span>
          <button
            onClick={handleZoomIn}
            className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-gray-100 text-gray-600 font-bold text-lg leading-none"
          >
            +
          </button>
          <div className="w-px h-4 bg-gray-300" />
          <button
            onClick={() => { setPan({ x: 0, y: 0 }); setZoomMultiplier(1); }}
            className="text-[10px] font-medium text-gray-500 hover:text-gray-700 px-1"
          >
            Reset
          </button>
        </div>
        </div>

        {activeElectiveGroup && (() => {
          const activeGroup = filteredElectiveGroups.find((eg) => eg.name === activeElectiveGroup);
          if (!activeGroup) return null;

          const completedCourses = activeGroup.courses.filter((c) => completedRecord[c.id] === activeGroup.name);
          const isComplete = activeGroup.remaining === 0;
          const completedCount = completedCourses.length;

          const visibleCourses = isComplete
            ? completedCourses
            : activeGroup.courses.filter((c) => {
                const claimedGroup = completedRecord[c.id];
                return claimedGroup === undefined || claimedGroup === activeGroup.name;
              });

          return (
            <div className="w-40 shrink-0 rounded-lg border border-gray-200 bg-white overflow-hidden shadow-sm" style={{ height: 'calc(100vh - 500px)' }}>
              <div className="flex items-center justify-between px-2.5 py-2 bg-gray-50 border-b border-gray-200">
                <div className="flex items-center gap-2">
                  <Layers size={14} className="text-amber-600" />
                  <h3 className="text-xs font-semibold text-gray-800 truncate">{activeGroup.name.replace(/\s*\(.*?\)\s*/g, '')}</h3>
                </div>
                <button
                  onClick={() => handleElectiveCardClick(null)}
                  className="w-5 h-5 flex items-center justify-center rounded hover:bg-gray-200 text-gray-500"
                >
                  <span className="text-sm leading-none">&times;</span>
                </button>
              </div>
              <div className="overflow-y-auto p-1.5 space-y-1.5" style={{ height: 'calc(100% - 40px)' }}>
                <div className="flex items-center justify-between mb-1 px-1">
                  <p className={`text-xs font-semibold truncate ${isComplete ? 'text-green-700' : 'text-amber-700'}`}>
                    {completedCount}/{activeGroup.selectCount}
                  </p>
                </div>
                {visibleCourses.map((course) => {
                  const isCompleted = completedRecord[course.id] === activeGroup.name;
                  const isPlanned = !isCompleted && plannedIdsSet.has(course.id);
                  const isRecommended = !isCompleted && recommendedIds.has(course.id);
                  const isLocked = !isCompleted && !isPlanned && !isCourseAvailable(course);

                  return (
                    <CourseCard
                      key={`${activeGroup.name}-${course.id}`}
                      course={course}
                      isCompleted={isCompleted}
                      isPlanned={isPlanned}
                      isLocked={isLocked}
                      isRecommended={isRecommended}
                      isHighlighted={highlightedPrereqIds.has(course.id)}
                      isBlurred={hoveredLockedId !== null && hoveredLockedId !== course.id && !highlightedPrereqIds.has(course.id)}
                      onToggleComplete={() => handleToggleComplete(course.id, activeGroup.name)}
                      onTogglePlanned={handleTogglePlanned}
                      onCompleteToPlanned={handleCompleteToPlanned}
                      onPrereqsHover={(prereqIds) => handlePrereqsHover(course.id, prereqIds)}
                      onPrereqsLeave={handlePrereqsLeave}
                    />
                  );
                })}
              </div>
            </div>
          );
        })()}
      </div>

      {progress && (
        <div className="mt-10 space-y-6">
          <div className="bg-white rounded-xl p-6 border border-gray-200 shadow-sm">
            <div className="flex items-start gap-8">
              <div className="shrink-0">
                <div className="flex items-center gap-2.5 mb-2">
                  <ListChecks size={20} className="text-blue-600" />
                  <span className="text-lg font-semibold text-gray-700">Courses Progress</span>
                </div>
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-3 px-4 py-3 bg-blue-50 rounded-xl shrink-0">
                    <GraduationCap size={24} className="text-blue-600" />
                    <div className="flex items-baseline gap-1.5 tabular-nums">
                      <div className="text-xl font-bold">{completedIdKeys.length}</div>
                      <div className="text-sm text-gray-600">Completed</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 px-4 py-3 bg-purple-50 rounded-xl shrink-0">
                    <BookOpen size={24} className="text-purple-600" />
                    <div className="flex items-baseline gap-1.5 tabular-nums">
                      <div className="text-xl font-bold">{remainingCourses}</div>
                      <div className="text-sm text-gray-600">Remaining</div>
                    </div>
                  </div>
                </div>
              </div>
              <div className="flex-1">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2.5">
                    <Target size={20} className="text-blue-600" />
                    <span className="text-lg font-semibold">Degree Progress</span>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className="text-sm font-medium text-gray-900 tabular-nums">ETA: <span className="font-bold text-amber-600">{eta}</span></span>
                    <span className="text-3xl font-bold text-blue-600 tabular-nums">{degreeProgress}%</span>
                  </div>
                </div>
                <div className="w-full bg-gray-200 rounded-xl h-8 overflow-hidden">
                  <div
                    className="bg-blue-600 h-8 rounded-xl transition-all duration-500 progress-liquid"
                    style={{ width: `${degreeProgress}%` }}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
