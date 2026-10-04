import { Outlet } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';

export function AdminGuard() {
  const { user } = useAuth();
  return user?.role === 'ADMIN' ? (
    <Outlet />
  ) : (
    <p role="alert" className="text-red-700">
      School admin access is required to configure simulation resources.
    </p>
  );
}
