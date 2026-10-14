import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ListOwnStudyPlansDTO, OwnStudyPlanMetadataDTO } from '@iu-study-planner/shared';
import { ownerId, referenceId, referenceSession } from '@/test/fixtures/curriculumReference';
import apiClient, { getSession } from '../api';
import { listSavedStudyPlans, SavedStudyPlansSessionChangedError } from '../savedStudyPlansApi';

vi.mock('../api', () => ({ default: { get: vi.fn(), post: vi.fn() }, getSession: vi.fn() }));
const get = vi.mocked(apiClient.get);
const session = vi.mocked(getSession);
const metadata = (n = 1): OwnStudyPlanMetadataDTO => ({
  id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
  name: `Saved reference ${n}`,
  description: null,
  isActive: false,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  semesterCount: 2,
});
const page = (plans = [metadata()], after: string | null = null) => ({
  visibility: 'CURRENT_ACCOUNT_ONLY',
  order: 'STORED_NEWEST_FIRST',
  scope: { userId: ownerId, curriculumId: null, studyPlansValidated: false },
  pageSize: 5,
  after,
  plans,
  nextAfter: null,
});
const respond = (value: unknown) => get.mockResolvedValue({ data: { success: true, data: value } });
beforeEach(() => {
  vi.resetAllMocks();
  session.mockResolvedValue(referenceSession(null));
  respond(page());
});

