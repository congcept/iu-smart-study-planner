import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AllocationRunV1DTO, AuthUserDTO, ResourceScopeDTO } from '@iu-study-planner/shared';
import { getSession } from '@/lib/api';
import { createAllocationRun, getAllocationRun } from '@/lib/allocationRunsApi';
import { allocationRun } from '@/test/fixtures/allocationRun';
import { allocationScope } from '@/test/fixtures/allocationPreview';
import { ownerId, referenceSession } from '@/test/fixtures/curriculumReference';
import { AllocationRunCapturePanel } from '../AllocationRunCapturePanel';
import { allocationRunRecoveryKey } from '../allocationRunRecovery';

vi.mock('@/lib/api', () => ({ getSession: vi.fn() }));
vi.mock('@/lib/allocationRunsApi', () => ({
  createAllocationRun: vi.fn(),
  getAllocationRun: vi.fn(),
}));
const otherId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const requestId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const session = () => ({ ...referenceSession(null), role: 'ADMIN' as const });
const capture = () => screen.getByRole('button', { name: 'Capture simulation run' });
const retry = () => screen.getByRole('button', { name: 'Retry simulation capture' });
const recovery = () => screen.getByRole('button', { name: 'Retry capture recovery' });
const mount = (userId = ownerId, scope = allocationScope) =>
  render(<AllocationRunCapturePanel userId={userId} scope={scope} />);
const ready = () => waitFor(() => expect(screen.getByRole('button')).toBeEnabled());
const savedRequest = (scope: ResourceScopeDTO = allocationScope, owner = ownerId) => ({
  ...scope,
  requestId,
  expectedActorId: owner,
});
const journal = (runId?: string, scope: ResourceScopeDTO = allocationScope, owner = ownerId) => ({
  version: 1,
  ownerId: owner,
  request: savedRequest(scope, owner),
  ...(runId ? { runId } : {}),
});
const seed = (runId?: string) =>
  sessionStorage.setItem(
    allocationRunRecoveryKey(ownerId, allocationScope),
    JSON.stringify(journal(runId)),
  );
