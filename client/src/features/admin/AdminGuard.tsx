import { Link, Outlet } from 'react-router-dom';
import { ErrorBanner } from '@/components/ui';
import { useAuth } from '@/context/AuthContext';

export function AdminGuard() {
  const { user } = useAuth();
  if (user?.role === 'ADMIN') return <Outlet />;
  return (
    <section aria-labelledby="simulation-resources-title" className="max-w-2xl">
      <h2 id="simulation-resources-title" className="text-2xl font-bold text-gray-900">
        Simulation resources
      </h2>
      <ErrorBanner className="mt-3 text-sm text-red-700">
        School admin access is required to configure simulation resources.
      </ErrorBanner>
      <p className="mt-4 text-sm text-gray-700">
        Your own completed courses and selections live in the student pages.
      </p>
      <Link
        to="/curriculum"
        className="mt-2 inline-flex min-h-11 items-center font-semibold text-primary-700 underline"
      >
        Go to My curriculum
      </Link>
    </section>
  );
}
