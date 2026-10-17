import { z } from 'zod';
import {
  OwnStudyPlanCoursesParamsSchema,
  OwnStudyPlanReferenceSelectionBodySchema,
  OwnStudyPlanReferenceSelectionStateSchema,
  OwnStudyPlanReferenceSelectionResultSchema,
  type ApiResponse,
  type OwnStudyPlanReferenceSelectionBodyDTO,
} from '@iu-study-planner/shared';
import apiClient, { getSession } from './api';
import { SavedStudyPlanCoursesSessionChangedError } from './savedStudyPlanCoursesApi';

const uuid = z
  .string()
  .length(36)
  .uuid()
  .transform((value) => value.toLowerCase());
const scopeSchema = z.object({ id: uuid, curriculumId: uuid.nullable() });
export type ReferenceSelectionScope = {
  ownerId: string;
  planId: string;
  semesterId: string;
  expectedCurriculumId: string | null;
};

async function scopedRequest(
  input: ReferenceSelectionScope,
  signal: AbortSignal | undefined,
  send: (path: string) => Promise<unknown>,
) {
  const ownerId = uuid.parse(input.ownerId);
  const curriculumId = uuid.nullable().parse(input.expectedCurriculumId);
  const { planId, semesterId } = OwnStudyPlanCoursesParamsSchema.parse({
    planId: input.planId,
    semesterId: input.semesterId,
  });
  const verify = async () => {
    if (signal?.aborted) throw new Error('Request cancelled');
    let sessionReply: unknown;
    try {
      sessionReply = await getSession();
    } catch {
      if (signal?.aborted) throw new Error('Request cancelled');
      throw new SavedStudyPlanCoursesSessionChangedError();
    }
    const session = scopeSchema.safeParse(sessionReply);
    if (
      !session.success ||
      session.data.id !== ownerId ||
      session.data.curriculumId !== curriculumId
    )
      throw new SavedStudyPlanCoursesSessionChangedError();
    if (signal?.aborted) throw new Error('Request cancelled');
  };
  await verify();
  let outcome: { ok: true; value: unknown } | { ok: false; error: unknown };
  try {
    outcome = {
      ok: true,
      value: await send(
        `/users/me/study-plans/${planId}/semesters/${semesterId}/reference-selection`,
      ),
    };
  } catch (error) {
    outcome = { ok: false, error };
  }
  // Even failed HTTP replies must not reveal an earlier account's evidence.
  await verify();
  if (!outcome.ok) throw outcome.error;
  return { value: outcome.value, ownerId, curriculumId, planId, semesterId };
}

export async function getSavedReferenceSelection(
  scope: ReferenceSelectionScope,
  signal?: AbortSignal,
) {
  const read = await scopedRequest(scope, signal, async (path) => {
    const response = await apiClient.get<ApiResponse<unknown>>(path, { signal });
    if (response.data?.success !== true) throw new Error('Could not load saved selection');
    return response.data.data;
  });
  const state = OwnStudyPlanReferenceSelectionStateSchema.parse(read.value);
  if (
    state.snapshot.scope.userId !== read.ownerId ||
    state.snapshot.scope.curriculumId !== read.curriculumId ||
    state.snapshot.plan.id !== read.planId ||
    state.snapshot.semester.id !== read.semesterId
  )
    throw new Error('Selection does not match confirmed account and semester');
  return state;
}

export async function saveReferenceSelection(
  scope: ReferenceSelectionScope,
  input: OwnStudyPlanReferenceSelectionBodyDTO,
  signal?: AbortSignal,
) {
  const body = OwnStudyPlanReferenceSelectionBodySchema.parse(input);
  if (body.expectedScope.userId !== scope.ownerId.toLowerCase())
    throw new Error('Pending request owner changed');
  const saved = await scopedRequest(scope, signal, async (path) => {
    const response = await apiClient.put<ApiResponse<unknown>>(path, body, { signal });
    if (response.data?.success !== true) throw new Error('Could not confirm saved selection');
    return response.data.data;
  });
  const result = OwnStudyPlanReferenceSelectionResultSchema.parse(saved.value);
  const receipt = result.receipt;
  if (
    receipt.requestId !== body.requestId ||
    receipt.userId !== saved.ownerId ||
    receipt.curriculumId !== body.expectedScope.curriculumId ||
    receipt.planId !== saved.planId ||
    receipt.semesterId !== saved.semesterId ||
    receipt.previousRevision !== body.expectedRevision ||
    receipt.referenceSlot.academicYear !== body.academicYear ||
    receipt.referenceSlot.academicSemester !== body.academicSemester ||
    JSON.stringify(receipt.courseIds) !== JSON.stringify(body.courseIds)
  )
    throw new Error('Acknowledgement does not match the pending selection');
  return result;
}
