import { z } from 'zod';
import {
  OwnStudyPlanCoursesParamsSchema,
  OwnStudyPlanCoursesSchema,
  type ApiResponse,
} from '@iu-study-planner/shared';
import apiClient, { getSession } from './api';

const uuid = z
  .string()
  .length(36)
  .uuid()
  .transform((value) => value.toLowerCase());
const sessionScope = z.object({ id: uuid, curriculumId: uuid.nullable() });

export class SavedStudyPlanCoursesSessionChangedError extends Error {
  constructor() {
    super('Your account or curriculum changed. Return to saved semesters and reload.');
  }
}

/** Current catalog labels describe saved references, never their original academic eligibility. */
export async function getSavedStudyPlanCourses(
  ownerId: string,
  selectedPlanId: string,
  selectedSemesterId: string,
  expectedCurriculumId: string | null,
  signal?: AbortSignal,
) {
  const owner = uuid.parse(ownerId);
  const { planId, semesterId } = OwnStudyPlanCoursesParamsSchema.parse({
    planId: selectedPlanId,
    semesterId: selectedSemesterId,
  });
  const curriculum = uuid.nullable().parse(expectedCurriculumId);
  const verify = async () => {
    if (signal?.aborted) throw new Error('Saved course read was cancelled');
    const current = sessionScope.safeParse(await getSession());
    if (!current.success || current.data.id !== owner || current.data.curriculumId !== curriculum)
      throw new SavedStudyPlanCoursesSessionChangedError();
    if (signal?.aborted) throw new Error('Saved course read was cancelled');
  };
  await verify();
  let outcome: { success: true; value: unknown } | { success: false; error: unknown };
  try {
    const response = await apiClient.get<ApiResponse<unknown>>(
      `/users/me/study-plans/${planId}/semesters/${semesterId}/courses`,
      { signal },
    );
    if (response.data?.success !== true) throw new Error('Could not read saved course references');
    outcome = { success: true, value: response.data.data };
  } catch (error) {
    outcome = { success: false, error };
  }
  await verify();
  if (!outcome.success) throw outcome.error;
  const result = OwnStudyPlanCoursesSchema.parse(outcome.value);
  if (
    result.scope.userId !== owner ||
    result.scope.curriculumId !== curriculum ||
    result.plan.id !== planId ||
    result.semester.id !== semesterId
  )
    throw new Error('Saved course references do not match the confirmed account, plan or semester');
  return result;
}
