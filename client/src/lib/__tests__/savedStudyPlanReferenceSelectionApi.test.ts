import { beforeEach, describe, expect, it, vi } from 'vitest';
import { referenceSession, referenceId, ownerId } from '@/test/fixtures/curriculumReference';
import { savedPlanId, savedSemesterId } from '@/test/fixtures/savedStudyPlanCourses';
import {
  referenceSelectionBody,
  referenceSelectionState,
  referenceSelectionResult,
  referenceSelectionScope,
} from '@/test/fixtures/savedReferenceSelection';
import apiClient, { getSession } from '../api';
import { SavedStudyPlanCoursesSessionChangedError } from '../savedStudyPlanCoursesApi';
import {
  getSavedReferenceSelection,
  saveReferenceSelection,
} from '../savedStudyPlanReferenceSelectionApi';

vi.mock('../api', () => ({ default: { get: vi.fn(), put: vi.fn() }, getSession: vi.fn() }));
const get = vi.mocked(apiClient.get);
const put = vi.mocked(apiClient.put);
const session = vi.mocked(getSession);
const path = `/users/me/study-plans/${savedPlanId}/semesters/${savedSemesterId}/reference-selection`;
beforeEach(() => {
  vi.resetAllMocks();
  session.mockResolvedValue(referenceSession(referenceId));
  get.mockResolvedValue({ data: { success: true, data: referenceSelectionState() } });
  put.mockResolvedValue({ data: { success: true, data: referenceSelectionResult() } });
});
describe('saved reference selection API', () => {
  it('reads exactly one scoped endpoint between live session checks', async () => {
    expect(await getSavedReferenceSelection(referenceSelectionScope)).toEqual(
      referenceSelectionState(),
    );
    expect(get).toHaveBeenCalledExactlyOnceWith(path, { signal: undefined });
    expect(session).toHaveBeenCalledTimes(2);
    expect(put).not.toHaveBeenCalled();
  });
  it('normalizes scope and sends a strict immutable request', async () => {
    await saveReferenceSelection(
      {
        ...referenceSelectionScope,
        ownerId: ownerId.toUpperCase(),
        planId: savedPlanId.toUpperCase(),
      },
      referenceSelectionBody(),
    );
    expect(put).toHaveBeenCalledExactlyOnceWith(path, referenceSelectionBody(), {
      signal: undefined,
    });
    expect(session).toHaveBeenCalledTimes(2);
  });
  it.each(['owner', 'context', 'plan', 'semester'] as const)(
    'rejects mismatched read %s',
    async (kind) => {
      const value = referenceSelectionState();
      if (kind === 'owner') value.snapshot.scope.userId = referenceId;
      if (kind === 'context') value.snapshot.scope.curriculumId = savedPlanId;
      if (kind === 'plan') value.snapshot.plan.id = referenceId;
      if (kind === 'semester') value.snapshot.semester.id = referenceId;
      get.mockResolvedValue({ data: { success: true, data: value } });
      await expect(getSavedReferenceSelection(referenceSelectionScope)).rejects.toThrow();
    },
  );
  it.each(['before', 'after'] as const)('prevents a changed session %s mutation', async (when) => {
    if (when === 'after') session.mockResolvedValueOnce(referenceSession(referenceId));
    session.mockResolvedValue(referenceSession(null));
    await expect(
      saveReferenceSelection(referenceSelectionScope, referenceSelectionBody()),
    ).rejects.toBeInstanceOf(SavedStudyPlanCoursesSessionChangedError);
    expect(put).toHaveBeenCalledTimes(when === 'before' ? 0 : 1);
  });
  it('rechecks failed mutations before exposing the old account error', async () => {
    put.mockRejectedValue(new Error('private error'));
    session
      .mockResolvedValueOnce(referenceSession(referenceId))
      .mockResolvedValueOnce({ ...referenceSession(referenceId), id: savedPlanId });
    await expect(
      saveReferenceSelection(referenceSelectionScope, referenceSelectionBody()),
    ).rejects.toBeInstanceOf(SavedStudyPlanCoursesSessionChangedError);
  });
  it.each(['read-before', 'read-after', 'save-before', 'save-after'] as const)(
    'treats rejected live session %s as invalidation',
    async (kind) => {
      if (kind.endsWith('after')) session.mockResolvedValueOnce(referenceSession(referenceId));
      session.mockRejectedValue(new Error('session unavailable'));
      const action = kind.startsWith('read')
        ? getSavedReferenceSelection(referenceSelectionScope)
        : saveReferenceSelection(referenceSelectionScope, referenceSelectionBody());
      await expect(action).rejects.toBeInstanceOf(SavedStudyPlanCoursesSessionChangedError);
    },
  );
  it('preserves same-account transport failure for recovery', async () => {
    const failure = new Error('offline');
    put.mockRejectedValue(failure);
    await expect(
      saveReferenceSelection(referenceSelectionScope, referenceSelectionBody()),
    ).rejects.toBe(failure);
    expect(session).toHaveBeenCalledTimes(2);
  });
  it.each([
    'requestId',
    'courseIds',
    'slot',
    'revision',
    'curriculum',
    'plan',
    'semester',
  ] as const)('rejects an acknowledgement for different %s', async (kind) => {
    const result = referenceSelectionResult();
    if (kind === 'requestId') result.receipt.requestId = referenceId;
    if (kind === 'courseIds') result.receipt.courseIds = [];
    if (kind === 'slot') result.receipt.referenceSlot.academicYear++;
    if (kind === 'revision') {
      result.receipt.previousRevision++;
      result.receipt.savedRevision++;
    }
    if (kind === 'curriculum') result.receipt.curriculumId = savedPlanId;
    if (kind === 'plan') result.receipt.planId = referenceId;
    if (kind === 'semester') result.receipt.semesterId = referenceId;
    put.mockResolvedValue({ data: { success: true, data: result } });
    await expect(
      saveReferenceSelection(referenceSelectionScope, referenceSelectionBody()),
    ).rejects.toThrow();
  });
  it('recovers an old-context request under the current same-account session without rebinding payload', async () => {
    session.mockResolvedValue(referenceSession(savedPlanId));
    const result = referenceSelectionResult();
    result.replayed = true;
    put.mockResolvedValue({ data: { success: true, data: result } });
    expect(
      await saveReferenceSelection(
        { ...referenceSelectionScope, expectedCurriculumId: savedPlanId },
        referenceSelectionBody(),
      ),
    ).toEqual(result);
    expect(put.mock.calls[0][1]).toEqual(referenceSelectionBody());
  });
  it('blocks foreign pending owners before sending', async () => {
    await expect(
      saveReferenceSelection(referenceSelectionScope, {
        ...referenceSelectionBody(),
        expectedScope: { userId: savedPlanId, curriculumId: referenceId },
      }),
    ).rejects.toThrow();
    expect(put).not.toHaveBeenCalled();
  });
  it('cancels before sending and rejects private fields', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      getSavedReferenceSelection(referenceSelectionScope, controller.signal),
    ).rejects.toThrow();
    await expect(
      saveReferenceSelection(referenceSelectionScope, {
        ...referenceSelectionBody(),
        score: 90,
      } as ReturnType<typeof referenceSelectionBody>),
    ).rejects.toThrow();
    expect(get).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
  });
});
