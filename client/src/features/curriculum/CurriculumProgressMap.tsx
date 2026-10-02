import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getCurriculum } from '@/lib/api';
import { useAppStore } from '@/lib/store';
import { playToggleSound, playRecommendationsSound } from '@/lib/sounds';
import type { YearSemesterGroup, Course, IntensityMode } from '@/types';
import { CourseCard } from './CourseCard';
import { IntensitySlider } from './IntensitySlider';
import { collectCompletedDependents } from './prerequisites';
import { ChevronRight } from 'lucide-react';

const getElectiveGroupLabel = (groupName: string): string => {
  const match = groupName.match(/(\d+)/);
  return match ? parseInt(match[1], 10).toString() : groupName;
};

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

export const CurriculumProgressMap = ({ userId }: { userId?: string }) => {
  const [groups, setGroups] = useState<YearSemesterGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [intensityMode, setIntensityMode] = useState<IntensityMode>('normal');
  const [recommendationsEnabled, setRecommendationsEnabled] = useState(true);

  useEffect(() => {
    const fetchCurriculum = async () => {
      try {
        const response = await getCurriculum();
        if (response.success && response.data) {
          setGroups(response.data);
        } else {
          setError('Could not load the curriculum. Reload the page to try again.');
        }
      } catch {
        setError('Could not connect to the planner. Check your connection, then reload the page.');
      } finally {
        setLoading(false);
      }
    };

    fetchCurriculum();
  }, []);

  const { toggleCourseComplete, toggleCoursePlanned, completeToPlanned, loadProgress,
    progressStatus, progressError, pendingCompletionIds, browserProgressBackup } = useAppStore();
  const progressReady = !userId || progressStatus === 'ready';

  useEffect(() => {
    if (userId) void loadProgress();
  }, [userId, loadProgress]);
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

  const dependencyMap = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const course of allCourses) {
      for (const prereq of course.prerequisites) {
        if (!map.has(prereq.prerequisiteId)) {
          map.set(prereq.prerequisiteId, []);
        }
        map.get(prereq.prerequisiteId)!.push(course.id);
      }
    }
    return map;
  }, [allCourses]);

  const getCascadedUncompleteIds = useCallback(
    (courseId: string, record: Record<string, string | null>) =>
      collectCompletedDependents(courseId, dependencyMap, record),
    [dependencyMap],
  );

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
      const cascadeIds = completedRecord[courseId] !== undefined
        ? getCascadedUncompleteIds(courseId, completedRecord) : [];
      void toggleCourseComplete(courseId, electiveGroup, cascadeIds);
    },
    [toggleCourseComplete, completedRecord, getCascadedUncompleteIds],
  );

  const handleTogglePlanned = useCallback((courseId: string) => {
    void toggleCoursePlanned(courseId);
  }, [toggleCoursePlanned]);

  const handleCompleteToPlanned = useCallback((courseId: string) => {
    void completeToPlanned(courseId, getCascadedUncompleteIds(courseId, completedRecord));
  }, [completeToPlanned, completedRecord, getCascadedUncompleteIds]);

  const handlePrereqsLeave = useCallback(() => {
    setHighlightedPrereqIds(new Set());
    setHoveredLockedId(null);
  }, []);

  const handleElectiveCardClick = useCallback((groupName: string | null) => {
    setActiveElectiveGroup((prev) => prev === groupName ? null : groupName);
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

  useEffect(() => {
    if (activeElectiveGroup && y4s2GpaMode === 'above') {
      const wasY4S2Group = allElectiveGroups.some((eg) => {
        if (eg.name !== activeElectiveGroup) return false;
        return eg.courses.some((c) => {
          const courseGroup = groups.find((g) => g.courses.some((cc) => cc.id === c.id));
          return courseGroup?.year === 4 && courseGroup?.semester === 2;
        });
      });
      if (wasY4S2Group) {
        setActiveElectiveGroup(null);
      }
    }
  }, [y4s2GpaMode, activeElectiveGroup, allElectiveGroups, groups]);

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
    const startYear = currentMonth >= 8 ? now.getFullYear() + 1 : now.getFullYear();
    const startSem = currentMonth >= 8 ? 1 : currentMonth >= 1 ? 2 : 1;

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
      requestAnimationFrame(() => {
        if (!frameRef.current || !contentRef.current) return;
        const fw = frameRef.current.clientWidth;
        const cw = contentRef.current.scrollWidth;
        if (cw === 0) return;
        setBaseScale(Math.max(1, (fw - 24) / (cw - 24)));
        setPan({ x: 0, y: 0 });
      });
    };

    fitToFrame();
    window.addEventListener('resize', fitToFrame);
    return () => window.removeEventListener('resize', fitToFrame);
  }, [groups.length, progressReady]);

  const wasSidebarOpen = useRef(false);

  useEffect(() => {
    const isSidebarOpen = activeElectiveGroup !== null;
    const isOpeningOrClosing = wasSidebarOpen.current !== isSidebarOpen;
    wasSidebarOpen.current = isSidebarOpen;

    if (!isOpeningOrClosing) return;
    if (!frameRef.current || !contentRef.current) return;

    const fw = frameRef.current.clientWidth;
    const cw = contentRef.current.scrollWidth;
    if (cw === 0) return;

    const SIDEBAR_WIDTH = 160;
    const targetWidth = isSidebarOpen ? fw - SIDEBAR_WIDTH : fw;
    setBaseScale(Math.max(1, (targetWidth - 24) / (cw - 24)));
    setPan({ x: 0, y: 0 });

    const timeout = setTimeout(() => {
      if (!frameRef.current || !contentRef.current) return;
      const actualFw = frameRef.current.clientWidth;
      const actualCw = contentRef.current.scrollWidth;
      if (actualCw === 0) return;
      setBaseScale(Math.max(1, (actualFw - 24) / (actualCw - 24)));
    }, 220);
    return () => clearTimeout(timeout);
  }, [activeElectiveGroup]);

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
    if (e.target instanceof HTMLElement && e.target.closest('button, summary')) return;
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

  if (loading || (userId && ['idle', 'loading'].includes(progressStatus))) return (
    <div role="status" className="p-8 text-center text-gray-500">
      {loading ? 'Loading the curriculum…' : 'Loading your saved progress…'}
    </div>
  );
  if (error) return <div role="alert" className="p-8 text-center text-red-600">{error}</div>;

  if (userId && progressStatus === 'error') return (
    <div className="p-8 text-center">
      <p role="alert" className="mb-3 text-red-700">{progressError || 'Could not load your progress.'}</p>
      <p className="mb-3 text-sm text-gray-600">Editing is paused until your saved progress can be loaded.</p>
      <button className="text-primary-700 underline" onClick={() => void loadProgress()}>Reload saved progress</button>
    </div>
  );

  return (
    <div className="space-y-5 overflow-hidden w-full max-w-full">
      {userId ? <p role="status" className="mb-3 text-sm text-gray-600">
        {pendingCompletionIds.size
          ? progressError ? 'Checking saved progress…' : 'Saving progress…'
          : progressError ? 'Showing your latest saved progress. Review it before trying the change again.' : 'Progress saved to your account'}
      </p> : <p className="text-sm text-gray-600">Demo selections stay in this browser and are not added to an account when you sign in.</p>}
      {progressError && <p role="alert" className="mb-3 text-sm text-red-700">{progressError}</p>}
      {browserProgressBackup && <div className="mb-3 text-sm text-gray-600">
        Earlier selections from this browser are backed up separately from your account progress.{' '}
        <button className="text-primary-700 underline" onClick={() => {
          const url = URL.createObjectURL(new Blob([JSON.stringify(browserProgressBackup, null, 2)], { type: 'application/json' }));
          const link = document.createElement('a');
          link.href = url;
          link.download = 'iu-planner-browser-selections.json';
          link.click();
          URL.revokeObjectURL(url);
        }}>Download backup (JSON)</button>
      </div>}
      <div className="flex flex-col sm:flex-row sm:flex-wrap items-stretch sm:items-center gap-5 bg-white rounded-xl p-5 border border-gray-200 overflow-hidden">
        <div className="flex items-center gap-3">
          <span className="text-base font-semibold text-gray-700">Recommendations</span>
          <button
            role="switch"
            aria-label="Recommendations"
            aria-checked={recommendationsEnabled}
            onClick={() => { setRecommendationsEnabled(!recommendationsEnabled); playRecommendationsSound(); }}
            className="relative w-12 h-11 rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-700"
          >
            <span
              aria-hidden="true"
              className={`absolute inset-x-0 top-2.5 h-6 rounded-full transition-colors duration-200 ${
                recommendationsEnabled ? 'bg-blue-500' : 'bg-gray-300'
              }`}
            />
            <span
              aria-hidden="true"
              className={`absolute top-3.5 left-1 w-4 h-4 bg-white rounded-md shadow transition-transform duration-200 ${
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

      <div className="space-y-2 text-sm text-gray-600">
        <p>{recommendationsEnabled
          ? `NEXT highlights suggested courses, up to ${creditsPerSemester} credits per semester.`
          : 'Recommendations are hidden. Turn them on to highlight suggested courses and choose a course load.'}</p>
        <div role="note" aria-label="Planner controls" className="flex flex-wrap gap-x-5 gap-y-1 font-medium">
          <span className="text-green-700">Click a course · mark complete or undo</span>
          <span className="text-blue-700">Right-click · add or remove from plan</span>
          <span className="text-gray-700">Click a locked course · view prerequisites</span>
        </div>
        <p className="text-xs text-gray-600">Right-click a completed course to move it to your plan. Removing a completed prerequisite also removes completion from its dependent courses.</p>
      </div>

      <div className="relative">
        <div
          ref={frameRef}
          className={`relative h-[32rem] sm:h-[38rem] rounded-lg border border-gray-200 bg-gray-50 overflow-x-auto overflow-y-hidden select-none touch-pan-x ${isDragging ? 'cursor-grabbing' : 'cursor-grab'}`}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onWheel={handleWheel}
          onDoubleClick={handleDoubleClick}
        >
        <div
          className="absolute top-0 left-0 z-10 origin-top-left pointer-events-none w-max"
          style={{
            transform: `translateX(${pan.x}px) scale(${scale})`,
            transition: isDragging ? 'none' : 'transform 0.1s ease-out',
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
                  <div className="bg-gray-100 rounded-t-lg px-2.5 py-1.5">
                    <h2 className="font-semibold text-sm text-gray-800">
                      Year {group.year} - {semesterLabel}
                    </h2>
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
                      aria-pressed={y4s2GpaMode === 'above'}
                      title="GPA above 70: show the thesis path"
                      onClick={() => { setY4s2GpaMode('above'); playToggleSound(); }}
                      className={`flex-1 min-h-11 text-xs font-semibold py-1 rounded transition-colors ${
                        y4s2GpaMode === 'above'
                          ? 'bg-blue-600 text-white'
                          : 'bg-gray-200 text-gray-600 hover:bg-gray-300'
                      }`}
                    >
                      GPA {'>'} 70
                    </button>
                    <button
                      aria-pressed={y4s2GpaMode === 'below'}
                      title="GPA at or below 70: show the alternative courses"
                      onClick={() => { setY4s2GpaMode('below'); playToggleSound(); }}
                      className={`flex-1 min-h-11 text-xs font-semibold py-1 rounded transition-colors ${
                        y4s2GpaMode === 'below'
                          ? 'bg-orange-600 text-white'
                          : 'bg-gray-200 text-gray-600 hover:bg-gray-300'
                      }`}
                    >
                      GPA {'<='} 70
                    </button>
                  </div>
                )}

                <div className="bg-gray-50 rounded-b-lg p-1.5 space-y-1.5 border border-gray-200 border-t-0">
                  {visibleRequiredCourses.map((course) => {
                    const isCompleted = completedIdsSet.has(course.id);
                    const isPlanned = !isCompleted && plannedIdsSet.has(course.id);
                    const isRecommended = !isCompleted && recommendedIds.has(course.id);
                    const isLocked = !isCompleted && !isCourseAvailable(course);

                    return (
                      <CourseCard
                        disabled={pendingCompletionIds.size > 0}
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
                    let statusRing = '';
                    if (isComplete) {
                      statusIcon = <span className="text-green-600 font-bold text-[11px]">DONE</span>;
                      borderColor = isActive ? 'border-amber-500' : 'border-green-500';
                    } else if (hasPlanned) {
                      statusIcon = <span className="text-blue-600 font-bold text-[11px]">PLANNED</span>;
                      borderColor = isActive ? 'border-amber-500' : 'border-blue-500';
                      if (!isActive) statusRing = 'ring-2 ring-blue-200';
                    } else if (hasRecommended) {
                      statusIcon = <span className="text-amber-600 font-bold text-[11px]">NEXT</span>;
                      borderColor = isActive ? 'border-amber-500' : 'border-amber-500';
                      if (!isActive) statusRing = 'ring-2 ring-amber-200';
                    }

                    return (
                      <button
                        type="button"
                        aria-expanded={isActive}
                        aria-label={`Open elective group ${getElectiveGroupLabel(eg.name)}: ${completedCount} of ${eg.selectCount} completed`}
                        key={`${eg.name}-summary`}
                        className={`w-full min-h-11 rounded-md border p-2 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-700 ${
                          isActive
                            ? 'bg-amber-100 border-amber-600'
                            : `bg-white ${borderColor} ${statusRing}`
                        }`}
                        onClick={() => handleElectiveCardClick(eg.name)}
                      >
                        <div className="flex items-center justify-between gap-1.5">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className="w-2 h-2 rounded-full shrink-0 bg-amber-500" />
                            <span className="text-[11px] font-bold text-gray-700">Elective Group {getElectiveGroupLabel(eg.name)}</span>
                          </div>
                          {statusIcon}
                        </div>
                        <div className="flex items-center justify-between mt-1">
                          <span className="text-[11px] text-gray-500">{completedCount}/{eg.selectCount} completed</span>
                          {!isActive && <ChevronRight size={12} className="text-gray-400" />}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        <div className="absolute bottom-3 left-3 flex items-center gap-2 bg-white rounded-lg shadow-md px-3 py-1.5 border border-gray-200 z-20 pointer-events-auto">
          <button
            aria-label="Zoom out"
            title="Zoom out"
            onClick={handleZoomOut}
            className="min-w-11 min-h-11 flex items-center justify-center rounded-md hover:bg-gray-100 text-gray-600 font-bold text-lg leading-none"
          >
            −
          </button>
          <span className="text-xs font-medium text-gray-500 w-10 text-center tabular-nums">{Math.round(zoomMultiplier * 100)}%</span>
          <button
            aria-label="Zoom in"
            title="Zoom in"
            onClick={handleZoomIn}
            className="min-w-11 min-h-11 flex items-center justify-center rounded-md hover:bg-gray-100 text-gray-600 font-bold text-lg leading-none"
          >
            +
          </button>
          <div className="w-px h-4 bg-gray-300" />
          <button
            title="Reset the map position and zoom. Course selections stay the same."
            onClick={() => { setPan({ x: 0, y: 0 }); setZoomMultiplier(1); }}
            className="min-h-11 text-xs font-medium text-gray-500 hover:text-gray-700 px-1"
          >
            Reset view
          </button>
        </div>
        </div>

        <div
          className="absolute right-0 top-0 z-30 h-full rounded-lg border border-gray-200 bg-white overflow-hidden shadow-sm transition-[width] duration-200 ease-in-out"
          style={{ width: activeElectiveGroup ? 'min(20rem, 85vw)' : '0px', borderWidth: activeElectiveGroup ? '1px' : '0' }}
        >
          <div className="w-full h-full">
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
              <div className="flex flex-col h-full">
                <div className="flex items-center justify-between px-2.5 py-1.5 bg-gray-50 border-b border-gray-200 shrink-0">
                  <div className="flex items-center gap-2">
                    <h3 className="text-xs font-semibold text-gray-800 whitespace-nowrap">Elective Group {getElectiveGroupLabel(activeGroup.name)}</h3>
                    <span className="text-xs font-medium bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded-full tabular-nums">{completedCount}/{activeGroup.selectCount}</span>
                  </div>
                  <button
                    aria-label="Close elective group"
                    title="Close elective group"
                    onClick={() => handleElectiveCardClick(null)}
                    className="min-w-11 min-h-11 flex items-center justify-center rounded hover:bg-gray-200 text-gray-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-700"
                  >
                    <span className="text-sm leading-none">&times;</span>
                  </button>
                </div>
                <div className="overflow-y-auto p-1.5 space-y-1.5 flex-1">
                  {visibleCourses.map((course) => {
                    const isCompleted = completedRecord[course.id] === activeGroup.name;
                    const isPlanned = !isCompleted && plannedIdsSet.has(course.id);
                    const isRecommended = !isCompleted && recommendedIds.has(course.id);
                    const isLocked = !isCompleted && !isCourseAvailable(course);

                    return (
                      <CourseCard
                        disabled={pendingCompletionIds.size > 0}
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
        </div>
      </div>

      <section aria-labelledby="degree-progress-title" className="rounded-lg border border-gray-200 bg-white p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
          <div>
            <h2 id="degree-progress-title" className="text-lg font-semibold text-gray-900">Degree progress</h2>
            <p className="mt-1 text-sm text-gray-700">Course progress for the selected GPA path</p>
          </div>
          <span className="text-2xl font-semibold text-primary-700 tabular-nums">{degreeProgress}%</span>
        </div>
        <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 border-y border-gray-200 py-3 sm:grid-cols-3">
          <div>
            <dt className="text-xs text-gray-600">Completed courses</dt>
            <dd className="text-lg font-semibold tabular-nums text-gray-900">{completedIdKeys.length}</dd>
          </div>
          <div>
            <dt className="text-xs text-gray-600">Remaining courses</dt>
            <dd className="text-lg font-semibold tabular-nums text-gray-900">{remainingCourses}</dd>
          </div>
          <div>
            <dt className="text-xs text-gray-600">Estimated finish</dt>
            <dd className="text-sm font-semibold text-gray-900">{eta}</dd>
          </div>
        </dl>
        <div
          role="progressbar"
          aria-label="Degree progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={degreeProgress}
          className="mt-4 h-2 overflow-hidden rounded-full bg-gray-200"
        >
          <div className="h-full bg-primary-600" style={{ width: `${degreeProgress}%` }} />
        </div>
        <p className="mt-3 text-sm text-gray-700">The finish estimate uses remaining credits at {creditsPerSemester} credits per semester; prerequisites and course availability may change it.</p>
      </section>
    </div>
  );
};