describe('saved study plan account and scope guards', () => {
  it('reads only cookie-account metadata and checks the current session twice', async () => {
    expect(await listSavedStudyPlans(ownerId.toUpperCase())).toEqual(page());
    expect(get).toHaveBeenCalledExactlyOnceWith('/users/me/study-plans', {
      params: {},
      signal: undefined,
    });
    expect(session).toHaveBeenCalledTimes(2);
    expect(apiClient.post).not.toHaveBeenCalled();
  });
  it('accepts explicit assigned scope without treating older plans as validated', async () => {
    session.mockResolvedValue(referenceSession(referenceId));
    const assigned = { ...page(), scope: { ...page().scope, curriculumId: referenceId } };
    respond(assigned);
    expect(await listSavedStudyPlans(ownerId)).toEqual(assigned);
  });
  it('passes a normalized confirmed cursor and cancellation signal only', async () => {
    const boundary = metadata(8);
    respond(page([metadata(7)], boundary.id));
    const controller = new AbortController();
    expect(
      (
        await listSavedStudyPlans(
          ownerId,
          { after: boundary.id },
          { boundary, expectedCurriculumId: null, signal: controller.signal },
        )
      ).after,
    ).toBe(boundary.id);
    expect(get).toHaveBeenCalledWith('/users/me/study-plans', {
      params: { after: boundary.id },
      signal: controller.signal,
    });
  });
  it('rejects invalid owners and extra query identity selectors before network access', async () => {
    await expect(listSavedStudyPlans('invalid')).rejects.toThrow();
    await expect(
      listSavedStudyPlans(ownerId, { userId: ownerId } as ListOwnStudyPlansDTO),
    ).rejects.toThrow();
    expect(session).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
  });
  it.each(['missing', 'different', 'unscoped', 'first'] as const)(
    'rejects a %s continuation boundary before network access',
    async (kind) => {
      const boundary = metadata(8);
      await expect(
        listSavedStudyPlans(ownerId, kind === 'first' ? {} : { after: boundary.id }, {
          boundary: kind === 'missing' ? undefined : kind === 'different' ? metadata(7) : boundary,
          expectedCurriculumId: kind === 'unscoped' ? undefined : null,
        }),
      ).rejects.toThrow(/boundary/);
      expect(get).not.toHaveBeenCalled();
      expect(session).not.toHaveBeenCalled();
    },
  );
  it.each(['account', 'scope'] as const)('blocks a changed preflight %s', async (kind) => {
    session.mockResolvedValue(
      referenceSession(
        kind === 'scope' ? referenceId : null,
        kind === 'account' ? referenceId : ownerId,
      ),
    );
    await expect(
      listSavedStudyPlans(ownerId, {}, { expectedCurriculumId: null }),
    ).rejects.toBeInstanceOf(SavedStudyPlansSessionChangedError);
    expect(get).not.toHaveBeenCalled();
  });
  it.each(['account', 'scope'] as const)(
    'discards a successful response after a final %s change',
    async (kind) => {
      session
        .mockResolvedValueOnce(referenceSession(null))
        .mockResolvedValueOnce(
          referenceSession(
            kind === 'scope' ? referenceId : null,
            kind === 'account' ? referenceId : ownerId,
          ),
        );
      await expect(listSavedStudyPlans(ownerId)).rejects.toBeInstanceOf(
        SavedStudyPlansSessionChangedError,
      );
    },
  );
  it('rechecks failed reads before publishing their errors', async () => {
    get.mockRejectedValueOnce(new Error('foreign failure'));
    session
      .mockResolvedValueOnce(referenceSession(null))
      .mockResolvedValueOnce(referenceSession(referenceId));
    await expect(listSavedStudyPlans(ownerId)).rejects.toBeInstanceOf(
      SavedStudyPlansSessionChangedError,
    );
    expect(session).toHaveBeenCalledTimes(2);
  });
  it('preserves a read failure only for the same confirmed session', async () => {
    const failure = new Error('offline');
    get.mockRejectedValueOnce(failure);
    await expect(listSavedStudyPlans(ownerId)).rejects.toBe(failure);
    expect(session).toHaveBeenCalledTimes(2);
  });
  it.each([
    'owner',
    'scope',
    'cursor',
    'private fields',
    'validation claim',
    'duplicate',
    'order',
  ] as const)('rejects mismatched %s evidence', async (kind) => {
    const received = page();
    let value: unknown = received;
    if (kind === 'owner') received.scope.userId = referenceId;
    if (kind === 'scope')
      value = { ...received, scope: { ...received.scope, curriculumId: referenceId } };
    if (kind === 'cursor') received.after = metadata(8).id;
    if (kind === 'private fields')
      value = { ...received, plans: [{ ...metadata(), semesters: [] }] };
    if (kind === 'validation claim')
      value = { ...received, scope: { ...received.scope, studyPlansValidated: true } };
    if (kind === 'duplicate') received.plans = [metadata(), metadata()];
    if (kind === 'order') received.plans = [metadata(1), metadata(2)];
    respond(value);
    await expect(listSavedStudyPlans(ownerId)).rejects.toThrow();
    expect(session).toHaveBeenCalledTimes(2);
  });
  it('rejects continuation rows newer than the confirmed boundary', async () => {
    const boundary = metadata(5);
    respond(page([metadata(6)], boundary.id));
    await expect(
      listSavedStudyPlans(
        ownerId,
        { after: boundary.id },
        { boundary, expectedCurriculumId: null },
      ),
    ).rejects.toThrow(/cursor/);
  });
  it('preserves submillisecond cursor ordering', async () => {
    const boundary = { ...metadata(5), createdAt: '2026-10-01T00:00:00.000002Z' };
    const older = { ...metadata(6), createdAt: '2026-10-01T00:00:00.000001Z' };
    respond(page([older], boundary.id));
    expect(
      (
        await listSavedStudyPlans(
          ownerId,
          { after: boundary.id },
          { boundary, expectedCurriculumId: null },
        )
      ).plans,
    ).toEqual([older]);
  });
  it('snapshots mutable request, boundary and expected scope before session awaits', async () => {
    const boundary = metadata(5);
    const input = { after: boundary.id };
    const options = { boundary, expectedCurriculumId: null as string | null };
    session.mockImplementationOnce(async () => {
      input.after = metadata(7).id;
      boundary.id = metadata(7).id;
      options.expectedCurriculumId = referenceId;
      return referenceSession(null);
    });
    respond(page([metadata(4)], metadata(5).id));
    expect((await listSavedStudyPlans(ownerId, input, options)).after).toBe(metadata(5).id);
    expect(get).toHaveBeenCalledWith('/users/me/study-plans', {
      params: { after: metadata(5).id },
      signal: undefined,
    });
  });
  it('does not read when preflight or final confirmation is unavailable', async () => {
    session.mockRejectedValueOnce(new Error('preflight offline'));
    await expect(listSavedStudyPlans(ownerId)).rejects.toThrow(/preflight/);
    expect(get).not.toHaveBeenCalled();
    session
      .mockResolvedValueOnce(referenceSession(null))
      .mockRejectedValueOnce(new Error('final offline'));
    await expect(listSavedStudyPlans(ownerId)).rejects.toThrow(/final/);
  });
  it('rejects an unsuccessful envelope and an already aborted request', async () => {
    get.mockResolvedValueOnce({ data: { success: false, data: page() } });
    await expect(listSavedStudyPlans(ownerId)).rejects.toThrow(/read/);
    const controller = new AbortController();
    controller.abort();
    get.mockClear();
    session.mockClear();
    await expect(listSavedStudyPlans(ownerId, {}, { signal: controller.signal })).rejects.toThrow(
      /cancelled/,
    );
    expect(get).not.toHaveBeenCalled();
    expect(session).not.toHaveBeenCalled();
  });
});
