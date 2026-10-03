import '@testing-library/jest-dom/vitest';
import { MemoryRouter } from 'react-router-dom';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthUserDTO, CurriculumDetailDTO } from '@iu-study-planner/shared';
import { getSession } from '@/lib/api';
import { getCurriculumReference } from '@/lib/curriculumApi';
import {
  curriculumReference,
  otherReferenceId,
  ownerId,
  referenceId,
  referenceSession,
} from '@/test/fixtures/curriculumReference';
import { AccountCurriculum } from '../AccountCurriculum';

const legacy = vi.hoisted(() => ({ mount: vi.fn() }));
vi.mock('@/lib/api', () => ({ getSession: vi.fn() }));
vi.mock('@/lib/curriculumApi', () => ({ getCurriculumReference: vi.fn() }));
vi.mock('../CurriculumProgressMap', () => ({
  CurriculumProgressMap: ({ userId }: { userId: string }) => {
    legacy.mount(userId);
    return <p>Legacy map for {userId}</p>;
  },
}));
const session = vi.mocked(getSession),
  reference = vi.mocked(getCurriculumReference);
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
const view = (id = ownerId) => (
  <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
    <AccountCurriculum userId={id} />
  </MemoryRouter>
);
beforeEach(() => {
  vi.resetAllMocks();
  session.mockResolvedValue(referenceSession());
  reference.mockResolvedValue(curriculumReference());
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
describe('account curriculum reference', () => {
  it('shows scoped placement, difficulty, nonfork policy and no legacy editing', async () => {
    render(view());
    await screen.findByRole('region', { name: 'Assigned curriculum reference' });
    expect(reference).toHaveBeenCalledWith(referenceId);
    expect(session).toHaveBeenCalledTimes(2);
    expect(legacy.mount).not.toHaveBeenCalled();
    expect(screen.getByText(/Year 1 · Semester 1 · Group A/)).toBeInTheDocument();
    expect(screen.getByText(/Difficulty 2.0 \/ 5 · No ratings yet/)).toBeInTheDocument();
    expect(screen.getByText(/does not use a GPA-based thesis path/)).toBeInTheDocument();
    expect(
      screen.getByText(/Course completion editing and degree progress are not available/),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /complete/i })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Review saved courses in Planner' })).toHaveAttribute(
      'href',
      '/planner',
    );
  });
  it('mounts the existing map only after a confirmed null context', async () => {
    const pending = deferred<AuthUserDTO>();
    session.mockReturnValueOnce(pending.promise);
    render(view());
    expect(legacy.mount).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toBeInTheDocument();
    await act(async () => pending.resolve(referenceSession(null)));
    await screen.findByText(`Legacy map for ${ownerId}`);
    expect(reference).not.toHaveBeenCalled();
  });
  it.each(['missing context', 'invalid context', 'wrong owner'])(
    'fails closed for %s without mounting the global map',
    async (name) => {
      const data = referenceSession();
      if (name === 'missing context') delete data.curriculumId;
      else if (name === 'invalid context') data.curriculumId = 'CS';
      else data.id = otherReferenceId;
      session.mockResolvedValue(data);
      render(view());
      await screen.findByRole('alert');
      expect(reference).not.toHaveBeenCalled();
      expect(legacy.mount).not.toHaveBeenCalled();
    },
  );
  it('rejects a different reference returned by the adapter', async () => {
    reference.mockResolvedValue({ ...curriculumReference(), id: otherReferenceId });
    render(view());
    await screen.findByRole('alert');
    expect(legacy.mount).not.toHaveBeenCalled();
  });
  it('rejects an account context change during the public reference read', async () => {
    session
      .mockResolvedValueOnce(referenceSession())
      .mockResolvedValueOnce(referenceSession(otherReferenceId));
    render(view());
    await screen.findByRole('alert');
    expect(screen.queryByText('SIM · Simulated reference')).not.toBeInTheDocument();
  });
  it('recovers from a reference failure by rechecking the session', async () => {
    reference.mockRejectedValueOnce(new Error('offline'));
    render(view());
    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: 'Reload curriculum' }));
    await screen.findByText('SIM · Simulated reference');
    expect(session).toHaveBeenCalledTimes(3);
  });
  it('hides confirmed reference while focus refresh is pending and does not fall back after failure', async () => {
    render(view());
    await screen.findByText('SIM · Simulated reference');
    const pending = deferred<AuthUserDTO>();
    session.mockReturnValueOnce(pending.promise);
    fireEvent.focus(window);
    expect(screen.queryByText('SIM · Simulated reference')).not.toBeInTheDocument();
    await act(async () => pending.reject(new Error('expired')));
    await screen.findByRole('alert');
    expect(legacy.mount).not.toHaveBeenCalled();
  });
  it('removes legacy map before resolving a changed assigned context on focus', async () => {
    session.mockResolvedValueOnce(referenceSession(null));
    render(view());
    await screen.findByText(`Legacy map for ${ownerId}`);
    fireEvent.focus(window);
    expect(screen.queryByText(`Legacy map for ${ownerId}`)).not.toBeInTheDocument();
    await screen.findByText('SIM · Simulated reference');
  });
  it.each(['resolve', 'reject'] as const)(
    'ignores an old owner %s after changing accounts',
    async (outcome) => {
      const pending = deferred<CurriculumDetailDTO>();
      reference.mockReturnValueOnce(pending.promise);
      const { rerender } = render(view());
      await waitFor(() => expect(reference).toHaveBeenCalledTimes(1));
      session.mockResolvedValue(referenceSession(null, otherReferenceId));
      rerender(view(otherReferenceId));
      await screen.findByText(`Legacy map for ${otherReferenceId}`);
      await act(async () => {
        if (outcome === 'resolve') pending.resolve(curriculumReference());
        else pending.reject(new Error('old'));
      });
      expect(screen.queryByText('SIM · Simulated reference')).not.toBeInTheDocument();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    },
  );
  it('does not resurrect confirmed A during an A-B-A owner round trip', async () => {
    const { rerender } = render(view());
    await screen.findByText('SIM · Simulated reference');
    const pending = deferred<AuthUserDTO>();
    session.mockReturnValue(pending.promise);
    rerender(view(otherReferenceId));
    rerender(view());
    expect(screen.queryByText('SIM · Simulated reference')).not.toBeInTheDocument();
    await act(async () => pending.resolve(referenceSession()));
    await screen.findByText('SIM · Simulated reference');
  });
  it('deduplicates focus refresh while its session read is pending', async () => {
    const pending = deferred<AuthUserDTO>();
    session.mockReturnValueOnce(pending.promise);
    render(view());
    fireEvent.focus(window);
    fireEvent.focus(window);
    await waitFor(() => expect(session).toHaveBeenCalledTimes(1));
    await act(async () => pending.resolve(referenceSession()));
    await screen.findByText('SIM · Simulated reference');
  });
  it('cleans visibility listeners and ignores late reference replies after unmount', async () => {
    const pending = deferred<CurriculumDetailDTO>();
    reference.mockReturnValueOnce(pending.promise);
    const { unmount } = render(view());
    await waitFor(() => expect(reference).toHaveBeenCalledTimes(1));
    unmount();
    fireEvent(document, new Event('visibilitychange'));
    await act(async () => pending.resolve(curriculumReference()));
    expect(session).toHaveBeenCalledTimes(1);
    expect(legacy.mount).not.toHaveBeenCalled();
  });
  it('retains duplicated elective placements, contextual parents and unresolved requirements', async () => {
    const data = curriculumReference();
    const first = data.courses[0];
    first.placements.push({
      ...first.placements[0],
      id: '55555555-5555-4555-8555-555555555555',
      electiveGroup: 'Group B',
      sourceOrder: 1,
    });
    data.courses.push({
      ...first,
      id: '66666666-6666-4666-8666-666666666666',
      code: 'NEXT',
      name: 'Dependent',
      placements: [],
    });
    data.prerequisites.push({
      id: otherReferenceId,
      courseId: data.courses[1].id,
      prerequisiteId: first.id,
      isStrict: false,
      isCorequisite: true,
      mandatory: true,
    });
    data.requirements.push({
      id: '77777777-7777-4777-8777-777777777777',
      kind: 'FREE_ELECTIVE',
      name: 'Free elective',
      credits: 3,
      academicYear: null,
      academicSemester: null,
      sourceOrder: 1,
      sourceLabel: null,
    });
    reference.mockResolvedValue(data);
    render(view());
    await screen.findByText('SIM · Simulated reference');
    expect(screen.getByText(/Group A/)).toBeInTheDocument();
    expect(screen.getByText(/Group B/)).toBeInTheDocument();
    expect(screen.getByText('Prerequisites: MA001IU')).toBeInTheDocument();
    expect(screen.getByText('No reference placement recorded.')).toBeInTheDocument();
    expect(screen.getByText('Free elective · 3 credits')).toBeInTheDocument();
  });
  it('shows an honest empty reference', async () => {
    const data = curriculumReference();
    data.courses = [];
    data.ratingPrior = null;
    reference.mockResolvedValue(data);
    render(view());
    await screen.findByText('No courses are included in this reference yet.');
    expect(legacy.mount).not.toHaveBeenCalled();
  });
});
