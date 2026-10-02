import '@testing-library/jest-dom/vitest';
import { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthUserDTO } from '@iu-study-planner/shared';
import App from '@/App';
import * as api from '@/lib/api';
import { useAppStore } from '@/lib/store';

vi.mock('@/lib/api', () => ({
  healthCheck: vi.fn(),
  getSession: vi.fn(),
  login: vi.fn(),
  register: vi.fn(),
  logout: vi.fn(),
}));
vi.mock('@/features/curriculum/CurriculumProgressMap', () => ({
  CurriculumProgressMap: ({ userId }: { userId?: string }) => (
    <div data-testid="curriculum">{userId || 'Demo curriculum content'}</div>
  ),
}));

const student: AuthUserDTO = {
  id: 'student-a',
  studentId: 'IT123',
  name: 'Alice Student',
  email: 'alice@example.test',
  role: 'STUDENT',
};
const httpError = (status: number, error: string) =>
  Object.assign(new Error(error), {
    isAxiosError: true,
    response: { status, data: { success: false, error } },
  });

function fillCredentials(email = 'alice@example.test', password = 'password123') {
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: email } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: password } });
}

function submit(label: string) {
  fireEvent.submit(screen.getByRole('button', { name: label }).closest('form')!);
}

beforeEach(() => {
  vi.resetAllMocks();
  const storage = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
  useAppStore.setState({ completedIds: {}, plannedIds: [], progressOwnerId: null });
  vi.mocked(api.healthCheck).mockResolvedValue({
    success: true,
    data: { status: 'ok', timestamp: '' },
  });
  vi.mocked(api.getSession).mockRejectedValue(httpError(401, 'Authentication required'));
  window.history.replaceState({}, '', '/login');
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('authentication screens and session routing', () => {
  it('waits for session lookup before redirecting protected content to sign in', async () => {
    let rejectSession: (error: Error) => void = () => {};
    vi.mocked(api.getSession).mockReturnValue(
      new Promise((_resolve, reject) => {
        rejectSession = reject;
      }),
    );
    window.history.replaceState({}, '', '/curriculum');
    render(<App />);
    expect(screen.queryByTestId('curriculum')).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Sign in' })).toBeNull();
    await act(async () => {
      rejectSession(httpError(401, 'Authentication required'));
    });
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(window.location.pathname).toBe('/login');
  });

  it('restores the cookie session and its own local progress after refresh', async () => {
    localStorage.setItem('auth_token', 'obsolete-token');
    localStorage.setItem('completed_courses', JSON.stringify({ guestCourse: null }));
    localStorage.setItem(
      `completed_courses:${student.id}`,
      JSON.stringify({ ownedCourse: 'Group 2' }),
    );
    vi.mocked(api.getSession).mockResolvedValue(student);
    render(<App />);
    expect(await screen.findByText(student.name)).toBeInTheDocument();
    expect(window.location.pathname).toBe('/curriculum');
    expect(useAppStore.getState().completedIds).toEqual({ ownedCourse: 'Group 2' });
    expect(localStorage.getItem('auth_token')).toBeNull();
    expect(localStorage.getItem('completed_courses')).toBe(JSON.stringify({ guestCourse: null }));
    expect(api.login).not.toHaveBeenCalled();
  });

  it('shows bad credentials and permits a corrected login without importing guest progress', async () => {
    localStorage.setItem('completed_courses', JSON.stringify({ guestCourse: null }));
    vi.mocked(api.login)
      .mockRejectedValueOnce(httpError(401, 'Invalid email or password'))
      .mockResolvedValueOnce(student);
    render(<App />);
    await screen.findByRole('heading', { name: 'Sign in' });
    fillCredentials('ALICE@EXAMPLE.TEST');
    submit('Sign in');
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid email or password');
    expect(window.location.pathname).toBe('/login');
    expect(screen.getByRole('button', { name: 'Sign in' })).not.toBeDisabled();
    submit('Sign in');
    expect(await screen.findByText(student.name)).toBeInTheDocument();
    expect(api.login).toHaveBeenLastCalledWith({ email: student.email, password: 'password123' });
    expect(useAppStore.getState().completedIds).toEqual({});
    expect(window.location.pathname).toBe('/curriculum');
  });

  it('shows duplicate registration errors and signs in after a successful retry', async () => {
    window.history.replaceState({}, '', '/register');
    vi.mocked(api.register)
      .mockRejectedValueOnce(httpError(409, 'Email or student ID is already registered'))
      .mockResolvedValueOnce(student);
    render(<App />);
    await screen.findByRole('heading', { name: 'Create account' });
    fireEvent.change(screen.getByLabelText('Student ID'), { target: { value: ' IT123 ' } });
    fireEvent.change(screen.getByLabelText('Full name'), { target: { value: ' Alice Student ' } });
    fillCredentials();
    submit('Create account');
    expect(await screen.findByRole('alert')).toHaveTextContent('already registered');
    submit('Create account');
    expect(await screen.findByText(student.name)).toBeInTheDocument();
    expect(api.register).toHaveBeenLastCalledWith({
      studentId: 'IT123',
      name: student.name,
      email: student.email,
      password: 'password123',
    });
    expect(window.location.pathname).toBe('/curriculum');
  });

  it('validates bcrypt password limits before sending registration', async () => {
    window.history.replaceState({}, '', '/register');
    render(<App />);
    await screen.findByRole('heading', { name: 'Create account' });
    fireEvent.change(screen.getByLabelText('Student ID'), { target: { value: 'IT123' } });
    fireEvent.change(screen.getByLabelText('Full name'), { target: { value: 'Alice' } });
    fillCredentials(student.email, '😀'.repeat(19));
    submit('Create account');
    expect(await screen.findByRole('alert')).toHaveTextContent('72 UTF-8 bytes');
    expect(api.register).not.toHaveBeenCalled();
  });

  it('keeps the account on logout failure and restores guest state only after success', async () => {
    vi.mocked(api.getSession).mockResolvedValue(student);
    vi.mocked(api.logout)
      .mockRejectedValueOnce(httpError(500, 'Could not sign out'))
      .mockResolvedValueOnce(undefined);
    localStorage.setItem('completed_courses', JSON.stringify({ guestCourse: null }));
    render(<App />);
    await screen.findByText(student.name);
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not sign out');
    expect(screen.getByText(student.name)).toBeInTheDocument();
    expect(useAppStore.getState().progressOwnerId).toBe(student.id);
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    await screen.findByRole('heading', { name: 'Sign in' });
    expect(useAppStore.getState().progressOwnerId).toBeNull();
    expect(useAppStore.getState().completedIds).toEqual({ guestCourse: null });
    expect(screen.queryByText(student.name)).toBeNull();
  });

  it('offers retry for a server failure instead of treating it as an expired session', async () => {
    vi.mocked(api.getSession)
      .mockRejectedValueOnce(new Error('Network unavailable'))
      .mockResolvedValueOnce(student);
    render(<App />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not check your session');
    expect(screen.queryByRole('heading', { name: 'Sign in' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText(student.name)).toBeInTheDocument();
    expect(api.getSession).toHaveBeenCalledTimes(2);
  });

  it('keeps the public demo available when signed out', async () => {
    window.history.replaceState({}, '', '/');
    render(<App />);
    expect(await screen.findByTestId('curriculum')).toHaveTextContent('Demo curriculum content');
    expect(screen.getByRole('link', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('ignores an obsolete session response during React StrictMode initialization', async () => {
    let rejectOld: (error: Error) => void = () => {};
    vi.mocked(api.getSession)
      .mockReturnValueOnce(
        new Promise((_resolve, reject) => {
          rejectOld = reject;
        }),
      )
      .mockResolvedValueOnce(student);
    render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
    await screen.findByText(student.name);
    await act(async () => {
      rejectOld(httpError(401, 'Expired session'));
    });
    await waitFor(() => expect(screen.getByText(student.name)).toBeInTheDocument());
    expect(window.location.pathname).toBe('/curriculum');
    expect(useAppStore.getState().progressOwnerId).toBe(student.id);
  });
});
