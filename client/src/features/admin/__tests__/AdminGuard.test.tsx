import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AuthUserDTO } from '@iu-study-planner/shared';
import { AuthContext, type AuthContextValue } from '@/context/AuthContext';
import { AuthGuard } from '@/features/auth/AuthGuard';
import { AdminGuard } from '../AdminGuard';

const admin: AuthUserDTO = {
  id: '11111111-1111-4111-8111-111111111111',
  studentId: 'SIMULATED-ADMIN',
  name: 'Simulation administrator',
  email: 'admin@example.test',
  role: 'ADMIN',
  curriculumId: null,
};
const student: AuthUserDTO = { ...admin, role: 'STUDENT' };
function session(
  user: AuthUserDTO | null,
  status: AuthContextValue['status'] = 'authenticated',
): AuthContextValue {
  return {
    user,
    status,
    sessionError: null,
    refresh: vi.fn(async () => {}),
    login: vi.fn(async () => {}),
    register: vi.fn(async () => {}),
    demoLogin: vi.fn(async () => {}),
    logout: vi.fn(async () => {}),
  };
}
function view(value: AuthContextValue) {
  return (
    <AuthContext.Provider value={value}>
      <MemoryRouter initialEntries={['/admin']}>
        <Routes>
          <Route path="/login" element={<h1>Sign in route</h1>} />
          <Route element={<AuthGuard />}>
            <Route element={<AdminGuard />}>
              <Route path="/admin" element={<button>Save simulation resources</button>} />
            </Route>
          </Route>
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>
  );
}
afterEach(cleanup);

describe('nested admin route guard', () => {
  it('mounts the protected outlet for an authenticated admin', () => {
    render(view(session(admin)));
    expect(screen.getByRole('button', { name: 'Save simulation resources' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('withholds the outlet and explains access for an authenticated student', () => {
    render(view(session(student)));
    expect(screen.getByRole('alert')).toHaveTextContent('School admin access is required');
    expect(
      screen.queryByRole('button', { name: 'Save simulation resources' }),
    ).not.toBeInTheDocument();
  });

  it('fails closed if authenticated context has no account', () => {
    render(view(session(null)));
    expect(screen.getByRole('alert')).toHaveTextContent('School admin access is required');
    expect(
      screen.queryByRole('button', { name: 'Save simulation resources' }),
    ).not.toBeInTheDocument();
  });

  it('lets the authentication parent redirect a signed-out account', () => {
    render(view(session(null, 'unauthenticated')));
    expect(screen.getByRole('heading', { name: 'Sign in route' })).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Save simulation resources' }),
    ).not.toBeInTheDocument();
  });

  it('lets the authentication parent withhold a cached admin account during hydration', () => {
    const { rerender } = render(view(session(admin, 'loading')));
    expect(
      screen.queryByRole('button', { name: 'Save simulation resources' }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    rerender(view(session(admin)));
    expect(screen.getByRole('button', { name: 'Save simulation resources' })).toBeInTheDocument();
  });

  it.each([student, null])(
    'removes the existing admin outlet when account access changes to %j',
    (user) => {
      const { rerender } = render(view(session(admin)));
      expect(screen.getByRole('button', { name: 'Save simulation resources' })).toBeInTheDocument();
      rerender(view(session(user)));
      expect(screen.getByRole('alert')).toHaveTextContent('School admin access is required');
      expect(
        screen.queryByRole('button', { name: 'Save simulation resources' }),
      ).not.toBeInTheDocument();
    },
  );
});
