import { z } from 'zod';
import {
  RateCourseSchema,
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
