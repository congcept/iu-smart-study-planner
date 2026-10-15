import { z } from 'zod';
import {
  ListOwnStudyPlanSemestersSchema,
  OwnStudyPlanSemesterMetadataSchema,
  OwnStudyPlanSemestersSchema,
  type ApiResponse,
  type ListOwnStudyPlanSemestersDTO,
  type OwnStudyPlanSemesterMetadataDTO,
} from '@iu-study-planner/shared';
import apiClient, { getSession } from './api';

const uuid = z
  .string()
  .length(36)
  .uuid()
  .transform((value) => value.toLowerCase());
const sessionScope = z.object({ id: uuid, curriculumId: uuid.nullable() });

export class SavedStudyPlanSemestersSessionChangedError extends Error {
  constructor() {
    super('Your account or curriculum changed. Return to saved plans and reload.');
  }
}

export function isOlderSavedStudyPlanSemester(
  semester: OwnStudyPlanSemesterMetadataDTO,
  boundary: OwnStudyPlanSemesterMetadataDTO,
) {
  const time = Date.parse(semester.createdAt) - Date.parse(boundary.createdAt);
  if (time !== 0) return time < 0;
  const left = /\.(\d+)Z$/.exec(semester.createdAt)?.[1] ?? '';
  const right = /\.(\d+)Z$/.exec(boundary.createdAt)?.[1] ?? '';
  const width = Math.max(left.length, right.length);
  const precisionOrder = left.padEnd(width, '0').localeCompare(right.padEnd(width, '0'));
  return precisionOrder < 0 || (precisionOrder === 0 && semester.id < boundary.id);
}

/** Semester metadata is an account-owned saved reference, never a validated academic schedule. */
export async function listSavedStudyPlanSemesters(
  ownerId: string,
  planId: string,
  expectedCurriculumId: string | null,
  input: ListOwnStudyPlanSemestersDTO = {},
  options: { boundary?: OwnStudyPlanSemesterMetadataDTO; signal?: AbortSignal } = {},
) {
  const owner = uuid.parse(ownerId);
  const plan = uuid.parse(planId);
  const curriculum = uuid.nullable().parse(expectedCurriculumId);
  const request = ListOwnStudyPlanSemestersSchema.parse(input);
  const boundary = options.boundary && OwnStudyPlanSemesterMetadataSchema.parse(options.boundary);
  const signal = options.signal;
  if (
    (request.after !== undefined && (!boundary || boundary.id !== request.after)) ||
    (request.after === undefined && boundary !== undefined)
  )
    throw new Error('Saved semester cursor does not match its confirmed page boundary');

  const verify = async () => {
    if (signal?.aborted) throw new Error('Saved semester read was cancelled');
    const received = sessionScope.safeParse(await getSession());
    if (
      !received.success ||
      received.data.id !== owner ||
      received.data.curriculumId !== curriculum
    )
      throw new SavedStudyPlanSemestersSessionChangedError();
  };
  await verify();
  let outcome: { success: true; value: unknown } | { success: false; error: unknown };
  try {
    const response = await apiClient.get<ApiResponse<unknown>>(
      `/users/me/study-plans/${plan}/semesters`,
      { params: request, signal },
    );
    if (response.data?.success !== true)
      throw new Error('Could not read saved semester references');
    outcome = { success: true, value: response.data.data };
  } catch (error) {
    outcome = { success: false, error };
  }
  // A failed request is still rechecked so its result cannot leak across account or scope changes.
  await verify();
  if (!outcome.success) throw outcome.error;
  const page = OwnStudyPlanSemestersSchema.parse(outcome.value);
  if (
    page.scope.userId !== owner ||
    page.scope.curriculumId !== curriculum ||
    page.plan.id !== plan ||
    page.after !== (request.after ?? null) ||
    (boundary &&
      page.semesters.some((semester) => !isOlderSavedStudyPlanSemester(semester, boundary)))
  )
    throw new Error(
      'Saved semester references do not match the confirmed account, plan, scope or cursor',
    );
  return page;
}
