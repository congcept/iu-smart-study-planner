import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  AuthUserDTO,
  ResourceScopeDTO,
  SemesterAllocationRunV1DTO,
} from '@iu-study-planner/shared';
import { getSession } from '@/lib/api';
import {
  createSemesterAllocationRun,
  getSemesterAllocationRun,
} from '@/lib/semesterAllocationRunsApi';
import { ownerId, referenceSession } from '@/test/fixtures/curriculumReference';
import { semesterAllocationScope } from '@/test/fixtures/semesterAllocationPreview';
import { semesterAllocationRun } from '@/test/fixtures/semesterAllocationRun';
import { SemesterAllocationRunCapturePanel } from '../SemesterAllocationRunCapturePanel';
import { semesterAllocationRunRecoveryKey } from '../semesterAllocationRunRecovery';

vi.mock('@/lib/api', () => ({ getSession: vi.fn() }));
vi.mock('@/lib/semesterAllocationRunsApi', () => ({
  createSemesterAllocationRun: vi.fn(),
  getSemesterAllocationRun: vi.fn(),
}));
const otherId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const requestId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const session = () => ({ ...referenceSession(null), role: 'ADMIN' as const });
const capture = () => screen.getByRole('button', { name: 'Capture semester simulation' });
const retry = () => screen.getByRole('button', { name: 'Retry semester capture' });
const recovery = () => screen.getByRole('button', { name: 'Retry semester capture recovery' });
const another = () => screen.getByRole('button', { name: 'Capture another semester run' });
const heading = () => screen.queryByRole('heading', { name: 'Last semester capture in this tab' });
const mount = (userId = ownerId, scope = semesterAllocationScope) =>
  render(<SemesterAllocationRunCapturePanel userId={userId} scope={scope} />);
const ready = () => waitFor(() => expect(screen.getByRole('button')).toBeEnabled());
const savedRequest = (scope: ResourceScopeDTO = semesterAllocationScope, owner = ownerId) => ({
  ...scope,
  requestId,
  expectedActorId: owner,
});
const journal = (
  runId?: string,
  scope: ResourceScopeDTO = semesterAllocationScope,
  owner = ownerId,
) => ({
  version: 1,
  ownerId: owner,
  request: savedRequest(scope, owner),
  ...(runId ? { runId } : {}),
});
const key = (owner = ownerId, scope = semesterAllocationScope) =>
  semesterAllocationRunRecoveryKey(owner, scope);
