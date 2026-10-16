import { z } from 'zod';
import {
  OwnStudyPlanCoursesParamsSchema,
  OwnStudyPlanReferenceReviewBodySchema,
  OwnStudyPlanReferenceReviewSchema,
  type ApiResponse,
} from '@iu-study-planner/shared';
import apiClient, { getSession } from './api';
import { SavedStudyPlanCoursesSessionChangedError } from './savedStudyPlanCoursesApi';

const sessionScope = z.object({
  id: z.string().uuid(),
  curriculumId: z.string().uuid().nullable(),
});

/** Explicit reference-slot review only; this POST never saves or activates a plan. */
export async function reviewSavedStudyPlanSemester(
  ownerId: string,
  selectedPlanId: string,
  selectedSemesterId: string,
  expectedCurriculumId: string | null,
  academicYear: number,
  academicSemester: number,
  signal?: AbortSignal,
) {
  const { planId, semesterId } = OwnStudyPlanCoursesParamsSchema.parse({
    planId: selectedPlanId,
    semesterId: selectedSemesterId,
  });
  const body = OwnStudyPlanReferenceReviewBodySchema.parse({
    expectedScope: { userId: ownerId, curriculumId: expectedCurriculumId },
    academicYear,
    academicSemester,
  });
  const verify = async () => {
    if (signal?.aborted) throw new Error('Reference review was cancelled');
    const received = await getSession().catch(() => {
      if (signal?.aborted) throw new Error('Reference review was cancelled');
      throw new SavedStudyPlanCoursesSessionChangedError();
    });
    const session = sessionScope.safeParse(received);
    if (
      !session.success ||
      session.data.id.toLowerCase() !== body.expectedScope.userId ||
      (session.data.curriculumId?.toLowerCase() ?? null) !== body.expectedScope.curriculumId
    )
      throw new SavedStudyPlanCoursesSessionChangedError();
    if (signal?.aborted) throw new Error('Reference review was cancelled');
  };
  await verify();
  let outcome: { value: unknown; success: true } | { error: unknown; success: false };
  try {
    const response = await apiClient.post<ApiResponse<unknown>>(
      `/users/me/study-plans/${planId}/semesters/${semesterId}/reference-review`,
      body,
      { signal },
    );
    if (response.data?.success !== true) throw new Error('Could not review the saved semester');
    outcome = { success: true, value: response.data.data };
  } catch (error) {
    outcome = { success: false, error };
  }
  await verify();
  if (!outcome.success) throw outcome.error;
  const result = OwnStudyPlanReferenceReviewSchema.parse(outcome.value);
  if (
    result.snapshot.scope.userId !== body.expectedScope.userId ||
    result.snapshot.scope.curriculumId !== body.expectedScope.curriculumId ||
    result.snapshot.plan.id !== planId ||
    result.snapshot.semester.id !== semesterId ||
    result.referenceSlot.academicYear !== body.academicYear ||
    result.referenceSlot.academicSemester !== body.academicSemester
  )
    throw new Error('Reference review does not match the confirmed account, semester or slot');
  return result;
}
