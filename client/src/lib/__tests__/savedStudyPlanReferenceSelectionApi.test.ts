import { beforeEach, describe, expect, it, vi } from 'vitest';
import { referenceSession, referenceId, ownerId } from '@/test/fixtures/curriculumReference';
import { savedPlanId, savedSemesterId } from '@/test/fixtures/savedStudyPlanCourses';
import {
  extraSelectionCourseId,
  referenceSelectionBody,
  referenceSelectionState,
  referenceSelectionResult,
  referenceSelectionScope,
} from '@/test/fixtures/savedReferenceSelection';
import {
  proposedSelectionBody,
  proposedSelectionPreview,
} from '@/test/fixtures/proposedReferenceSelection';
import apiClient, { getSession } from '../api';
import { SavedStudyPlanCoursesSessionChangedError } from '../savedStudyPlanCoursesApi';
import {
  getSavedReferenceSelection,
  previewReferenceSelection,
  saveReferenceSelection,
} from '../savedStudyPlanReferenceSelectionApi';

vi.mock('../api', () => ({
  default: { get: vi.fn(), put: vi.fn(), post: vi.fn() },
  getSession: vi.fn(),
}));
const get = vi.mocked(apiClient.get);
const put = vi.mocked(apiClient.put);
const post = vi.mocked(apiClient.post);
const session = vi.mocked(getSession);
const path = `/users/me/study-plans/${savedPlanId}/semesters/${savedSemesterId}/reference-selection`;
beforeEach(() => {
  vi.resetAllMocks();
  session.mockResolvedValue(referenceSession(referenceId));
  get.mockResolvedValue({ data: { success: true, data: referenceSelectionState() } });
  put.mockResolvedValue({ data: { success: true, data: referenceSelectionResult() } });
  post.mockResolvedValue({ data: { success: true, data: proposedSelectionPreview() } });
});

