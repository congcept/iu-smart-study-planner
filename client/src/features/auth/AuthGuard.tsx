import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { LoadingSpinner } from '@/components/ui';
import { useAuth } from '@/context/AuthContext';

export function AuthGuard() {
  const { status } = useAuth();
  const location = useLocation();
  if (status === 'loading') return <LoadingSpinner />;
  if (status !== 'authenticated') {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  return <Outlet />;
}
