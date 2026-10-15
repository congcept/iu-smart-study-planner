import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  ListOwnStudyPlanSemestersDTO,
  OwnStudyPlanSemesterMetadataDTO,
} from '@iu-study-planner/shared';
import { ownerId, referenceId, referenceSession } from '@/test/fixtures/curriculumReference';
import apiClient, { getSession } from '../api';
import {
  listSavedStudyPlanSemesters,
  SavedStudyPlanSemestersSessionChangedError,
} from '../savedStudyPlanSemestersApi';

vi.mock('../api', () => ({ default: { get: vi.fn(), post: vi.fn() }, getSession: vi.fn() }));
const get = vi.mocked(apiClient.get);
const session = vi.mocked(getSession);
const planId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const semester = (n = 1): OwnStudyPlanSemesterMetadataDTO => ({
  id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
  semester: 'FALL',
  year: 2026,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  storedTotalCredits: 12,
});
const page = (semesters = [semester()], after: string | null = null) => ({
  visibility: 'CURRENT_ACCOUNT_ONLY',
  order: 'STORED_NEWEST_FIRST',
  scope: { userId: ownerId, curriculumId: null, studyPlansValidated: false },
  plan: {
    id: planId,
    name: 'Saved reference',
    description: null,
    isActive: false,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    semesterCount: 8,
  },
  pageSize: 5,
  after,
  semesters,
  nextAfter: null,
});
const respond = (value: unknown) => get.mockResolvedValue({ data: { success: true, data: value } });
beforeEach(() => {
  vi.resetAllMocks();
  session.mockResolvedValue(referenceSession(null));
  respond(page());
});