describe('proposed reference selection preview API', () => {
  it('posts normalized explicit inputs without a save request ID between live session checks', async () => {
    const body = proposedSelectionBody();
    body.courseIds.push(extraSelectionCourseId);
    const expected = proposedSelectionPreview(body);
    post.mockResolvedValue({ data: { success: true, data: expected } });
    const signal = new AbortController().signal;
    const result = await previewReferenceSelection(
      {
        ownerId: ownerId.toUpperCase(),
        expectedCurriculumId: referenceId.toUpperCase(),
        planId: savedPlanId.toUpperCase(),
        semesterId: savedSemesterId.toUpperCase(),
      },
      {
        ...body,
        expectedScope: {
          userId: body.expectedScope.userId.toUpperCase(),
          curriculumId: body.expectedScope.curriculumId.toUpperCase(),
        },
        courseIds: body.courseIds.map((id) => id.toUpperCase()),
      },
      signal,
    );
    expect(result).toEqual(expected);
    expect(post).toHaveBeenCalledExactlyOnceWith(`${path}/preview`, body, { signal });
    expect(post.mock.calls[0][1]).not.toHaveProperty('requestId');
    expect(session).toHaveBeenCalledTimes(2);
    expect(session.mock.invocationCallOrder[0]).toBeLessThan(post.mock.invocationCallOrder[0]);
    expect(post.mock.invocationCallOrder[0]).toBeLessThan(session.mock.invocationCallOrder[1]);
    expect(get).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
  });

  it('accepts an empty proposal as read-only evidence without a save', async () => {
    const body = { ...proposedSelectionBody(), courseIds: [] };
    post.mockResolvedValue({ data: { success: true, data: proposedSelectionPreview(body) } });
    expect(await previewReferenceSelection(referenceSelectionScope, body)).toEqual(
      proposedSelectionPreview(body),
    );
    expect(put).not.toHaveBeenCalled();
  });

  it.each(['before-owner', 'before-context', 'after-owner', 'after-context'] as const)(
    'invalidates %s session changes without returning old evidence',
    async (kind) => {
      if (kind.startsWith('after')) session.mockResolvedValueOnce(referenceSession(referenceId));
      session.mockResolvedValue(
        kind.endsWith('owner')
          ? { ...referenceSession(referenceId), id: savedPlanId }
          : referenceSession(null),
      );
      await expect(
        previewReferenceSelection(referenceSelectionScope, proposedSelectionBody()),
      ).rejects.toBeInstanceOf(SavedStudyPlanCoursesSessionChangedError);
      expect(post).toHaveBeenCalledTimes(kind.startsWith('before') ? 0 : 1);
    },
  );

  it.each(['before', 'after'] as const)(
    'maps failed %s session verification to account invalidation',
    async (when) => {
      if (when === 'after') session.mockResolvedValueOnce(referenceSession(referenceId));
      session.mockRejectedValue(new Error('session unavailable'));
      await expect(
        previewReferenceSelection(referenceSelectionScope, proposedSelectionBody()),
      ).rejects.toBeInstanceOf(SavedStudyPlanCoursesSessionChangedError);
      expect(post).toHaveBeenCalledTimes(when === 'before' ? 0 : 1);
    },
  );

  it('verifies the session after an HTTP failure before revealing its error', async () => {
    post.mockRejectedValue(new Error('private earlier account evidence'));
    session
      .mockResolvedValueOnce(referenceSession(referenceId))
      .mockResolvedValueOnce(referenceSession(null));
    await expect(
      previewReferenceSelection(referenceSelectionScope, proposedSelectionBody()),
    ).rejects.toBeInstanceOf(SavedStudyPlanCoursesSessionChangedError);
    expect(session).toHaveBeenCalledTimes(2);
  });

  it('preserves a same-account HTTP failure without a mutation or retry', async () => {
    const failure = new Error('preview unavailable');
    post.mockRejectedValue(failure);
    await expect(
      previewReferenceSelection(referenceSelectionScope, proposedSelectionBody()),
    ).rejects.toBe(failure);
    expect(post).toHaveBeenCalledTimes(1);
    expect(session).toHaveBeenCalledTimes(2);
    expect(put).not.toHaveBeenCalled();
  });

  it.each([
    'owner',
    'context',
    'plan',
    'semester',
    'revision',
    'academic-year',
    'academic-semester',
    'ordered-course-ids',
  ] as const)('rejects otherwise valid evidence for a different %s', async (kind) => {
    const body = proposedSelectionBody();
    body.courseIds.push(extraSelectionCourseId);
    const value = proposedSelectionPreview(body);
    if (kind === 'owner') value.scope.userId = referenceId;
    if (kind === 'context') value.scope.curriculumId = savedPlanId;
    if (kind === 'plan') value.planId = referenceId;
    if (kind === 'semester') value.semesterId = referenceId;
    if (kind === 'revision') value.revision++;
    if (kind === 'academic-year') value.referenceSlot.academicYear++;
    if (kind === 'academic-semester') value.referenceSlot.academicSemester = 2;
    if (kind === 'ordered-course-ids') {
      value.courseIds.reverse();
      value.assessment.entries.reverse();
    }
    post.mockResolvedValue({ data: { success: true, data: value } });
    await expect(previewReferenceSelection(referenceSelectionScope, body)).rejects.toThrow(
      'does not match the current selection',
    );
    expect(session).toHaveBeenCalledTimes(2);
  });

  it.each([
    'all-clear-with-missing-prerequisites',
    'all-clear-with-null-count',
    'unmet-with-zero-count',
    'unplaced-with-count',
    'missing-assessment',
    'wrong-assessment-order',
    'duplicate-blockers',
    'gpa-outside-fork',
    'calendar-validated',
    'degree-validated',
    'writable',
    'private-extra-fields',
  ] as const)('rejects corrupt or contradictory diagnostic evidence: %s', async (kind) => {
    const value = proposedSelectionPreview();
    const entry = value.assessment.entries[0];
    let response: unknown = value;
    if (kind === 'all-clear-with-missing-prerequisites') entry.missingPrerequisiteCount = 1;
    if (kind === 'all-clear-with-null-count') entry.missingPrerequisiteCount = null;
    if (kind === 'unmet-with-zero-count') entry.blockers = ['UNMET_PREREQUISITE'];
    if (kind === 'unplaced-with-count') entry.blockers = ['NO_CURRENT_PLACEMENT'];
    if (kind === 'missing-assessment') value.assessment.entries = [];
    if (kind === 'wrong-assessment-order') entry.courseId = extraSelectionCourseId;
    if (kind === 'duplicate-blockers') {
      entry.blockers = ['UNMET_PREREQUISITE', 'UNMET_PREREQUISITE'];
      entry.missingPrerequisiteCount = 1;
    }
    if (kind === 'gpa-outside-fork') entry.blockers = ['GPA_UNDETERMINED'];
    if (kind === 'calendar-validated')
      response = { ...value, validation: { ...value.validation, calendarValidated: true } };
    if (kind === 'degree-validated')
      response = { ...value, validation: { ...value.validation, degreeValidated: true } };
    if (kind === 'writable')
      response = { ...value, validation: { ...value.validation, readOnly: false } };
    if (kind === 'private-extra-fields') response = { ...value, requestId: referenceId };
    post.mockResolvedValue({ data: { success: true, data: response } });
    await expect(
      previewReferenceSelection(referenceSelectionScope, proposedSelectionBody()),
    ).rejects.toThrow();
    expect(session).toHaveBeenCalledTimes(2);
  });

  it.each([
    { requestId: referenceId },
    { expectedRevision: -1 },
    { academicYear: 2.5 },
    { academicSemester: 4 },
    { courseIds: ['invalid'] },
    { courseIds: [extraSelectionCourseId, extraSelectionCourseId.toUpperCase()] },
    { score: 90 },
  ])('rejects malformed proposed input before any session or HTTP request: %j', async (invalid) => {
    await expect(
      previewReferenceSelection(referenceSelectionScope, {
        ...proposedSelectionBody(),
        ...invalid,
      } as ReturnType<typeof proposedSelectionBody>),
    ).rejects.toThrow();
    expect(session).not.toHaveBeenCalled();
    expect(post).not.toHaveBeenCalled();
  });

  it.each(['owner', 'curriculum'] as const)(
    'rejects an input %s mismatch with the current scope before sending',
    async (kind) => {
      const body = proposedSelectionBody();
      if (kind === 'owner') body.expectedScope.userId = savedPlanId;
      if (kind === 'curriculum') body.expectedScope.curriculumId = savedPlanId;
      await expect(previewReferenceSelection(referenceSelectionScope, body)).rejects.toThrow(
        'scope changed',
      );
      expect(session).not.toHaveBeenCalled();
      expect(post).not.toHaveBeenCalled();
    },
  );

  it('verifies failed API envelopes before rejecting their evidence', async () => {
    post.mockResolvedValue({ data: { success: false, data: proposedSelectionPreview() } });
    await expect(
      previewReferenceSelection(referenceSelectionScope, proposedSelectionBody()),
    ).rejects.toThrow('Could not check proposed courses');
    expect(session).toHaveBeenCalledTimes(2);
  });

  it('cancels before session verification without sending', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      previewReferenceSelection(
        referenceSelectionScope,
        proposedSelectionBody(),
        controller.signal,
      ),
    ).rejects.toThrow('cancelled');
    expect(session).not.toHaveBeenCalled();
    expect(post).not.toHaveBeenCalled();
  });

  it('does not send when cancellation happens during the first session check', async () => {
    const controller = new AbortController();
    session.mockImplementationOnce(async () => {
      controller.abort();
      return referenceSession(referenceId);
    });
    await expect(
      previewReferenceSelection(
        referenceSelectionScope,
        proposedSelectionBody(),
        controller.signal,
      ),
    ).rejects.toThrow('cancelled');
    expect(post).not.toHaveBeenCalled();
  });

  it('discards successful evidence when cancellation happens during the preview request', async () => {
    const controller = new AbortController();
    post.mockImplementationOnce(async () => {
      controller.abort();
      return { data: { success: true, data: proposedSelectionPreview() } };
    });
    await expect(
      previewReferenceSelection(
        referenceSelectionScope,
        proposedSelectionBody(),
        controller.signal,
      ),
    ).rejects.toThrow('cancelled');
    expect(post).toHaveBeenCalledExactlyOnceWith(`${path}/preview`, proposedSelectionBody(), {
      signal: controller.signal,
    });
    expect(put).not.toHaveBeenCalled();
  });
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
