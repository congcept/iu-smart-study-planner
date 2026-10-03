import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StudentGradesDTO } from '@iu-study-planner/shared';
import { getStudentGrades } from '@/lib/gradesApi';
import { useGpaPath } from '../useGpaPath';

vi.mock('@/lib/gradesApi', () => ({ getStudentGrades: vi.fn() }));
const getGrades = vi.mocked(getStudentGrades);
const empty: StudentGradesDTO = {
  attempts: [],
  summary: {
    gpa100: null,
    gpaPath: null,
    gradedCredits: 0,
    gradedCourseCount: 0,
    courseScores: [],
  },
  completedCoursesWithoutNumericGrades: [],
};
function scored(gpa100 = 90, gpaPath: 'THESIS' | 'ALTERNATIVE' = 'THESIS'): StudentGradesDTO {
  return {
    ...empty,
    summary: { ...empty.summary, gpa100, gpaPath, gradedCredits: 4, gradedCourseCount: 1 },
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
const hook = (userId: string | undefined = 'one') =>
  renderHook<ReturnType<typeof useGpaPath>, { owner: string | undefined }>(
    ({ owner }) => useGpaPath(owner),
    { initialProps: { owner: userId } },
  );

beforeEach(() => {
  vi.resetAllMocks();
  getGrades.mockResolvedValue(empty);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('account-scoped server GPA path', () => {
  const ownerId = '11111111-1111-4111-8111-111111111111';
  const otherId = '22222222-2222-4222-8222-222222222222';
  const scope = { userId: ownerId, curriculumId: null, isGpaPath: true };
  it.each(['numeric', 'null'] as const)(
    'accepts the matching unassigned %s scope',
    async (kind) => {
      getGrades.mockResolvedValueOnce({ ...(kind === 'numeric' ? scored() : empty), scope });
      const { result } = hook(ownerId);
      await waitFor(() => expect(result.current.status).toBe('ready'));
      expect(result.current.manual).toBe(kind === 'null');
    },
  );
  it.each([
    ['another owner', { ...scope, userId: otherId }],
    ['assigned fork', { ...scope, curriculumId: otherId }],
    ['assigned nonfork', { ...scope, curriculumId: otherId, isGpaPath: false }],
    ['invalid scope', { ...scope, userId: 'not-a-uuid' }],
  ])('rejects %s before exposing a CS path or manual controls', async (_name, responseScope) => {
    getGrades.mockResolvedValueOnce({ ...empty, scope: responseScope });
    const { result } = hook(ownerId);
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current).toMatchObject({ mode: null, manual: false, gpa100: null });
    act(() => result.current.selectManual('below'));
    expect(result.current.mode).toBeNull();
  });
  it('removes stale eligibility when the cookie scope changes during focus refresh and recovers on retry', async () => {
    getGrades
      .mockResolvedValueOnce({ ...scored(), scope })
      .mockResolvedValueOnce({ ...scored(), scope: { ...scope, userId: otherId } })
      .mockResolvedValueOnce({ ...empty, scope });
    const { result } = hook(ownerId);
    await waitFor(() => expect(result.current.status).toBe('ready'));
    act(() => window.dispatchEvent(new Event('focus')));
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current).toMatchObject({ mode: null, manual: false, gpa100: null });
    await act(async () => result.current.reload());
    expect(result.current).toMatchObject({ status: 'ready', manual: true, gpa100: null });
  });
  it('keeps the guest manual, without loading grades or refreshing on focus', async () => {
    const { result } = renderHook(() => useGpaPath());
    expect(result.current).toMatchObject({ status: 'ready', mode: 'above', manual: true });
    act(() => result.current.selectManual('below'));
    expect(result.current.mode).toBe('below');
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
      document.dispatchEvent(new Event('visibilitychange'));
      await result.current.reload();
    });
    expect(getGrades).not.toHaveBeenCalled();
  });

  it('withholds path and manual controls until the signed-in result arrives', async () => {
    const pending = deferred<StudentGradesDTO>();
    getGrades.mockReturnValueOnce(pending.promise);
    const { result } = hook();
    expect(result.current).toMatchObject({ status: 'loading', mode: null, manual: false });
    act(() => result.current.selectManual('below'));
    expect(result.current.mode).toBeNull();
    await act(async () => pending.resolve(scored()));
    expect(result.current).toMatchObject({
      status: 'ready',
      mode: 'above',
      manual: false,
      gpa100: 90,
    });
  });

  it.each([
    [0, 'ALTERNATIVE', 'below'],
    [70, 'ALTERNATIVE', 'below'],
    [70.004, 'THESIS', 'above'],
  ] as const)('uses the server path for GPA %s', async (gpa, path, mode) => {
    getGrades.mockResolvedValueOnce(scored(gpa, path));
    const { result } = hook();
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current).toMatchObject({ mode, gpa100: gpa, manual: false });
    act(() => result.current.selectManual(mode === 'above' ? 'below' : 'above'));
    expect(result.current.mode).toBe(mode);
  });

  it('trusts THESIS even when an exact above-threshold GPA serializes as the number 70', async () => {
    getGrades.mockResolvedValueOnce(scored(70, 'THESIS'));
    const { result } = hook();
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current).toMatchObject({ mode: 'above', gpa100: 70, manual: false });
  });

  it('permits manual choice only for explicit null GPA and reports missing numeric grades', async () => {
    getGrades.mockResolvedValueOnce({
      ...empty,
      completedCoursesWithoutNumericGrades: ['math', 'cs'],
    });
    const { result } = hook();
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current).toMatchObject({
      mode: 'above',
      manual: true,
      gpa100: null,
      missingGradeCount: 2,
    });
    act(() => result.current.selectManual('below'));
    expect(result.current.mode).toBe('below');
  });

  const malformed: [string, unknown][] = [
    [
      'missing path',
      { ...empty, summary: { gpa100: null, gradedCredits: 0, gradedCourseCount: 0 } },
    ],
    ['unknown path', { ...scored(), summary: { ...scored().summary, gpaPath: 'MANUAL' } }],
    ['absent summary', { completedCoursesWithoutNumericGrades: [] }],
    ['numeric GPA with null path', { ...empty, summary: { ...empty.summary, gpa100: 90 } }],
    ['null GPA with numeric path', { ...scored(), summary: { ...scored().summary, gpa100: null } }],
    ['nonfinite GPA', scored(Number.NaN)],
    ['out of range GPA', scored(101)],
    [
      'zero graded credits with numeric GPA',
      { ...scored(), summary: { ...scored().summary, gradedCredits: 0 } },
    ],
    [
      'graded courses with null GPA',
      { ...empty, summary: { ...empty.summary, gradedCourseCount: 1 } },
    ],
    ['missing coverage', { summary: empty.summary }],
    ['invalid coverage IDs', { ...empty, completedCoursesWithoutNumericGrades: [null] }],
    [
      'duplicated coverage IDs',
      { ...empty, completedCoursesWithoutNumericGrades: ['math', 'math'] },
    ],
  ];
  it.each(malformed)(
    'fails closed on %s instead of enabling manual choice',
    async (_name, data) => {
      getGrades.mockResolvedValueOnce(data as StudentGradesDTO);
      const { result } = hook();
      await waitFor(() => expect(result.current.status).toBe('error'));
      expect(result.current).toMatchObject({
        mode: null,
        manual: false,
        gpa100: null,
        missingGradeCount: 0,
      });
      act(() => result.current.selectManual('below'));
      expect(result.current.mode).toBeNull();
    },
  );

  it('recovers from a request failure with a fresh authoritative reload', async () => {
    getGrades
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(scored(60, 'ALTERNATIVE'));
    const { result } = hook();
    await waitFor(() => expect(result.current.status).toBe('error'));
    await act(async () => result.current.reload());
    expect(result.current).toMatchObject({ status: 'ready', mode: 'below', manual: false });
    expect(getGrades).toHaveBeenCalledTimes(2);
  });

  it('recovers from synchronous adapter exceptions without retaining a settled pending request', async () => {
    getGrades
      .mockImplementationOnce(() => {
        throw new Error('adapter failure');
      })
      .mockResolvedValueOnce(empty);
    const { result } = hook();
    await waitFor(() => expect(result.current.status).toBe('error'));
    await act(async () => result.current.reload());
    expect(result.current).toMatchObject({ status: 'ready', manual: true });
    expect(getGrades).toHaveBeenCalledTimes(2);
  });

  it('hides the previous account path immediately while a different account loads', async () => {
    const next = deferred<StudentGradesDTO>();
    getGrades.mockResolvedValueOnce(scored()).mockReturnValueOnce(next.promise);
    const { result, rerender } = hook();
    await waitFor(() => expect(result.current.status).toBe('ready'));
    rerender({ owner: 'two' });
    expect(result.current).toMatchObject({
      status: 'loading',
      mode: null,
      manual: false,
      gpa100: null,
    });
    await act(async () => next.resolve(scored(65, 'ALTERNATIVE')));
    expect(result.current).toMatchObject({ mode: 'below', gpa100: 65 });
  });

  it.each(['resolve', 'reject'] as const)(
    'ignores an old account %s after a newer account succeeds',
    async (outcome) => {
      const old = deferred<StudentGradesDTO>();
      getGrades.mockReturnValueOnce(old.promise).mockResolvedValueOnce(scored(60, 'ALTERNATIVE'));
      const { result, rerender } = hook();
      await waitFor(() => expect(getGrades).toHaveBeenCalledTimes(1));
      rerender({ owner: 'two' });
      await waitFor(() => expect(result.current.status).toBe('ready'));
      await act(async () => {
        if (outcome === 'resolve') old.resolve(scored());
        else old.reject(new Error('old session failed'));
      });
      expect(result.current).toMatchObject({
        status: 'ready',
        mode: 'below',
        gpa100: 60,
        manual: false,
      });
    },
  );

  it('resets manual choices across accounts and ignores saved handlers for the old account', async () => {
    const { result, rerender } = hook();
    await waitFor(() => expect(result.current.status).toBe('ready'));
    act(() => result.current.selectManual('below'));
    const oldSelect = result.current.selectManual;
    const oldReload = result.current.reload;
    rerender({ owner: 'two' });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.mode).toBe('above');
    await act(async () => {
      oldSelect('below');
      await oldReload();
    });
    expect(result.current.mode).toBe('above');
    expect(getGrades).toHaveBeenCalledTimes(2);
  });

  it('returns to guest manual mode without applying a signed-in request that completes late', async () => {
    const pending = deferred<StudentGradesDTO>();
    getGrades.mockReturnValueOnce(pending.promise);
    const { result, rerender } = hook();
    await waitFor(() => expect(getGrades).toHaveBeenCalledTimes(1));
    rerender({ owner: undefined });
    expect(result.current).toMatchObject({ status: 'ready', mode: 'above', manual: true });
    act(() => result.current.selectManual('below'));
    await act(async () => pending.resolve(scored()));
    expect(result.current).toMatchObject({
      status: 'ready',
      mode: 'below',
      manual: true,
      gpa100: null,
    });
  });

  it('deduplicates focus, visible-tab and explicit reload events while a request is pending', async () => {
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    const pending = deferred<StudentGradesDTO>();
    getGrades.mockResolvedValueOnce(scored()).mockReturnValueOnce(pending.promise);
    const { result } = hook();
    await waitFor(() => expect(result.current.status).toBe('ready'));
    let reload!: Promise<void>;
    act(() => {
      window.dispatchEvent(new Event('focus'));
      document.dispatchEvent(new Event('visibilitychange'));
      reload = result.current.reload();
    });
    await waitFor(() => expect(getGrades).toHaveBeenCalledTimes(2));
    expect(result.current).toMatchObject({ status: 'loading', mode: null, manual: false });
    await act(async () => {
      pending.resolve(scored(60, 'ALTERNATIVE'));
      await reload;
    });
    expect(result.current.mode).toBe('below');
    expect(getGrades).toHaveBeenCalledTimes(2);
  });

  it('refreshes on visible-tab return, ignoring a transition into the background', async () => {
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    getGrades
      .mockResolvedValueOnce(scored())
      .mockResolvedValueOnce({ ...empty, completedCoursesWithoutNumericGrades: ['math'] });
    const { result } = hook();
    await waitFor(() => expect(result.current.status).toBe('ready'));
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    expect(getGrades).toHaveBeenCalledTimes(1);
    visibility.mockReturnValue('visible');
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    await waitFor(() => expect(result.current.manual).toBe(true));
    expect(result.current).toMatchObject({ mode: 'above', gpa100: null, missingGradeCount: 1 });
    expect(getGrades).toHaveBeenCalledTimes(2);
  });

  it('preserves a same-account manual choice only while refreshed data still explicitly has no GPA', async () => {
    getGrades
      .mockResolvedValueOnce(empty)
      .mockResolvedValueOnce(empty)
      .mockResolvedValueOnce(scored());
    const { result } = hook();
    await waitFor(() => expect(result.current.status).toBe('ready'));
    act(() => result.current.selectManual('below'));
    await act(async () => result.current.reload());
    expect(result.current).toMatchObject({ mode: 'below', manual: true });
    await act(async () => result.current.reload());
    expect(result.current).toMatchObject({ mode: 'above', manual: false });
    act(() => result.current.selectManual('below'));
    expect(result.current.mode).toBe('above');
  });

  it('withholds stale numeric eligibility when a focus refresh fails', async () => {
    getGrades.mockResolvedValueOnce(scored()).mockRejectedValueOnce(new Error('expired session'));
    const { result } = hook();
    await waitFor(() => expect(result.current.status).toBe('ready'));
    act(() => window.dispatchEvent(new Event('focus')));
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current).toMatchObject({ mode: null, manual: false, gpa100: null });
  });

  it('removes refresh listeners and ignores late responses and retained reload handlers after unmount', async () => {
    const pending = deferred<StudentGradesDTO>();
    getGrades.mockReturnValueOnce(pending.promise);
    const { result, unmount } = hook();
    await waitFor(() => expect(getGrades).toHaveBeenCalledTimes(1));
    const reload = result.current.reload;
    unmount();
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
      document.dispatchEvent(new Event('visibilitychange'));
      await reload();
      pending.resolve(scored());
    });
    expect(getGrades).toHaveBeenCalledTimes(1);
  });
});
