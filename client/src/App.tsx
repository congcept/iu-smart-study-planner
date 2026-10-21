import { useCallback, useEffect, useState } from 'react';
import { BrowserRouter, NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { GraduationCap } from 'lucide-react';
import { Button, LoadingSpinner } from '@/components/ui';
import { useAuth } from '@/context/AuthContext';
import { AuthProvider } from '@/context/AuthProvider';
import { AuthGuard } from '@/features/auth/AuthGuard';
import { LoginPage } from '@/features/auth/LoginPage';
import { RegisterPage } from '@/features/auth/RegisterPage';
import { authErrorMessage } from '@/features/auth/errors';
import { healthCheck } from './lib/api';
import { CurriculumProgressMap } from './features/curriculum/CurriculumProgressMap';
import { AccountCurriculum } from './features/curriculum/AccountCurriculum';
import { GradeDashboard } from './features/grades/GradeDashboard';
import { RatingDashboard } from './features/ratings/RatingDashboard';
import { PlannerDashboard } from './features/planner/PlannerDashboard';
import { AdminGuard } from './features/admin/AdminGuard';
import { AdminResourceDashboard } from './features/admin/AdminResourceDashboard';

function AppShell() {
  const { user, status, sessionError, refresh, logout } = useAuth();
  const [isLoggingOut, setLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [apiStatus, setApiStatus] = useState<'connected' | 'error'>('connected');

  const initializeApp = useCallback(async () => {
    try {
      setIsLoading(true);
      try {
        await healthCheck();
        setApiStatus('connected');
      } catch {
        setApiStatus('error');
      }
    } catch {
      setApiStatus('error');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    initializeApp();
  }, [initializeApp]);

  if (isLoading || status === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <LoadingSpinner size={48} className="mx-auto mb-4" />
          <p className="text-gray-600">Loading IU Smart Study Planner...</p>
        </div>
      </div>
    );
  }

  const signOut = async () => {
    setLoggingOut(true);
    setLogoutError(null);
    try {
      await logout();
    } catch (error) {
      setLogoutError(authErrorMessage(error, 'Could not sign out. Please try again.'));
    } finally {
      setLoggingOut(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <header className="bg-white shadow-sm border-b px-6 py-4 flex flex-wrap items-center gap-4">
        <GraduationCap size={28} className="text-primary-600" />
        <h1 className="font-bold text-lg text-gray-900">IU Smart Study Planner</h1>
        <nav
          aria-label="Main navigation"
          className="ml-auto flex flex-wrap items-center gap-4 text-sm"
        >
          {user ? (
            <>
              <NavLink
                to="/curriculum"
                className="inline-flex min-h-11 items-center text-primary-700 underline aria-[current=page]:font-bold aria-[current=page]:decoration-2"
              >
                My curriculum
              </NavLink>
              <NavLink
                to="/grades"
                className="inline-flex min-h-11 items-center text-primary-700 underline aria-[current=page]:font-bold aria-[current=page]:decoration-2"
              >
                Grades
              </NavLink>
              <NavLink
                to="/ratings"
                className="inline-flex min-h-11 items-center text-primary-700 underline aria-[current=page]:font-bold aria-[current=page]:decoration-2"
              >
                Ratings
              </NavLink>
              <NavLink
                to="/planner"
                className="inline-flex min-h-11 items-center text-primary-700 underline aria-[current=page]:font-bold aria-[current=page]:decoration-2"
              >
                Planner
              </NavLink>
              {user.role === 'ADMIN' && (
                <NavLink
                  to="/admin"
                  className="inline-flex min-h-11 items-center text-primary-700 underline aria-[current=page]:font-bold aria-[current=page]:decoration-2"
                >
                  Simulation resources
                </NavLink>
              )}
              <span className="text-gray-600">{user.name}</span>
              <span className="rounded-full bg-primary-50 px-2 py-1 text-primary-700">
                {user.role === 'ADMIN' ? 'School admin' : 'Student'}
              </span>
              <Button
                size="sm"
                variant="secondary"
                className="min-h-11"
                isLoading={isLoggingOut}
                onClick={signOut}
              >
                Sign out
              </Button>
            </>
          ) : (
            <>
              <NavLink
                to="/"
                className="inline-flex min-h-11 items-center text-gray-600 underline aria-[current=page]:font-bold aria-[current=page]:decoration-2"
              >
                Demo curriculum
              </NavLink>
              <NavLink
                to="/login"
                className="inline-flex min-h-11 items-center text-primary-700 underline aria-[current=page]:font-bold aria-[current=page]:decoration-2"
              >
                Sign in
              </NavLink>
              <NavLink
                to="/register"
                className="inline-flex min-h-11 items-center text-primary-700 underline aria-[current=page]:font-bold aria-[current=page]:decoration-2"
              >
                Create account
              </NavLink>
            </>
          )}
        </nav>
        {apiStatus === 'error' && (
          <span className="text-sm text-red-600 bg-red-50 px-3 py-1 rounded-full ml-auto">
            Cannot connect to the planner. Reload the page to try again.
          </span>
        )}
      </header>

      <main className="flex-1 p-6 overflow-hidden w-full max-w-full">
        {logoutError && (
          <p role="alert" className="mb-4 text-sm text-red-700">
            {logoutError}
          </p>
        )}
        {sessionError ? (
          <div className="mx-auto max-w-md py-12 text-center">
            <p role="alert" className="mb-4 text-red-700">
              {sessionError}
            </p>
            <Button onClick={() => void refresh()}>Try again</Button>
          </div>
        ) : (
          <>
            <Routes>
              <Route
                path="/"
                element={user ? <Navigate to="/curriculum" replace /> : <CurriculumProgressMap />}
              />
              <Route path="/login" element={<LoginPage />} />
              <Route path="/register" element={<RegisterPage />} />
              <Route element={<AuthGuard />}>
                <Route
                  path="/curriculum"
                  element={user ? <AccountCurriculum key={user.id} userId={user.id} /> : null}
                />
                <Route
                  path="/grades"
                  element={user ? <GradeDashboard key={user.id} userId={user.id} /> : null}
                />
                <Route
                  path="/ratings"
                  element={user ? <RatingDashboard key={user.id} userId={user.id} /> : null}
                />
                <Route
                  path="/planner"
                  element={user ? <PlannerDashboard key={user.id} userId={user.id} /> : null}
                />
                <Route element={<AdminGuard />}>
                  <Route
                    path="/admin"
                    element={
                      user ? <AdminResourceDashboard key={user.id} userId={user.id} /> : null
                    }
                  />
                </Route>
              </Route>
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </>
        )}
      </main>
    </div>
  );
}

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppShell />
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
