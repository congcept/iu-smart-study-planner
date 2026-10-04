import { z } from 'zod';
import {
  RateCourseSchema,
  AccountWriteScopeSchema,
  ScopedOwnCourseRatingsSchema,
  type ScopedOwnCourseRatingsDTO,
  type ApiResponse,
  type OwnCourseRatingDTO,
  type RateCourseDTO,
  type SubmittedCourseRatingDTO,
} from '@iu-study-planner/shared';
import apiClient from './api';

function read<T>(response: ApiResponse<T>): T {
  if (!response.success || response.data === undefined)
    throw new Error(response.error || 'Could not load or save ratings');
  return response.data;
}
export async function getOwnRatings(): Promise<OwnCourseRatingDTO[]> {
  return read((await apiClient.get<ApiResponse<OwnCourseRatingDTO[]>>('/users/me/ratings')).data);
}
export async function rateCourse(
  courseId: string,
  data: RateCourseDTO,
): Promise<SubmittedCourseRatingDTO> {
  const id = z.string().uuid().parse(courseId).toLowerCase();
  return read(
    (
      await apiClient.post<ApiResponse<SubmittedCourseRatingDTO>>(
        `/courses/${id}/rate`,
        RateCourseSchema.parse(data),
      )
    ).data,
  );
}

/** Scope is current account context; personal votes remain global history. */
export async function getScopedOwnRatings(
  expectedUserId: string,
): Promise<ScopedOwnCourseRatingsDTO> {
  const expected = AccountWriteScopeSchema.parse({ userId: expectedUserId, curriculumId: null });
  const response = await apiClient.get<ApiResponse<unknown>>('/users/me/ratings/snapshot');
  const parsed = ScopedOwnCourseRatingsSchema.safeParse(response.data?.data);
  if (
    response.data?.success !== true ||
    !parsed.success ||
    parsed.data.scope.userId !== expected.userId
  )
    throw new Error('Could not verify saved ratings for your account. Reload to try again.');
  return parsed.data;
}