const readJournal = () =>
  JSON.parse(
    sessionStorage.getItem(allocationRunRecoveryKey(ownerId, allocationScope)) ?? 'null',
  ) as { request: { requestId: string }; runId?: string } | null;
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (failure: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.resetAllMocks();
  const saved = new Map<string, string>();
  vi.stubGlobal('sessionStorage', {
    getItem: vi.fn((key: string) => saved.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      saved.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      saved.delete(key);
    }),
    clear: vi.fn(() => {
      saved.clear();
    }),
  });
  vi.mocked(getSession).mockResolvedValue(session());
  vi.mocked(createAllocationRun).mockResolvedValue(allocationRun());
  vi.mocked(getAllocationRun).mockResolvedValue(allocationRun());
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('saved simulation capture panel', () => {
  it('starts without a capture request and explains saved settings versus unsaved edits', async () => {
    mount();
    await ready();
    expect(createAllocationRun).not.toHaveBeenCalled();
    expect(getSession).not.toHaveBeenCalled();
    expect(capture()).toBeEnabled();
    expect(screen.getByText(/Capture a new aggregate run/)).toHaveTextContent(
      'Unsaved resource edits are excluded. No student assignments are saved.',
    );
  });

  it('verifies both sessions, persists the request before POST and publishes only after final verification', async () => {
    const initial = deferred<AuthUserDTO>();
    const final = deferred<AuthUserDTO>();
    vi.mocked(getSession).mockReturnValueOnce(initial.promise).mockReturnValueOnce(final.promise);
    vi.mocked(createAllocationRun).mockImplementation(async (input) => {
      expect(readJournal()).toMatchObject({ request: input });
      return allocationRun();
    });
    mount();
    await ready();
    fireEvent.click(capture());
    expect(createAllocationRun).not.toHaveBeenCalled();
    await act(async () => initial.resolve(session()));
    await waitFor(() => expect(createAllocationRun).toHaveBeenCalledTimes(1));
    expect(createAllocationRun).toHaveBeenCalledWith({
      ...allocationScope,
      expectedActorId: ownerId,
      requestId: expect.stringMatching(/^[\da-f-]{36}$/),
    });
    expect(
      screen.queryByRole('heading', { name: 'Last capture in this tab' }),
    ).not.toBeInTheDocument();
    await act(async () => final.resolve(session()));
    await screen.findByRole('heading', { name: 'Last capture in this tab' });
    expect(getSession).toHaveBeenCalledTimes(2);
    expect(readJournal()?.runId).toBe(allocationRun().id);
    expect(screen.getByRole('button', { name: 'Capture another run' })).toBeEnabled();
    const saved = sessionStorage.getItem(allocationRunRecoveryKey(ownerId, allocationScope));
    expect(saved).not.toContain('assignedStudentCount');
    expect(saved).not.toContain('utilityPolicy');
  });

  it('retries a lost response with the original durable key, then creates a fresh key only for another confirmed capture', async () => {
    vi.mocked(createAllocationRun).mockRejectedValueOnce(new Error('Response lost'));
    mount();
    await ready();
    fireEvent.click(capture());
    await screen.findByRole('alert');
    const original = vi.mocked(createAllocationRun).mock.calls[0][0];
    expect(readJournal()?.request.requestId).toBe(original.requestId);
    fireEvent.click(retry());
    await screen.findByRole('heading', { name: 'Last capture in this tab' });
    expect(vi.mocked(createAllocationRun).mock.calls[1][0]).toEqual(original);
    fireEvent.click(screen.getByRole('button', { name: 'Capture another run' }));
    await waitFor(() => expect(createAllocationRun).toHaveBeenCalledTimes(3));
    expect(vi.mocked(createAllocationRun).mock.calls[2][0].requestId).not.toBe(original.requestId);
  });

  it('recovers a pending journal only through explicit retry and keeps its original request key', async () => {
    seed();
    mount();
    await ready();
    expect(retry()).toBeEnabled();
    expect(createAllocationRun).not.toHaveBeenCalled();
    expect(getSession).not.toHaveBeenCalled();
    expect(screen.getByText(/An earlier capture is unconfirmed/)).toHaveTextContent(
      'no capture is sent automatically',
    );
    fireEvent.click(retry());
    await screen.findByRole('heading', { name: 'Last capture in this tab' });
    expect(createAllocationRun).toHaveBeenCalledExactlyOnceWith(savedRequest());
  });

  it('loads a confirmed receipt as historical GET without automatically issuing another POST', async () => {
    const saved = allocationRun();
    seed(saved.id);
    mount();
    await screen.findByRole('heading', { name: 'Last capture in this tab' });
    expect(getAllocationRun).toHaveBeenCalledExactlyOnceWith(saved.id, allocationScope);
    expect(getSession).toHaveBeenCalledTimes(2);
    expect(createAllocationRun).not.toHaveBeenCalled();
    expect(readJournal()?.runId).toBe(saved.id);
  });

  it('prevents rapid duplicate actions while the current capture is pending', async () => {
    const pending = deferred<AllocationRunV1DTO>();
    vi.mocked(createAllocationRun).mockReturnValueOnce(pending.promise);
    mount();
    await ready();
    const button = capture();
    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() => expect(createAllocationRun).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('button')).toBeDisabled();
    await act(async () => pending.resolve(allocationRun()));
    await screen.findByRole('heading', { name: 'Last capture in this tab' });
    expect(createAllocationRun).toHaveBeenCalledTimes(1);
  });

  it.each([null, { ...session(), role: 'STUDENT' as const }, { ...session(), id: otherId }])(
    'blocks a changed session before POST %#',
    async (account) => {
      vi.mocked(getSession).mockResolvedValueOnce(account as unknown as AuthUserDTO);
      mount();
      await ready();
      fireEvent.click(capture());
      await screen.findByRole('alert');
      expect(createAllocationRun).not.toHaveBeenCalled();
      expect(readJournal()).toBeNull();
      expect(screen.getByRole('alert')).toHaveTextContent('Your admin session changed');
    },
  );

  it.each([null, { ...session(), role: 'STUDENT' as const }, { ...session(), id: otherId }])(
    'discards capture results after the final session changes %#',
    async (account) => {
      vi.mocked(getSession)
        .mockResolvedValueOnce(session())
        .mockResolvedValueOnce(account as unknown as AuthUserDTO);
      mount();
      await ready();
      fireEvent.click(capture());
      await screen.findByRole('alert');
      expect(createAllocationRun).toHaveBeenCalledTimes(1);
      expect(readJournal()?.runId).toBeUndefined();
      expect(
        screen.queryByRole('heading', { name: 'Last capture in this tab' }),
      ).not.toBeInTheDocument();
      expect(retry()).toBeEnabled();
    },
  );

  it.each(['owner', 'scope'] as const)(
    'ignores stale first-session checks after %s changes',
    async (change) => {
      const initial = deferred<AuthUserDTO>();
      vi.mocked(getSession).mockReturnValueOnce(initial.promise);
      const view = mount();
      await ready();
      fireEvent.click(capture());
      view.rerender(
        <AllocationRunCapturePanel
          userId={change === 'owner' ? otherId : ownerId}
          scope={change === 'scope' ? { ...allocationScope, year: 2027 } : allocationScope}
        />,
      );
      await ready();
      await act(async () => initial.resolve(session()));
      expect(createAllocationRun).not.toHaveBeenCalled();
      expect(capture()).toBeEnabled();
      expect(readJournal()).toBeNull();
    },
  );

  it.each(['owner', 'scope'] as const)(
    'ignores stale POST responses and leaves the original recovery key after %s changes',
    async (change) => {
      const pending = deferred<AllocationRunV1DTO>();
      vi.mocked(createAllocationRun).mockReturnValueOnce(pending.promise);
      const view = mount();
      await ready();
      fireEvent.click(capture());
      await waitFor(() => expect(createAllocationRun).toHaveBeenCalledTimes(1));
      const original = readJournal();
      view.rerender(
        <AllocationRunCapturePanel
          userId={change === 'owner' ? otherId : ownerId}
          scope={change === 'scope' ? { ...allocationScope, semester: 'SPRING' } : allocationScope}
        />,
      );
      await ready();
      await act(async () => pending.resolve(allocationRun()));
      expect(
        screen.queryByRole('heading', { name: 'Last capture in this tab' }),
      ).not.toBeInTheDocument();
      expect(readJournal()).toEqual(original);
      expect(getSession).toHaveBeenCalledTimes(1);
    },
  );

  it('ignores a stale final-session check after switching scenarios', async () => {
    const final = deferred<AuthUserDTO>();
    vi.mocked(getSession).mockResolvedValueOnce(session()).mockReturnValueOnce(final.promise);
    const view = mount();
    await ready();
    fireEvent.click(capture());
    await waitFor(() => expect(getSession).toHaveBeenCalledTimes(2));
    view.rerender(
      <AllocationRunCapturePanel userId={ownerId} scope={{ ...allocationScope, year: 2027 }} />,
    );
    await ready();
    await act(async () => final.resolve(session()));
    expect(
      screen.queryByRole('heading', { name: 'Last capture in this tab' }),
    ).not.toBeInTheDocument();
    expect(readJournal()?.runId).toBeUndefined();
  });

  it('ignores stale historical GET responses after switching owners', async () => {
    const pending = deferred<AllocationRunV1DTO>();
    seed(allocationRun().id);
    vi.mocked(getAllocationRun).mockReturnValueOnce(pending.promise);
    const view = mount();
    await waitFor(() => expect(getAllocationRun).toHaveBeenCalledTimes(1));
    view.rerender(<AllocationRunCapturePanel userId={otherId} scope={allocationScope} />);
    await ready();
    await act(async () => pending.resolve(allocationRun()));
    expect(
      screen.queryByRole('heading', { name: 'Last capture in this tab' }),
    ).not.toBeInTheDocument();
    expect(createAllocationRun).not.toHaveBeenCalled();
    expect(getSession).toHaveBeenCalledTimes(1);
    expect(readJournal()?.runId).toBe(allocationRun().id);
  });

  it('blocks creation when session storage cannot be read and can retry recovery after access returns', async () => {
    const denied = vi.spyOn(sessionStorage, 'getItem').mockImplementation(() => {
      throw new Error('Storage denied');
    });
    mount();
    await ready();
    expect(recovery()).toBeEnabled();
    expect(screen.getByRole('alert')).toHaveTextContent('Capture is blocked');
    fireEvent.click(recovery());
    await ready();
    expect(createAllocationRun).not.toHaveBeenCalled();
    denied.mockRestore();
    fireEvent.click(recovery());
    await ready();
    expect(capture()).toBeEnabled();
    expect(createAllocationRun).not.toHaveBeenCalled();
  });

  it('blocks POST when the pending request cannot be durably saved', async () => {
    const writes = vi.spyOn(sessionStorage, 'setItem').mockImplementation(() => {
      throw new Error('Storage full');
    });
    mount();
    await ready();
    fireEvent.click(capture());
    await screen.findByRole('alert');
    expect(createAllocationRun).not.toHaveBeenCalled();
    expect(recovery()).toBeEnabled();
    expect(writes).toHaveBeenCalledTimes(1);
  });

  it.each([
    '{broken json',
    JSON.stringify({ ...journal(), version: 2 }),
    JSON.stringify({ ...journal(), ownerId: otherId }),
    JSON.stringify({ ...journal(), request: { ...savedRequest(), year: 2027 } }),
    JSON.stringify({ ...journal(), request: { ...savedRequest(), expectedActorId: otherId } }),
    JSON.stringify({ ...journal(), aggregate: allocationRun().result }),
    JSON.stringify({ ...journal(), runId: 'not-a-uuid' }),
  ])('preserves corrupt or foreign recovery data and sends no POST %#', async (raw) => {
    const key = allocationRunRecoveryKey(ownerId, allocationScope);
    sessionStorage.setItem(key, raw);
    const writes = vi.spyOn(sessionStorage, 'setItem').mockClear();
    const removes = vi.spyOn(sessionStorage, 'removeItem');
    mount();
    await ready();
    expect(recovery()).toBeEnabled();
    fireEvent.click(recovery());
    await ready();
    expect(createAllocationRun).not.toHaveBeenCalled();
    expect(getAllocationRun).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(key)).toBe(raw);
    expect(writes).not.toHaveBeenCalled();
    expect(removes).not.toHaveBeenCalled();
  });

  it('shows server confirmation but retains the original key when receipt persistence fails', async () => {
    const nativeSet = vi.mocked(sessionStorage.setItem).getMockImplementation();
    let writes = 0;
    const storage = vi.spyOn(sessionStorage, 'setItem').mockImplementation(function (
      this: Storage,
      key,
      value,
    ) {
      writes++;
      if (writes === 2) throw new Error('Receipt write denied');
      nativeSet?.call(this, key, value);
    });
    mount();
    await ready();
    fireEvent.click(capture());
    await screen.findByRole('heading', { name: 'Last capture in this tab' });
    expect(screen.getByRole('alert')).toHaveTextContent('server confirmed this capture');
    expect(readJournal()?.runId).toBeUndefined();
    const original = vi.mocked(createAllocationRun).mock.calls[0][0];
    storage.mockRestore();
    fireEvent.click(retry());
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Capture another run' })).toBeEnabled(),
    );
    expect(vi.mocked(createAllocationRun).mock.calls[1][0]).toEqual(original);
    expect(readJournal()?.runId).toBe(allocationRun().id);
  });

  it('does not overwrite another journal that changed while the capture was pending', async () => {
    const pending = deferred<AllocationRunV1DTO>();
    vi.mocked(createAllocationRun).mockReturnValueOnce(pending.promise);
    mount();
    await ready();
    fireEvent.click(capture());
    await waitFor(() => expect(createAllocationRun).toHaveBeenCalledTimes(1));
    const changed = JSON.stringify(journal());
    sessionStorage.setItem(allocationRunRecoveryKey(ownerId, allocationScope), changed);
    await act(async () => pending.resolve(allocationRun()));
    expect(sessionStorage.getItem(allocationRunRecoveryKey(ownerId, allocationScope))).toBe(
      changed,
    );
    fireEvent.click(retry());
    await waitFor(() => expect(recovery()).toBeEnabled());
    expect(createAllocationRun).toHaveBeenCalledTimes(1);
  });

  it.each(['wrongId', 'wrongScope', 'invalidTotals', 'untrustedField'] as const)(
    'preserves receipt and rejects malformed historical reply %s',
    async (field) => {
      const saved = allocationRun();
      seed(saved.id);
      const invalid = structuredClone(saved);
      if (field === 'wrongId') invalid.id = otherId;
      if (field === 'wrongScope') invalid.result.scope.year = 2027;
      if (field === 'invalidTotals') invalid.result.assignedStudentCount = 99;
      const reply = field === 'untrustedField' ? { ...invalid, assignments: [] } : invalid;
      vi.mocked(getAllocationRun).mockResolvedValueOnce(reply);
      mount();
      await screen.findByRole('alert');
      expect(recovery()).toBeEnabled();
      expect(
        screen.queryByRole('heading', { name: 'Last capture in this tab' }),
      ).not.toBeInTheDocument();
      expect(readJournal()?.runId).toBe(saved.id);
      expect(createAllocationRun).not.toHaveBeenCalled();
    },
  );

  it('rejects a malformed POST result while retaining the pending request', async () => {
    const invalid = allocationRun();
    invalid.result.scope.year = 2027;
    vi.mocked(createAllocationRun).mockResolvedValueOnce(invalid);
    mount();
    await ready();
    fireEvent.click(capture());
    await screen.findByRole('alert');
    expect(readJournal()?.runId).toBeUndefined();
    expect(retry()).toBeEnabled();
    expect(
      screen.queryByRole('heading', { name: 'Last capture in this tab' }),
    ).not.toBeInTheDocument();
  });

  it('does not reveal historical results after a changed final session', async () => {
    seed(allocationRun().id);
    vi.mocked(getSession)
      .mockResolvedValueOnce(session())
      .mockResolvedValueOnce({ ...session(), id: otherId });
    mount();
    await screen.findByRole('alert');
    expect(
      screen.queryByRole('heading', { name: 'Last capture in this tab' }),
    ).not.toBeInTheDocument();
    expect(readJournal()?.runId).toBe(allocationRun().id);
    expect(createAllocationRun).not.toHaveBeenCalled();
  });

  it('renders captured outcomes, times, resource revision, applied weights and explicit simulation limits', async () => {
    const saved = allocationRun();
    saved.result.utilityPolicy = { difficultyFitWeight: 0.2, immediateUnlockWeight: 0.8 };
    saved.result.allocationPolicy = {
      studentUtilityWeight: 0.5,
      resourceFitWeight: 0.3,
      fairnessWeight: 0.2,
      congestionThreshold: 0.75,
    };
    vi.mocked(createAllocationRun).mockResolvedValueOnce(saved);
    mount();
    await ready();
    fireEvent.click(capture());
    await screen.findByRole('heading', { name: 'Last capture in this tab' });
    const panel = screen.getByRole('region', { name: 'Saved simulation capture' });
    expect(panel).toHaveTextContent('Students in captured cohort3');
    expect(panel).toHaveTextContent('Assigned in simulation1');
    expect(panel).toHaveTextContent('No eligible choices1');
    expect(panel).toHaveTextContent('Unassigned after capacity is exhausted1');
    expect(panel).toHaveTextContent('Captured resource revision 3');
    expect(panel).toHaveTextContent('Bayesian difficulty fit 20%');
    expect(panel).toHaveTextContent('immediate prerequisite unlocks 80%');
    expect(panel).toHaveTextContent(
      'student utility 50%, resource fit 30%, fairness 20%; congestion threshold 75%',
    );
    expect(panel.querySelector(`time[datetime="${saved.capturedAt}"]`)).toBeInTheDocument();
    expect(panel.querySelector(`time[datetime="${saved.createdAt}"]`)).toBeInTheDocument();
    expect(panel).toHaveTextContent(
      'no full-semester allocation or student assignments are stored',
    );
    expect(panel).toHaveTextContent('official offerings remain unverified');
    expect(panel).toHaveTextContent('full run history is not available here yet');
  });
});
