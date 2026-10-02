import { StrictMode } from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthUserDTO } from '@iu-study-planner/shared';
import * as api from '@/lib/api';
import { useAuth } from '../AuthContext';
import { AuthProvider } from '../AuthProvider';

const { setProgressOwner } = vi.hoisted(() => ({ setProgressOwner: vi.fn() }));

vi.mock('@/lib/api', () => ({ getSession: vi.fn() }));
vi.mock('@/lib/store', () => ({
  useAppStore: { getState: () => ({ setProgressOwner }) },
}));

const student: AuthUserDTO = {
  id: 'storage-student',
  studentId: 'IT123',
  name: 'Storage Student',
  email: 'storage@example.test',
  role: 'STUDENT',
};

function expiredSession() {
  return Object.assign(new Error('Authentication required'), {
    isAxiosError: true,
    response: { status: 401 },
  });
}

function SessionState() {
  const { user, status, sessionError } = useAuth();
  return (
    <>
      <output data-testid="session">
        {status}:{user?.id ?? 'guest'}
      </output>
      {sessionError && <p role="alert">{sessionError}</p>}
    </>
  );
}

function denyStorage(mode: 'getter' | 'removeItem') {
  if (mode === 'getter') {
    vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new DOMException('Storage access denied', 'SecurityError');
    });
  } else {
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new DOMException('Storage removal denied', 'SecurityError');
    });
  }
}

beforeEach(() => {
  vi.resetAllMocks();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('cookie session recovery when obsolete token cleanup fails', () => {
  describe.each(['getter', 'removeItem'] as const)('%s throws', (mode) => {
    it('restores an authenticated cookie session', async () => {
      denyStorage(mode);
      vi.mocked(api.getSession).mockResolvedValue(student);

      render(
        <AuthProvider>
          <SessionState />
        </AuthProvider>,
      );

      expect(await screen.findByText(`authenticated:${student.id}`)).toBeInTheDocument();
      expect(api.getSession).toHaveBeenCalledTimes(1);
      expect(setProgressOwner).toHaveBeenCalledWith(student.id);
      expect(screen.queryByRole('alert')).toBeNull();
    });

    it('settles an expired cookie session as anonymous', async () => {
      denyStorage(mode);
      vi.mocked(api.getSession).mockRejectedValue(expiredSession());

      render(
        <AuthProvider>
          <SessionState />
        </AuthProvider>,
      );

      expect(await screen.findByText('unauthenticated:guest')).toBeInTheDocument();
      expect(api.getSession).toHaveBeenCalledTimes(1);
      expect(setProgressOwner).toHaveBeenCalledWith(null);
      expect(screen.queryByRole('alert')).toBeNull();
    });
  });

  it('ignores the obsolete StrictMode request while storage is denied', async () => {
    denyStorage('getter');
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
        <AuthProvider>
          <SessionState />
        </AuthProvider>
      </StrictMode>,
    );
    await screen.findByText(`authenticated:${student.id}`);
    await act(async () => {
      rejectOld(expiredSession());
    });

    expect(screen.getByTestId('session')).toHaveTextContent(`authenticated:${student.id}`);
    expect(api.getSession).toHaveBeenCalledTimes(2);
    expect(setProgressOwner).toHaveBeenCalledTimes(1);
    expect(setProgressOwner).toHaveBeenCalledWith(student.id);
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