const seed = (runId?: string) => sessionStorage.setItem(key(), JSON.stringify(journal(runId)));
const readJournal = () =>
  JSON.parse(sessionStorage.getItem(key()) ?? 'null') as {
    request: { requestId: string };
    runId?: string;
  } | null;
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
    getItem: vi.fn((id: string) => saved.get(id) ?? null),
    setItem: vi.fn((id: string, value: string) => {
      saved.set(id, value);
    }),
    removeItem: vi.fn((id: string) => {
      saved.delete(id);
    }),
  });
  vi.mocked(getSession).mockResolvedValue(session());
  vi.mocked(createSemesterAllocationRun).mockResolvedValue(semesterAllocationRun());
  vi.mocked(getSemesterAllocationRun).mockResolvedValue(semesterAllocationRun());
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('saved semester simulation capture', () => {
  it('mounts without automatically creating a run or writing browser data', async () => {
    mount();
    await ready();
    expect(capture()).toBeEnabled();
    expect(createSemesterAllocationRun).not.toHaveBeenCalled();
    expect(getSemesterAllocationRun).not.toHaveBeenCalled();
    expect(getSession).not.toHaveBeenCalled();
    expect(sessionStorage.setItem).not.toHaveBeenCalled();
  });

  it('explains that a failed first session preflight sent no capture or retry key', async () => {
    vi.mocked(getSession).mockRejectedValueOnce(new Error('Session unavailable'));
    mount();
    await ready();
    fireEvent.click(capture());
    expect(await screen.findByRole('alert')).toHaveTextContent('No new capture request was sent');
    expect(createSemesterAllocationRun).not.toHaveBeenCalled();
    expect(readJournal()).toBeNull();
    expect(capture()).toBeEnabled();
    fireEvent.click(capture());
    await waitFor(() => expect(another()).toBeEnabled());
    expect(createSemesterAllocationRun).toHaveBeenCalledTimes(1);
  });

  it('persists and verifies the retry key before POST, then waits for fresh final admin confirmation', async () => {
    const initial = deferred<AuthUserDTO>();
    const final = deferred<AuthUserDTO>();
    vi.mocked(getSession).mockReturnValueOnce(initial.promise).mockReturnValueOnce(final.promise);
    vi.mocked(createSemesterAllocationRun).mockImplementation(async (input) => {
      expect(readJournal()).toMatchObject({ request: input });
      return semesterAllocationRun();
    });
    mount();
    await ready();
    fireEvent.click(capture());
    expect(createSemesterAllocationRun).not.toHaveBeenCalled();
    await act(async () => initial.resolve(session()));
    await waitFor(() => expect(createSemesterAllocationRun).toHaveBeenCalledTimes(1));
    expect(heading()).not.toBeInTheDocument();
    expect(readJournal()?.runId).toBeUndefined();
    await act(async () => final.resolve(session()));
    await waitFor(() => expect(another()).toBeEnabled());
    expect(heading()).toBeInTheDocument();
    expect(readJournal()?.runId).toBe(semesterAllocationRun().id);
    expect(getSession).toHaveBeenCalledTimes(2);
    const bytes = sessionStorage.getItem(key());
    expect(bytes).not.toContain('totalAssignedCredits');
    expect(bytes).not.toContain('students');
  });

  it('manually recovers an uncertain POST with the same durable key before allowing a fresh capture', async () => {
    vi.mocked(createSemesterAllocationRun).mockRejectedValueOnce(new Error('Lost response'));
    mount();
    await ready();
    fireEvent.click(capture());
    await screen.findByRole('alert');
    const original = vi.mocked(createSemesterAllocationRun).mock.calls[0][0];
    expect(readJournal()?.request.requestId).toBe(original.requestId);
    expect(createSemesterAllocationRun).toHaveBeenCalledTimes(1);
    fireEvent.click(retry());
    await waitFor(() => expect(another()).toBeEnabled());
    expect(vi.mocked(createSemesterAllocationRun).mock.calls[1][0]).toEqual(original);
    fireEvent.click(another());
    await waitFor(() => expect(createSemesterAllocationRun).toHaveBeenCalledTimes(3));
    expect(getSemesterAllocationRun).toHaveBeenCalledWith(
      semesterAllocationRun().id,
      semesterAllocationScope,
    );
    expect(vi.mocked(createSemesterAllocationRun).mock.calls[2][0].requestId).not.toBe(
      original.requestId,
    );
  });

  it('loads a pending key without automatically posting and retries only when explicitly clicked', async () => {
    seed();
    mount();
    await ready();
    expect(retry()).toBeEnabled();
    expect(createSemesterAllocationRun).not.toHaveBeenCalled();
    expect(getSession).not.toHaveBeenCalled();
    fireEvent.click(retry());
    await waitFor(() => expect(another()).toBeEnabled());
    expect(createSemesterAllocationRun).toHaveBeenCalledExactlyOnceWith(savedRequest());
  });

  it('recovers a saved receipt through exact historical GET only', async () => {
    seed(semesterAllocationRun().id);
    mount();
    await waitFor(() => expect(heading()).toBeInTheDocument());
    expect(getSemesterAllocationRun).toHaveBeenCalledExactlyOnceWith(
      semesterAllocationRun().id,
      semesterAllocationScope,
    );
    expect(getSession).toHaveBeenCalledTimes(2);
    expect(createSemesterAllocationRun).not.toHaveBeenCalled();
  });

  it('blocks rapid duplicate capture clicks while the first POST is pending', async () => {
    const pending = deferred<SemesterAllocationRunV1DTO>();
    vi.mocked(createSemesterAllocationRun).mockReturnValueOnce(pending.promise);
    mount();
    await ready();
    const button = capture();
    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() => expect(createSemesterAllocationRun).toHaveBeenCalledTimes(1));
    expect(button).toBeDisabled();
    await act(async () => pending.resolve(semesterAllocationRun()));
    await waitFor(() => expect(another()).toBeEnabled());
    expect(createSemesterAllocationRun).toHaveBeenCalledTimes(1);
  });

  it.each([
    { ...session(), role: 'STUDENT' as const },
    { ...session(), id: otherId },
  ])('blocks a changed preflight admin before persisting a request %#', async (account) => {
    vi.mocked(getSession).mockResolvedValueOnce(account);
    mount();
    await ready();
    fireEvent.click(capture());
    await screen.findByRole('alert');
    expect(createSemesterAllocationRun).not.toHaveBeenCalled();
    expect(readJournal()).toBeNull();
    expect(screen.getByRole('alert')).toHaveTextContent('Your admin session changed');
  });

  it.each(['success', 'failure'] as const)(
    'rechecks the current admin after POST %s and preserves an unconfirmed key on account change',
    async (outcome) => {
      if (outcome === 'failure')
        vi.mocked(createSemesterAllocationRun).mockRejectedValueOnce(
          new Error('Private failed POST'),
        );
      vi.mocked(getSession)
        .mockResolvedValueOnce(session())
        .mockResolvedValueOnce({ ...session(), id: otherId });
      mount();
      await ready();
      fireEvent.click(capture());
      await screen.findByRole('alert');
      expect(getSession).toHaveBeenCalledTimes(2);
      expect(screen.getByRole('alert')).toHaveTextContent('Your admin session changed');
      expect(screen.getByRole('alert')).not.toHaveTextContent('Private');
      expect(heading()).not.toBeInTheDocument();
      expect(readJournal()?.runId).toBeUndefined();
      expect(retry()).toBeEnabled();
    },
  );

  it('checks the admin after failed historical GET and preserves the original receipt', async () => {
    seed(semesterAllocationRun().id);
    vi.mocked(getSemesterAllocationRun).mockRejectedValueOnce(new Error('Private missing run'));
    vi.mocked(getSession)
      .mockResolvedValueOnce(session())
      .mockResolvedValueOnce({ ...session(), role: 'STUDENT' });
    mount();
    await screen.findByRole('alert');
    expect(getSession).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('alert')).toHaveTextContent('Your admin session changed');
    expect(screen.getByRole('alert')).not.toHaveTextContent('Private');
    expect(readJournal()?.runId).toBe(semesterAllocationRun().id);
    expect(createSemesterAllocationRun).not.toHaveBeenCalled();
  });

  it.each(['owner', 'scope'] as const)(
    'ignores a stale POST after %s changes and retains its original recovery key',
    async (change) => {
      const pending = deferred<SemesterAllocationRunV1DTO>();
      vi.mocked(createSemesterAllocationRun).mockReturnValueOnce(pending.promise);
      const view = mount();
      await ready();
      fireEvent.click(capture());
      await waitFor(() => expect(createSemesterAllocationRun).toHaveBeenCalledTimes(1));
      const original = sessionStorage.getItem(key());
      view.rerender(
        <SemesterAllocationRunCapturePanel
          userId={change === 'owner' ? otherId : ownerId}
          scope={
            change === 'scope'
              ? { ...semesterAllocationScope, year: 2027 }
              : semesterAllocationScope
          }
        />,
      );
      await ready();
      await act(async () => pending.resolve(semesterAllocationRun()));
      expect(heading()).not.toBeInTheDocument();
      expect(sessionStorage.getItem(key())).toBe(original);
      expect(getSession).toHaveBeenCalledTimes(1);
      expect(capture()).toBeEnabled();
    },
  );

  it('ignores a stale historical GET failure after switching scenarios', async () => {
    const pending = deferred<SemesterAllocationRunV1DTO>();
    seed(semesterAllocationRun().id);
    vi.mocked(getSemesterAllocationRun).mockReturnValueOnce(pending.promise);
    const view = mount();
    await waitFor(() => expect(getSemesterAllocationRun).toHaveBeenCalledTimes(1));
    view.rerender(
      <SemesterAllocationRunCapturePanel
        userId={ownerId}
        scope={{ ...semesterAllocationScope, semester: 'SPRING' }}
      />,
    );
    await ready();
    await act(async () => pending.reject(new Error('Old receipt failure')));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(heading()).not.toBeInTheDocument();
    expect(readJournal()?.runId).toBe(semesterAllocationRun().id);
    expect(createSemesterAllocationRun).not.toHaveBeenCalled();
  });

  it('does not reveal an old historical GET after switching administrators', async () => {
    const pending = deferred<SemesterAllocationRunV1DTO>();
    seed(semesterAllocationRun().id);
    vi.mocked(getSemesterAllocationRun).mockReturnValueOnce(pending.promise);
    const view = mount();
    await waitFor(() => expect(getSemesterAllocationRun).toHaveBeenCalledTimes(1));
    view.rerender(
      <SemesterAllocationRunCapturePanel userId={otherId} scope={semesterAllocationScope} />,
    );
    await ready();
    await act(async () => pending.resolve(semesterAllocationRun()));
    expect(heading()).not.toBeInTheDocument();
    expect(readJournal()?.runId).toBe(semesterAllocationRun().id);
    expect(getSession).toHaveBeenCalledTimes(1);
    expect(createSemesterAllocationRun).not.toHaveBeenCalled();
  });

  it('does not prepare or POST a request after an obsolete preflight account check', async () => {
    const initial = deferred<AuthUserDTO>();
    vi.mocked(getSession).mockReturnValueOnce(initial.promise);
    const view = mount();
    await ready();
    fireEvent.click(capture());
    view.rerender(
      <SemesterAllocationRunCapturePanel userId={otherId} scope={semesterAllocationScope} />,
    );
    await ready();
    await act(async () => initial.resolve(session()));
    expect(readJournal()).toBeNull();
    expect(sessionStorage.setItem).not.toHaveBeenCalled();
    expect(createSemesterAllocationRun).not.toHaveBeenCalled();
    expect(capture()).toBeEnabled();
  });

  it('ignores obsolete final session confirmation after switching owners', async () => {
    const final = deferred<AuthUserDTO>();
    vi.mocked(getSession).mockResolvedValueOnce(session()).mockReturnValueOnce(final.promise);
    const view = mount();
    await ready();
    fireEvent.click(capture());
    await waitFor(() => expect(getSession).toHaveBeenCalledTimes(2));
    view.rerender(
      <SemesterAllocationRunCapturePanel userId={otherId} scope={semesterAllocationScope} />,
    );
    await ready();
    await act(async () => final.resolve(session()));
    expect(heading()).not.toBeInTheDocument();
    expect(readJournal()?.runId).toBeUndefined();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('blocks creation while storage is denied and can recover without sending a POST after access returns', async () => {
    const denied = vi.spyOn(sessionStorage, 'getItem').mockImplementation(() => {
      throw new Error('Denied');
    });
    mount();
    await ready();
    expect(recovery()).toBeEnabled();
    expect(screen.getByRole('alert')).toHaveTextContent('blocked');
    denied.mockRestore();
    fireEvent.click(recovery());
    await ready();
    expect(capture()).toBeEnabled();
    expect(createSemesterAllocationRun).not.toHaveBeenCalled();
  });

  it('blocks POST if the durable pending key cannot be written', async () => {
    vi.mocked(sessionStorage.setItem).mockImplementation(() => {
      throw new Error('Full');
    });
    mount();
    await ready();
    fireEvent.click(capture());
    await screen.findByRole('alert');
    expect(createSemesterAllocationRun).not.toHaveBeenCalled();
    expect(recovery()).toBeEnabled();
  });

  it('blocks POST when storage silently discards the key and fails read-back verification', async () => {
    vi.mocked(sessionStorage.setItem).mockImplementation(() => undefined);
    mount();
    await ready();
    fireEvent.click(capture());
    await screen.findByRole('alert');
    expect(createSemesterAllocationRun).not.toHaveBeenCalled();
    expect(readJournal()).toBeNull();
  });

  it.each(['{broken json', JSON.stringify({ ...journal(), ownerId: otherId })])(
    'preserves invalid recovery bytes and sends no requests %#',
    async (raw) => {
      sessionStorage.setItem(key(), raw);
      vi.mocked(sessionStorage.setItem).mockClear();
      mount();
      await ready();
      fireEvent.click(recovery());
      await ready();
      expect(sessionStorage.getItem(key())).toBe(raw);
      expect(sessionStorage.setItem).not.toHaveBeenCalled();
      expect(sessionStorage.removeItem).not.toHaveBeenCalled();
      expect(createSemesterAllocationRun).not.toHaveBeenCalled();
      expect(getSemesterAllocationRun).not.toHaveBeenCalled();
    },
  );

  it('retains the original key after a confirmed POST loses its local receipt, then recovers the same ID', async () => {
    const nativeSet = vi.mocked(sessionStorage.setItem).getMockImplementation();
    let writes = 0;
    vi.mocked(sessionStorage.setItem).mockImplementation((id, value) => {
      if (++writes === 2) throw new Error('Receipt denied');
      nativeSet?.(id, value);
    });
    mount();
    await ready();
    fireEvent.click(capture());
    await waitFor(() => expect(heading()).toBeInTheDocument());
    expect(screen.getByRole('alert')).toHaveTextContent('server confirmed');
    const original = vi.mocked(createSemesterAllocationRun).mock.calls[0][0];
    expect(readJournal()?.runId).toBeUndefined();
    vi.mocked(sessionStorage.setItem).mockImplementation(nativeSet!);
    fireEvent.click(recovery());
    await ready();
    expect(createSemesterAllocationRun).toHaveBeenCalledTimes(1);
    fireEvent.click(retry());
    await waitFor(() => expect(another()).toBeEnabled());
    expect(vi.mocked(createSemesterAllocationRun).mock.calls[1][0]).toEqual(original);
    expect(readJournal()?.runId).toBe(semesterAllocationRun().id);
  });

  it('blocks POST if another mounted view rewrites the journal during preflight', async () => {
    seed();
    const initial = deferred<AuthUserDTO>();
    vi.mocked(getSession).mockReturnValueOnce(initial.promise);
    mount();
    await ready();
    fireEvent.click(retry());
    const changed = JSON.stringify(journal(), null, 2);
    sessionStorage.setItem(key(), changed);
    await act(async () => initial.resolve(session()));
    await screen.findByRole('alert');
    expect(recovery()).toBeEnabled();
    expect(createSemesterAllocationRun).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(key())).toBe(changed);
  });

  it('does not overwrite another request saved while POST was pending', async () => {
    const pending = deferred<SemesterAllocationRunV1DTO>();
    vi.mocked(createSemesterAllocationRun).mockReturnValueOnce(pending.promise);
    mount();
    await ready();
    fireEvent.click(capture());
    await waitFor(() => expect(createSemesterAllocationRun).toHaveBeenCalledTimes(1));
    const changed = JSON.stringify(journal());
    sessionStorage.setItem(key(), changed);
    await act(async () => pending.resolve(semesterAllocationRun()));
    await ready();
    expect(sessionStorage.getItem(key())).toBe(changed);
    expect(recovery()).toBeEnabled();
    expect(createSemesterAllocationRun).toHaveBeenCalledTimes(1);
  });

  it.each(['wrongId', 'wrongScope', 'private'] as const)(
    'preserves a receipt when the historical reply has %s evidence',
    async (field) => {
      const saved = semesterAllocationRun();
      seed(saved.id);
      const reply =
        field === 'wrongId'
          ? { ...saved, id: otherId }
          : field === 'wrongScope'
            ? semesterAllocationRun({ ...semesterAllocationScope, year: 2027 })
            : { ...saved, result: { ...saved.result, students: [{ studentId: ownerId }] } };
      vi.mocked(getSemesterAllocationRun).mockResolvedValueOnce(reply);
      mount();
      await screen.findByRole('alert');
      expect(heading()).not.toBeInTheDocument();
      expect(readJournal()?.runId).toBe(saved.id);
      expect(recovery()).toBeEnabled();
      expect(createSemesterAllocationRun).not.toHaveBeenCalled();
    },
  );

  it('rejects a malformed POST aggregate and retains its request for explicit retry', async () => {
    const saved = semesterAllocationRun();
    vi.mocked(createSemesterAllocationRun).mockResolvedValueOnce({
      ...saved,
      result: { ...saved.result, totalAssignedCredits: saved.result.totalAssignedCredits + 1 },
    });
    mount();
    await ready();
    fireEvent.click(capture());
    await screen.findByRole('alert');
    expect(heading()).not.toBeInTheDocument();
    expect(readJournal()?.runId).toBeUndefined();
    expect(retry()).toBeEnabled();
  });

  it('does not replace a confirmed key before revalidating its original saved receipt', async () => {
    seed(semesterAllocationRun().id);
    mount();
    await waitFor(() => expect(another()).toBeEnabled());
    const original = sessionStorage.getItem(key());
    vi.mocked(getSemesterAllocationRun).mockResolvedValueOnce({
      ...semesterAllocationRun(),
      id: otherId,
    });
    fireEvent.click(another());
    await screen.findByRole('alert');
    expect(createSemesterAllocationRun).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(key())).toBe(original);
  });

  it('shows captured credit outcomes, storage confirmation and historical limits', async () => {
    seed(semesterAllocationRun().id);
    mount();
    await waitFor(() => expect(heading()).toBeInTheDocument());
    const panel = screen.getByRole('region', { name: 'Saved semester simulation' });
    for (const [label, value] of [
      ['Students in captured cohort', '3'],
      ['Students with assignments', '2'],
      ['Course assignments', '4'],
      ['Total reference target credits', '18'],
      ['Assigned credits', '12'],
      ['Credits left unassigned', '6'],
      ['Simulated rounds', '2'],
    ]) {
      expect(screen.getByText(label).nextElementSibling).toHaveTextContent(value);
    }
    expect(panel).toHaveTextContent('private simulation assignments saved');
    expect(panel).toHaveTextContent('historical');
    expect(panel).toHaveTextContent(/academic plans/i);
    expect(
      panel.querySelector(`time[datetime="${semesterAllocationRun().capturedAt}"]`),
    ).toBeInTheDocument();
    expect(
      panel.querySelector(`time[datetime="${semesterAllocationRun().createdAt}"]`),
    ).toBeInTheDocument();
    expect(panel).not.toHaveTextContent('studentId');
  });
});
