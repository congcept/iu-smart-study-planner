import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AllocationPreviewDTO, AuthUserDTO } from '@iu-study-planner/shared';
import { getSession } from '@/lib/api';
import { getAllocationPreview, saveResources } from '@/lib/adminResourcesApi';
import {
  allocationPreview,
  allocationScope,
  emptyAllocationPreview,
} from '@/test/fixtures/allocationPreview';
import { ownerId, referenceSession } from '@/test/fixtures/curriculumReference';
import { AllocationPreviewPanel } from '../AllocationPreviewPanel';

vi.mock('@/lib/api', () => ({ getSession: vi.fn() }));
vi.mock('@/lib/adminResourcesApi', () => ({
  getAllocationPreview: vi.fn(),
  saveResources: vi.fn(),
}));
const session = () => ({ ...referenceSession(null), role: 'ADMIN' as const });
const otherId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const reload = () => screen.getByRole('button', { name: 'Reload allocation preview' });
const mount = (userId = ownerId, scope = allocationScope, revision: number | null = 3) =>
  render(<AllocationPreviewPanel userId={userId} scope={scope} resourceRevision={revision} />);
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
  vi.mocked(getAllocationPreview).mockResolvedValue(allocationPreview());
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('read-only aggregate allocation panel', () => {
  it('checks current admin before reading and before publishing', async () => {
    const initial = deferred<AuthUserDTO>();
    const final = deferred<AuthUserDTO>();
    vi.mocked(getSession).mockReturnValueOnce(initial.promise).mockReturnValueOnce(final.promise);
    mount();
    expect(getAllocationPreview).not.toHaveBeenCalled();
    expect(reload()).toBeDisabled();
    await act(async () => initial.resolve(session()));
    await waitFor(() =>
      expect(getAllocationPreview).toHaveBeenCalledExactlyOnceWith(allocationScope),
    );
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    await act(async () => final.resolve(session()));
    await screen.findByRole('table');
    expect(getSession).toHaveBeenCalledTimes(2);
  });
  it.each([null, { ...session(), role: 'STUDENT' as const }, { ...session(), id: otherId }])(
    'blocks mismatched fresh sessions before reading %#',
    async (account) => {
      vi.mocked(getSession).mockResolvedValueOnce(account as unknown as AuthUserDTO);
      mount();
      await ready();
      expect(getAllocationPreview).not.toHaveBeenCalled();
      expect(screen.getByRole('alert')).toHaveTextContent('Your admin session changed');
      expect(screen.queryByRole('table')).not.toBeInTheDocument();
    },
  );
  it.each([null, { ...session(), role: 'STUDENT' as const }, { ...session(), id: otherId }])(
    'discards a fetched report if identity changes before publish %#',
    async (account) => {
      vi.mocked(getSession)
        .mockResolvedValueOnce(session())
        .mockResolvedValueOnce(account as unknown as AuthUserDTO);
      mount();
      await ready();
      expect(getAllocationPreview).toHaveBeenCalledTimes(1);
      expect(screen.getByRole('alert')).toHaveTextContent('Your admin session changed');
      expect(screen.queryByRole('table')).not.toBeInTheDocument();
    },
  );
  it('renders distinct cohort outcomes, assigned-seat use and named keyboard-accessible table', async () => {
    const storage = vi.spyOn(Storage.prototype, 'setItem');
    mount();
    const table = await screen.findByRole('table', {
      name: 'Eligible choices and simulated seat assignments',
    });
    expect(screen.getByText(/3 students in this cohort/)).toHaveTextContent(
      '2 have eligible choices, totaling 2 course choices',
    );
    expect(
      within(table).getByRole('row', { name: /MA001IU\s*Scoped Calculus 2 1 1 1 100%/ }),
    ).toBeInTheDocument();
    const region = screen.getByRole('region', { name: 'Course allocation comparison' });
    region.focus();
    expect(region).toHaveFocus();
    expect(screen.getByText(/This preview saves no assignments/)).toBeInTheDocument();
    expect(screen.getByText(/Student utility blends Bayesian difficulty fit/)).toHaveTextContent(
      'Labs, course overrides',
    );
    expect(screen.getByText(/Student utility blends/)).toHaveTextContent(
      'Bayesian difficulty fit (70%) and immediate prerequisite unlocks (30%)',
    );
    expect(screen.getByText(/no confirmed numeric GPA path/)).toBeInTheDocument();
    expect(saveResources).not.toHaveBeenCalled();
    expect(storage).not.toHaveBeenCalled();
  });
  it('shows the captured configured utility weights rather than default percentages', async () => {
    const report = allocationPreview();
    report.utilityPolicy = { difficultyFitWeight: 0.2, immediateUnlockWeight: 0.8 };
    vi.mocked(getAllocationPreview).mockResolvedValue(report);
    mount();
    await screen.findByRole('table');
    expect(screen.getByText(/Student utility blends/)).toHaveTextContent(
      'Bayesian difficulty fit (20%) and immediate prerequisite unlocks (80%)',
    );
  });
  it('removes previous evidence during retry and never double-loads rapid clicks', async () => {
    mount();
    await screen.findByRole('table');
    const pending = deferred<AllocationPreviewDTO>();
    vi.mocked(getAllocationPreview).mockReturnValueOnce(pending.promise);
    fireEvent.click(reload());
    fireEvent.click(reload());
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    await waitFor(() => expect(getAllocationPreview).toHaveBeenCalledTimes(2));
    await act(async () => pending.reject(new Error('Offline')));
    await ready();
    expect(screen.getByRole('alert')).toHaveTextContent('Reload to try again');
    fireEvent.click(reload());
    await screen.findByRole('table');
    expect(getAllocationPreview).toHaveBeenCalledTimes(3);
  });
  it.each([401, 403, 409])(
    'offers actionable recovery for HTTP %s without raw server data',
    async (status) => {
      vi.mocked(getAllocationPreview).mockRejectedValueOnce({
        isAxiosError: true,
        response: { status, data: { error: 'Private student data' } },
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
  it.each([
    { ...allocationScope, semester: 'SPRING' as const },
    { ...allocationScope, year: 2027 },
    { ...allocationScope, curriculumId: otherId },
  ])('rejects wrong-scope reports %#', async (scope) => {
    vi.mocked(getAllocationPreview).mockResolvedValueOnce(allocationPreview(scope));
    mount();
    await ready();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Could not verify');
  });
  it.each([{ persisted: true }, { studentId: ownerId }, { assignedStudentCount: 2 }])(
    'rejects corrupt/private payloads %#',
    async (fields) => {
      vi.mocked(getAllocationPreview).mockResolvedValueOnce({
        ...allocationPreview(),
        ...fields,
      } as unknown as AllocationPreviewDTO);
      mount();
      await ready();
      expect(screen.queryByRole('table')).not.toBeInTheDocument();
      expect(screen.getByRole('alert')).toHaveTextContent('Could not verify');
    },
  );
  it.each(['scope', 'account', 'revision'] as const)(
    'isolates delayed reports after %s changes',
    async (kind) => {
      const pending = deferred<AllocationPreviewDTO>();
      vi.mocked(getAllocationPreview).mockReturnValueOnce(pending.promise);
      const view = mount();
      await waitFor(() => expect(getAllocationPreview).toHaveBeenCalledTimes(1));
      const scope =
        kind === 'scope' ? { ...allocationScope, semester: 'SPRING' as const } : allocationScope;
      const userId = kind === 'account' ? otherId : ownerId;
      const revision = kind === 'revision' ? 4 : 3;
      vi.mocked(getSession).mockResolvedValue({ ...session(), id: userId });
      vi.mocked(getAllocationPreview).mockResolvedValue(allocationPreview(scope, revision));
      view.rerender(
        <AllocationPreviewPanel userId={userId} scope={scope} resourceRevision={revision} />,
      );
      await screen.findByRole('table');
      await act(async () => pending.reject(new Error('Old failed read')));
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expect(getAllocationPreview).toHaveBeenCalledTimes(2);
      expect(getAllocationPreview).toHaveBeenLastCalledWith(scope);
    },
  );
  it('discards a delayed second session confirmation after revision change', async () => {
    const final = deferred<AuthUserDTO>();
    vi.mocked(getSession).mockResolvedValueOnce(session()).mockReturnValueOnce(final.promise);
    const view = mount();
    await waitFor(() => expect(getSession).toHaveBeenCalledTimes(2));
    vi.mocked(getAllocationPreview).mockResolvedValue(allocationPreview(allocationScope, 4));
    view.rerender(
      <AllocationPreviewPanel userId={ownerId} scope={allocationScope} resourceRevision={4} />,
    );
    await screen.findByRole('table');
    await act(async () => final.resolve({ ...session(), role: 'STUDENT' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByText(/Saved resource revision 4/)).toBeInTheDocument();
  });
  it('does not read after an old pending preflight session resolves', async () => {
    const old = deferred<AuthUserDTO>();
    vi.mocked(getSession).mockReturnValueOnce(old.promise);
    const view = mount();
    view.rerender(
      <AllocationPreviewPanel userId={ownerId} scope={allocationScope} resourceRevision={4} />,
    );
    vi.mocked(getAllocationPreview).mockResolvedValue(allocationPreview(allocationScope, 4));
    await screen.findByRole('table');
    await act(async () => old.resolve(session()));
    expect(getAllocationPreview).toHaveBeenCalledTimes(1);
  });
  it('keeps a newer valid preview and describes resource revision mismatch', async () => {
    vi.mocked(getAllocationPreview).mockResolvedValue(allocationPreview(allocationScope, 4));
    mount();
    await screen.findByRole('table');
    expect(screen.getByRole('status')).toHaveTextContent('different saved resource revision');
    expect(screen.getByRole('status')).toHaveTextContent('preserves form edits');
  });
  it('distinguishes unknown resource capacity from exhaustion', async () => {
    vi.mocked(getAllocationPreview).mockResolvedValue(allocationPreview(allocationScope, null));
    mount(ownerId, allocationScope, null);
    const table = await screen.findByRole('table');
    expect(screen.getByText(/Capacity is unknown/)).toBeInTheDocument();
    expect(within(table).getByRole('cell', { name: 'No section' })).toBeInTheDocument();
    expect(screen.queryByText('0%')).not.toBeInTheDocument();
  });
  it('shows configured zero capacity as exhausted, not unknown', async () => {
    const value = allocationPreview();
    value.snapshot.resourceEnvelope.resources!.professors = 0;
    Object.assign(value.snapshot.resourceEnvelope.envelope!, {
      professorSectionCeiling: 0,
      sharedSectionCeiling: 0,
      sharedSeatCeiling: 0,
    });
    Object.assign(value, {
      assignedStudentCount: 0,
      usedSections: 0,
      capacityExhaustedStudentCount: 2,
    });
    Object.assign(value.courses[0], {
      assignedStudentCount: 0,
      openedSections: 0,
      seatCapacity: 0,
      seatUtilization: null,
    });
    vi.mocked(getAllocationPreview).mockResolvedValue(value);
    mount();
    await screen.findByRole('table');
    expect(screen.getByText(/0 of 0 shared/)).toBeInTheDocument();
    expect(screen.queryByText(/Capacity is unknown/)).not.toBeInTheDocument();
  });
  it.each([
    [0, true],
    [3, false],
  ] as const)('keeps honest empty cohort/reference states %#', async (cohort, include) => {
    vi.mocked(getAllocationPreview).mockResolvedValue(emptyAllocationPreview(cohort, include));
    mount();
    await ready();
    expect(
      screen.getByText(
        cohort === 0
          ? 'No students are currently assigned to this curriculum.'
          : 'No courses are listed in this reference curriculum.',
      ),
    ).toBeInTheDocument();
    if (include)
      expect(
        within(screen.getByRole('table')).getByRole('cell', { name: 'No section' }),
      ).toBeInTheDocument();
    else expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });
  it('rejects invalid scope before session/read access', async () => {
    mount(ownerId, { ...allocationScope, year: 1999 });
    await ready();
    expect(getSession).not.toHaveBeenCalled();
    expect(getAllocationPreview).not.toHaveBeenCalled();
  });
});