describe('account-scoped saved semester metadata reads', () => {
  it('normalizes the selected plan identifier and checks scope twice without writes', async () => {
    expect(
      await listSavedStudyPlanSemesters(ownerId.toUpperCase(), planId.toUpperCase(), null),
    ).toEqual(page());
    expect(get).toHaveBeenCalledExactlyOnceWith(`/users/me/study-plans/${planId}/semesters`, {
      params: {},
      signal: undefined,
    });
    expect(session).toHaveBeenCalledTimes(2);
    expect(apiClient.post).not.toHaveBeenCalled();
  });
  it('allows mutable saved plan metadata to change without treating it as an immutable receipt', async () => {
    const changed = page();
    changed.plan.name = 'Renamed reference';
    changed.plan.semesterCount = 9;
    respond(changed);
    expect((await listSavedStudyPlanSemesters(ownerId, planId, null)).plan.name).toBe(
      'Renamed reference',
    );
  });
  it('requires a fresh matching assigned curriculum scope', async () => {
    session.mockResolvedValue(referenceSession(referenceId));
    const assigned = { ...page(), scope: { ...page().scope, curriculumId: referenceId } };
    respond(assigned);
    expect(await listSavedStudyPlanSemesters(ownerId, planId, referenceId.toUpperCase())).toEqual(
      assigned,
    );
  });
  it('uses only the selected plan URL and confirmed cursor', async () => {
    const boundary = semester(5);
    respond(page([semester(4)], boundary.id));
    const controller = new AbortController();
    expect(
      (
        await listSavedStudyPlanSemesters(
          ownerId,
          planId,
          null,
          { after: boundary.id },
          { boundary, signal: controller.signal },
        )
      ).after,
    ).toBe(boundary.id);
    expect(get).toHaveBeenCalledWith(`/users/me/study-plans/${planId}/semesters`, {
      params: { after: boundary.id },
      signal: controller.signal,
    });
  });
  it.each(['owner', 'plan', 'scope', 'query', 'cursor'] as const)(
    'rejects invalid %s before network access',
    async (kind) => {
      await expect(
        listSavedStudyPlanSemesters(
          kind === 'owner' ? 'invalid' : ownerId,
          kind === 'plan' ? 'invalid' : planId,
          kind === 'scope' ? (undefined as unknown as null) : null,
          kind === 'query'
            ? ({ userId: ownerId } as ListOwnStudyPlanSemestersDTO)
            : kind === 'cursor'
              ? { after: semester(5).id }
              : {},
        ),
      ).rejects.toThrow();
      expect(session).not.toHaveBeenCalled();
      expect(get).not.toHaveBeenCalled();
    },
  );
  it.each(['account', 'scope'] as const)('blocks a changed preflight %s', async (kind) => {
    session.mockResolvedValue(
      referenceSession(
        kind === 'scope' ? referenceId : null,
        kind === 'account' ? referenceId : ownerId,
      ),
    );
    await expect(listSavedStudyPlanSemesters(ownerId, planId, null)).rejects.toBeInstanceOf(
      SavedStudyPlanSemestersSessionChangedError,
    );
    expect(get).not.toHaveBeenCalled();
  });
  it.each(['account', 'scope'] as const)(
    'discards a response after the final %s changes',
    async (kind) => {
      session
        .mockResolvedValueOnce(referenceSession(null))
        .mockResolvedValueOnce(
          referenceSession(
            kind === 'scope' ? referenceId : null,
            kind === 'account' ? referenceId : ownerId,
          ),
        );
      await expect(listSavedStudyPlanSemesters(ownerId, planId, null)).rejects.toBeInstanceOf(
        SavedStudyPlanSemestersSessionChangedError,
      );
    },
  );
  it('rechecks scope even when the semester read fails', async () => {
    get.mockRejectedValueOnce(new Error('foreign read failure'));
    session
      .mockResolvedValueOnce(referenceSession(null))
      .mockResolvedValueOnce(referenceSession(referenceId));
    await expect(listSavedStudyPlanSemesters(ownerId, planId, null)).rejects.toBeInstanceOf(
      SavedStudyPlanSemestersSessionChangedError,
    );
  });
  it('retains an error only for the same confirmed scope', async () => {
    const failure = new Error('offline');
    get.mockRejectedValueOnce(failure);
    await expect(listSavedStudyPlanSemesters(ownerId, planId, null)).rejects.toBe(failure);
    expect(session).toHaveBeenCalledTimes(2);
  });
  it.each([
    'plan',
    'scope',
    'owner',
    'cursor',
    'private JSON',
    'validation claim',
    'duplicate',
  ] as const)('rejects mismatched %s evidence', async (kind) => {
    const received = page();
    let value: unknown = received;
    if (kind === 'plan') received.plan.id = referenceId;
    if (kind === 'owner') received.scope.userId = referenceId;
    if (kind === 'scope')
      value = { ...received, scope: { ...received.scope, curriculumId: referenceId } };
    if (kind === 'cursor') received.after = semester(5).id;
    if (kind === 'private JSON')
      value = { ...received, semesters: [{ ...semester(), courses: [] }] };
    if (kind === 'validation claim')
      value = { ...received, scope: { ...received.scope, studyPlansValidated: true } };
    if (kind === 'duplicate') received.semesters = [semester(), semester()];
    respond(value);
    await expect(listSavedStudyPlanSemesters(ownerId, planId, null)).rejects.toThrow();
    expect(session).toHaveBeenCalledTimes(2);
  });
  it('checks the storage boundary rather than comparing academic term labels', async () => {
    const boundary = semester(5);
    const older = { ...semester(4), semester: 'SUMMER' as const, year: 2030 };
    respond(page([older], boundary.id));
    expect(
      (
        await listSavedStudyPlanSemesters(
          ownerId,
          planId,
          null,
          { after: boundary.id },
          { boundary },
        )
      ).semesters,
    ).toEqual([older]);
    respond(page([semester(6)], boundary.id));
    await expect(
      listSavedStudyPlanSemesters(ownerId, planId, null, { after: boundary.id }, { boundary }),
    ).rejects.toThrow(/cursor/);
  });
  it('snapshots the cursor and boundary before awaiting session verification', async () => {
    const boundary = semester(5);
    const input = { after: boundary.id };
    session.mockImplementationOnce(async () => {
      input.after = semester(7).id;
      boundary.id = semester(7).id;
      return referenceSession(null);
    });
    respond(page([semester(4)], semester(5).id));
    expect(
      (await listSavedStudyPlanSemesters(ownerId, planId, null, input, { boundary })).after,
    ).toBe(semester(5).id);
  });
  it('does not issue reads for an aborted request', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      listSavedStudyPlanSemesters(ownerId, planId, null, {}, { signal: controller.signal }),
    ).rejects.toThrow(/cancelled/);
    expect(get).not.toHaveBeenCalled();
    expect(session).not.toHaveBeenCalled();
  });
});
