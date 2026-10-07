import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthUserDTO, SemesterAllocationPreviewDTO } from '@iu-study-planner/shared';
import { getSession } from '@/lib/api';
import { getSemesterAllocationPreview } from '@/lib/semesterAllocationApi';
import { ownerId, referenceSession } from '@/test/fixtures/curriculumReference';
import {
  emptySemesterAllocationPreview,
  semesterAllocationCourseNames,
  semesterAllocationPreview,
  semesterAllocationScope,
  zeroCapacitySemesterAllocationPreview,
} from '@/test/fixtures/semesterAllocationPreview';
import { SemesterAllocationPreviewPanel } from '../SemesterAllocationPreviewPanel';

vi.mock('@/lib/api', () => ({ getSession: vi.fn() }));
vi.mock('@/lib/semesterAllocationApi', () => ({ getSemesterAllocationPreview: vi.fn() }));
const session = () => ({ ...referenceSession(null), role: 'ADMIN' as const });
const otherId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const reload = () => screen.getByRole('button', { name: 'Reload semester preview' });
const mount = (userId = ownerId, scope = semesterAllocationScope, revision: number | null = 3) =>
  render(
    <SemesterAllocationPreviewPanel userId={userId} scope={scope} resourceRevision={revision} />,
  );
const ready = () => waitFor(() => expect(reload()).toBeEnabled());
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getSession).mockResolvedValue(session());
  vi.mocked(getSemesterAllocationPreview).mockResolvedValue(semesterAllocationPreview());
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('read-only semester allocation preview panel', () => {
  it('confirms the current admin before reading and before showing the aggregate', async () => {
    const initial = deferred<AuthUserDTO>();
    const final = deferred<AuthUserDTO>();
    vi.mocked(getSession).mockReturnValueOnce(initial.promise).mockReturnValueOnce(final.promise);
    mount();
    expect(getSemesterAllocationPreview).not.toHaveBeenCalled();
    expect(reload()).toBeDisabled();
    await act(async () => initial.resolve(session()));
    await waitFor(() =>
      expect(getSemesterAllocationPreview).toHaveBeenCalledExactlyOnceWith(semesterAllocationScope),
    );
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    await act(async () => final.resolve(session()));
    await screen.findByRole('table');
    expect(getSession).toHaveBeenCalledTimes(2);
  });

  it.each([null, { ...session(), role: 'STUDENT' as const }, { ...session(), id: otherId }])(
    'blocks changed preflight identities without fetching a preview %#',
    async (account) => {
      vi.mocked(getSession).mockResolvedValueOnce(account as unknown as AuthUserDTO);
      mount();
      await ready();
      expect(getSemesterAllocationPreview).not.toHaveBeenCalled();
      expect(screen.getByRole('alert')).toHaveTextContent('Your admin session changed');
      expect(screen.queryByRole('table')).not.toBeInTheDocument();
    },
  );

  it('discards a successful reply when the account changes during final confirmation', async () => {
    vi.mocked(getSession)
      .mockResolvedValueOnce(session())
      .mockResolvedValueOnce({ ...session(), id: otherId });
    mount();
    await ready();
    expect(getSemesterAllocationPreview).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('alert')).toHaveTextContent('Your admin session changed');
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('renders reference credit totals, distinct students and a keyboard-accessible course ledger', async () => {
    const storage = vi.spyOn(Storage.prototype, 'setItem');
    render(
      <SemesterAllocationPreviewPanel
        userId={ownerId}
        scope={semesterAllocationScope}
        resourceRevision={3}
        courses={semesterAllocationCourseNames}
      />,
    );
    const table = await screen.findByRole('table', {
      name: 'Shared course sections and credit assignments',
    });
    const region = screen.getByRole('region', { name: 'Semester course allocations' });
    region.focus();
    expect(region).toHaveFocus();
    expect(within(table).getByRole('columnheader', { name: 'Credits' })).toBeInTheDocument();
    expect(screen.getByText(/configured reference target is 6 credits/i)).toBeInTheDocument();
    expect(screen.getByText(/saves no assignments/i)).toBeInTheDocument();
    expect(screen.getByText(/academic plans/i)).toBeInTheDocument();
    expect(within(table).getByText(semesterAllocationCourseNames[0].code)).toBeInTheDocument();
    for (const [label, value] of [
      ['Students with assignments', '2'],
      ['Course assignments', '4'],
      ['Total reference target credits', '18'],
      ['Assigned credits', '12'],
      ['Credits left unassigned', '6'],
      ['Simulated rounds', '2'],
      ['Reached reference target', '2'],
      ['No remaining eligible choices', '1'],
    ]) {
      expect(screen.getByText(label).nextElementSibling).toHaveTextContent(value);
    }
    expect(storage).not.toHaveBeenCalled();
  });

  it('removes old evidence during reload and prevents double loads from rapid clicks', async () => {
    mount();
    await screen.findByRole('table');
    const pending = deferred<SemesterAllocationPreviewDTO>();
    vi.mocked(getSemesterAllocationPreview).mockReturnValueOnce(pending.promise);
    fireEvent.click(reload());
    fireEvent.click(reload());
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    await waitFor(() => expect(getSemesterAllocationPreview).toHaveBeenCalledTimes(2));
    await act(async () => pending.reject(new Error('Offline')));
    await ready();
    expect(screen.getByRole('alert')).toHaveTextContent('Reload to try again');
    fireEvent.click(reload());
    await screen.findByRole('table');
    expect(getSemesterAllocationPreview).toHaveBeenCalledTimes(3);
  });

  it.each([403, 409])(
    'offers safe recovery for HTTP %s without echoing private errors',
    async (status) => {
      vi.mocked(getSemesterAllocationPreview).mockRejectedValueOnce({
        isAxiosError: true,
        response: { status, data: { error: 'Private participant data' } },
      });
      mount();
      await ready();
      expect(screen.getByRole('alert')).toHaveTextContent(
        status === 409 ? '500 students' : 'Your admin session changed',
      );
      expect(screen.getByRole('alert')).not.toHaveTextContent('Private');
      expect(screen.queryByRole('table')).not.toBeInTheDocument();
    },
  );

  it('rechecks the admin after a failed read before exposing recovery for that account', async () => {
    vi.mocked(getSemesterAllocationPreview).mockRejectedValueOnce(new Error('Offline'));
    vi.mocked(getSession)
      .mockResolvedValueOnce(session())
      .mockResolvedValueOnce({ ...session(), role: 'STUDENT' });
    mount();
    await ready();
    expect(getSession).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('alert')).toHaveTextContent('Your admin session changed');
    expect(screen.getByRole('alert')).not.toHaveTextContent('Offline');
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('rejects valid data for the wrong scenario even when the API adapter is bypassed', async () => {
    vi.mocked(getSemesterAllocationPreview).mockResolvedValueOnce(
      semesterAllocationPreview({ ...semesterAllocationScope, year: 2027 }),
    );
    mount();
    await ready();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Could not verify');
  });

  it.each([{ persisted: true }, { students: [{ studentId: ownerId }] }])(
    'rejects unverified or private payloads before displaying them %#',
    async (fields) => {
      vi.mocked(getSemesterAllocationPreview).mockResolvedValueOnce({
        ...semesterAllocationPreview(),
        ...fields,
      } as unknown as SemesterAllocationPreviewDTO);
      mount();
      await ready();
      expect(screen.queryByRole('table')).not.toBeInTheDocument();
      expect(screen.getByRole('alert')).toHaveTextContent('Could not verify');
      expect(screen.queryByText(ownerId)).not.toBeInTheDocument();
    },
  );

  it.each(['account', 'scope'] as const)(
    'discards a delayed successful reply after %s changes',
    async (kind) => {
      const pending = deferred<SemesterAllocationPreviewDTO>();
      vi.mocked(getSemesterAllocationPreview).mockReturnValueOnce(pending.promise);
      const view = mount();
      await waitFor(() => expect(getSemesterAllocationPreview).toHaveBeenCalledTimes(1));
      const scope =
        kind === 'scope'
          ? { ...semesterAllocationScope, semester: 'SPRING' as const }
          : semesterAllocationScope;
      const userId = kind === 'account' ? otherId : ownerId;
      vi.mocked(getSession).mockResolvedValue({ ...session(), id: userId });
      vi.mocked(getSemesterAllocationPreview).mockResolvedValue(semesterAllocationPreview(scope));
      view.rerender(
        <SemesterAllocationPreviewPanel userId={userId} scope={scope} resourceRevision={3} />,
      );
      await screen.findByRole('table');
      await act(async () => pending.resolve(semesterAllocationPreview()));
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expect(getSemesterAllocationPreview).toHaveBeenCalledTimes(2);
      expect(getSemesterAllocationPreview).toHaveBeenLastCalledWith(scope);
      expect(getSession).toHaveBeenCalledTimes(3);
    },
  );

  it('keeps the latest resource revision after an older request fails', async () => {
    const pending = deferred<SemesterAllocationPreviewDTO>();
    vi.mocked(getSemesterAllocationPreview).mockReturnValueOnce(pending.promise);
    const view = mount();
    await waitFor(() => expect(getSemesterAllocationPreview).toHaveBeenCalledTimes(1));
    vi.mocked(getSemesterAllocationPreview).mockResolvedValue(
      semesterAllocationPreview(semesterAllocationScope, 4),
    );
    view.rerender(
      <SemesterAllocationPreviewPanel
        userId={ownerId}
        scope={semesterAllocationScope}
        resourceRevision={4}
      />,
    );
    await screen.findByRole('table');
    await act(async () => pending.reject(new Error('Old failed preview')));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByText(/Saved resource revision 4/)).toBeInTheDocument();
    expect(getSemesterAllocationPreview).toHaveBeenCalledTimes(2);
  });

  it('ignores delayed final session confirmation after a new resource revision', async () => {
    const final = deferred<AuthUserDTO>();
    vi.mocked(getSession).mockResolvedValueOnce(session()).mockReturnValueOnce(final.promise);
    const view = mount();
    await waitFor(() => expect(getSession).toHaveBeenCalledTimes(2));
    vi.mocked(getSemesterAllocationPreview).mockResolvedValue(
      semesterAllocationPreview(semesterAllocationScope, 4),
    );
    view.rerender(
      <SemesterAllocationPreviewPanel
        userId={ownerId}
        scope={semesterAllocationScope}
        resourceRevision={4}
      />,
    );
    await screen.findByRole('table');
    await act(async () => final.resolve({ ...session(), role: 'STUDENT' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByText(/Saved resource revision 4/)).toBeInTheDocument();
  });

  it('does not fetch after an obsolete preflight session finishes', async () => {
    const initial = deferred<AuthUserDTO>();
    vi.mocked(getSession).mockReturnValueOnce(initial.promise);
    const view = mount();
    view.rerender(
      <SemesterAllocationPreviewPanel
        userId={ownerId}
        scope={semesterAllocationScope}
        resourceRevision={4}
      />,
    );
    vi.mocked(getSemesterAllocationPreview).mockResolvedValue(
      semesterAllocationPreview(semesterAllocationScope, 4),
    );
    await screen.findByRole('table');
    await act(async () => initial.resolve(session()));
    expect(getSemesterAllocationPreview).toHaveBeenCalledTimes(1);
  });

  it('explains mismatched saved revisions without changing form inputs', async () => {
    vi.mocked(getSemesterAllocationPreview).mockResolvedValue(
      semesterAllocationPreview(semesterAllocationScope, 4),
    );
    mount();
    await screen.findByRole('table');
    expect(screen.getByRole('status')).toHaveTextContent('different saved resource revision');
    expect(screen.getByRole('status')).toHaveTextContent('preserves form edits');
  });

  it('shows absent resource settings as unknown and leaves unused course rows visible', async () => {
    vi.mocked(getSemesterAllocationPreview).mockResolvedValue(
      semesterAllocationPreview(semesterAllocationScope, null),
    );
    mount(ownerId, semesterAllocationScope, null);
    await screen.findByRole('table');
    expect(screen.getByText(/Capacity is unknown/)).toBeInTheDocument();
    expect(screen.queryByText(/capacity is exhausted/i)).not.toBeInTheDocument();
  });

  it('distinguishes configured zero capacity from unknown settings', async () => {
    vi.mocked(getSemesterAllocationPreview).mockResolvedValue(
      zeroCapacitySemesterAllocationPreview(),
    );
    mount();
    await screen.findByRole('table');
    expect(screen.getByText(/0 of 0 shared/)).toBeInTheDocument();
    expect(screen.queryByText(/Capacity is unknown/)).not.toBeInTheDocument();
  });

  it('shows an empty assigned cohort with zero totals and preserves unused course evidence', async () => {
    vi.mocked(getSemesterAllocationPreview).mockResolvedValue(emptySemesterAllocationPreview());
    mount();
    await screen.findByRole('table');
    expect(
      screen.getByText('No students are currently assigned to this curriculum.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows an empty reference catalog without manufacturing a course table', async () => {
    vi.mocked(getSemesterAllocationPreview).mockResolvedValue(
      emptySemesterAllocationPreview(3, false),
    );
    mount();
    await ready();
    expect(
      screen.getByText('No courses are listed in this reference curriculum.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('rejects an invalid scenario before checking the session or requesting data', async () => {
    mount(ownerId, { ...semesterAllocationScope, year: 1999 });
    await ready();
    expect(getSession).not.toHaveBeenCalled();
    expect(getSemesterAllocationPreview).not.toHaveBeenCalled();
  });
});
