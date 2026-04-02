import { useCallback, useEffect, useState } from 'react';
import type { Course } from './types';
import { useAppStore } from './lib/store';
import { getCourses, getUsers, healthCheck } from './lib/api';
import { CurriculumGraph } from './features/curriculum/CurriculumGraph';
import { ProgressDashboard } from './features/progress/ProgressDashboard';
import { Recommendations } from './features/recommendations/Recommendations';
import { WorkloadAnalyzer } from './features/planner/WorkloadAnalyzer';
import { Button, Card, LoadingSpinner } from '@components/ui';
import {
  LayoutDashboard,
  GitGraph,
  Lightbulb,
  Calculator,
  GraduationCap,
  Menu,
  X,
  User,
} from 'lucide-react';

function App() {
  const [activeTab, setActiveTab] = useState<
    'dashboard' | 'curriculum' | 'recommendations' | 'planner'
  >('dashboard');
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [selectedCourses, setSelectedCourses] = useState<Course[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [apiStatus, setApiStatus] = useState<'connected' | 'error'>('connected');
  const [activeUserId, setActiveUserId] = useState<string | null>(null);

  const { courses, studentRecords, setCourses, completedCourseIds } = useAppStore();

  const initializeApp = useCallback(async () => {
    try {
      setIsLoading(true);

      try {
        await healthCheck();
        setApiStatus('connected');
      } catch {
        setApiStatus('error');
      }

      const coursesResponse = await getCourses();
      if (coursesResponse.success && coursesResponse.data) {
        setCourses(coursesResponse.data);
      }

      const usersResponse = await getUsers();
      if (
        usersResponse.success &&
        Array.isArray(usersResponse.data) &&
        usersResponse.data.length > 0
      ) {
        setActiveUserId(usersResponse.data[0].id);
      }
    } catch (error) {
      console.error('Failed to initialize app:', error);
    } finally {
      setIsLoading(false);
    }
  }, [setCourses, setApiStatus, setActiveUserId]);

  useEffect(() => {
    initializeApp();
  }, [initializeApp]);

  const handleCourseClick = (course: Course) => {
    // Toggle course selection for workload analyzer
    setSelectedCourses((prev) => {
      const exists = prev.find((c) => c.id === course.id);
      if (exists) {
        return prev.filter((c) => c.id !== course.id);
      }
      return [...prev, course];
    });
  };

  const handleAddToPlan = (course: Course) => {
    setSelectedCourses((prev) => {
      if (!prev.find((c) => c.id === course.id)) {
        return [...prev, course];
      }
      return prev;
    });
    setActiveTab('planner');
  };

  const tabs = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'curriculum', label: 'Curriculum Graph', icon: GitGraph },
    { id: 'recommendations', label: 'Recommendations', icon: Lightbulb },
    { id: 'planner', label: 'Workload Planner', icon: Calculator },
  ];

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <LoadingSpinner size={48} className="mx-auto mb-4" />
          <p className="text-gray-600">Loading IU Smart Study Planner...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 flex">
      {/* Sidebar */}
      <aside
        className={`
          fixed inset-y-0 left-0 z-50 bg-white shadow-lg transition-transform duration-300
          ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'}
          w-64
        `}
      >
        <div className="p-6 border-b">
          <div className="flex items-center gap-3">
            <GraduationCap size={32} className="text-primary-600" />
            <div>
              <h1 className="font-bold text-lg text-gray-900">IU Smart Study</h1>
              <p className="text-xs text-gray-500">Planner</p>
            </div>
          </div>
        </div>

        <nav className="p-4 space-y-1">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() =>
                setActiveTab(tab.id as 'dashboard' | 'curriculum' | 'recommendations' | 'planner')
              }
              className={`
                w-full flex items-center gap-3 px-4 py-3 rounded-lg text-left transition-colors
                ${
                  activeTab === tab.id
                    ? 'bg-primary-50 text-primary-700 font-medium'
                    : 'text-gray-700 hover:bg-gray-100'
                }
              `}
            >
              <tab.icon size={20} />
              {tab.label}
            </button>
          ))}
        </nav>

        <div className="absolute bottom-0 left-0 right-0 p-4 border-t">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-primary-100 flex items-center justify-center">
              <User size={20} className="text-primary-600" />
            </div>
            <div>
              <p className="font-medium text-sm text-gray-900">Guest User</p>
              <p className="text-xs text-gray-500">Student</p>
            </div>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main
        className={`
          flex-1 transition-all duration-300
          ${isSidebarOpen ? 'ml-64' : 'ml-0'}
        `}
      >
        {/* Header */}
        <header className="bg-white shadow-sm border-b sticky top-0 z-40">
          <div className="px-6 py-4 flex items-center justify-between">
            <div className="flex items-center gap-4">
              <button
                onClick={() => setIsSidebarOpen(!isSidebarOpen)}
                className="p-2 hover:bg-gray-100 rounded-lg"
              >
                {isSidebarOpen ? <X size={20} /> : <Menu size={20} />}
              </button>
              <h2 className="text-xl font-semibold text-gray-900">
                {tabs.find((t) => t.id === activeTab)?.label}
              </h2>
            </div>

            <div className="flex items-center gap-3">
              {apiStatus === 'error' && (
                <span className="text-sm text-red-600 bg-red-50 px-3 py-1 rounded-full">
                  API Disconnected
                </span>
              )}
              <Button size="sm" variant="secondary">
                Help
              </Button>
            </div>
          </div>
        </header>

        {/* Content Area */}
        <div className="p-6">
          {activeTab === 'dashboard' && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="lg:col-span-2">
                {activeUserId ? (
                  <ProgressDashboard userId={activeUserId} />
                ) : (
                  <Card title="Progress Dashboard">
                    <div className="text-center py-8 text-gray-500">
                      <p>No user found. Seed data or create a user to view progress.</p>
                    </div>
                  </Card>
                )}
              </div>
              <div>
                <Card title="Quick Stats">
                  <div className="space-y-4">
                    <div className="flex justify-between items-center p-3 bg-gray-50 rounded-lg">
                      <span className="text-gray-600">Total Courses</span>
                      <span className="font-bold text-xl">{courses.length}</span>
                    </div>
                    <div className="flex justify-between items-center p-3 bg-gray-50 rounded-lg">
                      <span className="text-gray-600">Prerequisites</span>
                      <span className="font-bold text-xl">
                        {courses.reduce((sum, c) => sum + c.prerequisites.length, 0)}
                      </span>
                    </div>
                    <div className="flex justify-between items-center p-3 bg-gray-50 rounded-lg">
                      <span className="text-gray-600">Completed</span>
                      <span className="font-bold text-xl text-green-600">
                        {completedCourseIds().length}
                      </span>
                    </div>
                  </div>
                </Card>
              </div>
            </div>
          )}

          {activeTab === 'curriculum' && (
            <div className="space-y-6">
              <Card
                title="Curriculum Dependency Graph"
                subtitle="Visualize course prerequisites and dependencies"
              >
                <CurriculumGraph
                  courses={courses}
                  completedCourseIds={completedCourseIds()}
                  inProgressCourseIds={studentRecords
                    .filter((r) => r.status === 'IN_PROGRESS')
                    .map((r) => r.courseId)}
                  onCourseClick={handleCourseClick}
                  height="700px"
                />
              </Card>

              {selectedCourses.length > 0 && (
                <Card title="Selected Courses">
                  <div className="flex flex-wrap gap-2">
                    {selectedCourses.map((course) => (
                      <span
                        key={course.id}
                        className="px-3 py-1 bg-primary-100 text-primary-700 rounded-full text-sm font-medium"
                      >
                        {course.code}
                      </span>
                    ))}
                  </div>
                  <p className="text-sm text-gray-500 mt-2">
                    {selectedCourses.length} course(s) selected. Go to Workload Planner to analyze.
                  </p>
                </Card>
              )}
            </div>
          )}

          {activeTab === 'recommendations' && (
            <div className="max-w-4xl mx-auto">
              {activeUserId ? (
                <Recommendations
                  userId={activeUserId}
                  onAddToPlan={handleAddToPlan}
                  addedCourseIds={selectedCourses.map((c) => c.id)}
                />
              ) : (
                <Card title="Smart Recommendations">
                  <div className="text-center py-8 text-gray-500">
                    <p>No user found. Seed data or create a user to get recommendations.</p>
                  </div>
                </Card>
              )}
            </div>
          )}

          {activeTab === 'planner' && (
            <div className="max-w-4xl mx-auto">
              <WorkloadAnalyzer
                selectedCourses={selectedCourses}
                onClear={() => setSelectedCourses([])}
              />
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

export default App;
