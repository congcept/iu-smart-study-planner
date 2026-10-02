import { Navigate, Outlet } from 'react-router-dom';
import { LoadingSpinner } from '@/components/ui';
import { useAuth } from '@/context/AuthContext';

export function AuthGuard() {
  const { status } = useAuth();
  if (status === 'loading') return <LoadingSpinner />;
  if (status !== 'authenticated') return <Navigate to="/login" replace />;
  return <Outlet />;
}
