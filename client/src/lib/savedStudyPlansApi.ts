import { z } from 'zod';
import {
  ListOwnStudyPlansSchema,
  OwnStudyPlanMetadataSchema,
  OwnStudyPlansSchema,
  type ApiResponse,
  type ListOwnStudyPlansDTO,
  type OwnStudyPlanMetadataDTO,
} from '@iu-study-planner/shared';
import apiClient, { getSession } from './api';

const uuid = z
  .string()
  .length(36)
  .uuid()
  .transform((value) => value.toLowerCase());
const scope = z.object({ id: uuid, curriculumId: uuid.nullable() });

export class SavedStudyPlansSessionChangedError extends Error {
  constructor() {
    super('Your account or curriculum changed. Reload saved study plans.');
  }
}

export function isOlderSavedStudyPlan(
  plan: OwnStudyPlanMetadataDTO,
  boundary: OwnStudyPlanMetadataDTO,
) {
  const time = Date.parse(plan.createdAt) - Date.parse(boundary.createdAt);
  if (time !== 0) return time < 0;
  const left = /\.(\d+)Z$/.exec(plan.createdAt)?.[1] ?? '';
  const right = /\.(\d+)Z$/.exec(boundary.createdAt)?.[1] ?? '';
  const width = Math.max(left.length, right.length);
  const precisionOrder = left.padEnd(width, '0').localeCompare(right.padEnd(width, '0'));
  return precisionOrder < 0 || (precisionOrder === 0 && plan.id < boundary.id);
}

/** The cookie authorizes the read; owner and continuation scope are browser preconditions. */
export async function listSavedStudyPlans(
  ownerId: string,
  input: ListOwnStudyPlansDTO = {},
  options: {
    boundary?: OwnStudyPlanMetadataDTO;
    expectedCurriculumId?: string | null;
    signal?: AbortSignal;
  } = {},
) {
  const owner = uuid.parse(ownerId);
  const request = ListOwnStudyPlansSchema.parse(input);
  const boundary = options.boundary && OwnStudyPlanMetadataSchema.parse(options.boundary);
  const expectedCurriculumId =
    options.expectedCurriculumId === undefined
      ? undefined
      : uuid.nullable().parse(options.expectedCurriculumId);
  const signal = options.signal;
  if (
    (request.after !== undefined && (!boundary || boundary.id !== request.after)) ||
    (request.after === undefined && boundary !== undefined) ||
    (request.after !== undefined && expectedCurriculumId === undefined)
  )
    throw new Error('Saved study plan cursor does not match its confirmed page boundary');

  const verify = async () => {
    if (signal?.aborted) throw new Error('Saved study plan read was cancelled');
    const parsed = scope.safeParse(await getSession());
    if (
      !parsed.success ||
      parsed.data.id !== owner ||
      (expectedCurriculumId !== undefined && parsed.data.curriculumId !== expectedCurriculumId)
    )
      throw new SavedStudyPlansSessionChangedError();
    return parsed.data;
  };
  const before = await verify();
  let outcome: { success: true; value: unknown } | { success: false; error: unknown };
  try {
    const response = await apiClient.get<ApiResponse<unknown>>('/users/me/study-plans', {
      params: request,
      signal,
    });
    if (response.data?.success !== true) throw new Error('Could not read saved study plans');
    outcome = { success: true, value: response.data.data };
  } catch (error) {
    outcome = { success: false, error };
  }
  // Even a failed read must not publish another account's response or error.
  const after = await verify();
  if (after.curriculumId !== before.curriculumId) throw new SavedStudyPlansSessionChangedError();
  if (!outcome.success) throw outcome.error;
  const page = OwnStudyPlansSchema.parse(outcome.value);
  if (
    page.scope.userId !== owner ||
    page.scope.curriculumId !== before.curriculumId ||
    page.after !== (request.after ?? null) ||
    (boundary && page.plans.some((plan) => !isOlderSavedStudyPlan(plan, boundary)))
  )
    throw new Error('Saved study plans do not match the confirmed account, scope or cursor');
  return page;
}
