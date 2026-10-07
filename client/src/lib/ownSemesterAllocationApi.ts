import { z } from 'zod';
import {
  ListOwnSemesterAllocationRunsSchema,
  OwnSemesterAllocationHistorySchema,
  OwnSemesterAllocationRunV1Schema,
  type ApiResponse,
  type ListOwnSemesterAllocationRunsDTO,
  type OwnSemesterAllocationRunV1DTO,
} from '@iu-study-planner/shared';
import apiClient, { getSession } from './api';

const uuid = z
  .string()
  .length(36)
  .uuid()
  .transform((id) => id.toLowerCase());
const readOptions = { timeout: 40000 };
export class OwnSemesterSessionChangedError extends Error {
  constructor() {
    super('Your account changed. Sign in as this account before reading saved simulations.');
  }
}

async function underOwner<T>(owner: string, operation: () => Promise<T>) {
  const verify = async () => {
    const session = await getSession();
    const received = uuid.safeParse(session?.id);
    if (!received.success || received.data !== owner) throw new OwnSemesterSessionChangedError();
  };
  await verify();
  let outcome: { success: true; value: T } | { success: false; failure: unknown };
  try {
    outcome = { success: true, value: await operation() };
  } catch (failure) {
    outcome = { success: false, failure };
  }
  // Recheck even failed reads so another account's error is not published to this owner.
  await verify();
  if (!outcome.success) throw outcome.failure;
  return outcome.value;
}

function olderThan(run: OwnSemesterAllocationRunV1DTO, boundary: OwnSemesterAllocationRunV1DTO) {
  const time = Date.parse(run.createdAt) - Date.parse(boundary.createdAt);
  if (time !== 0) return time < 0;
  const left = /\.(\d+)Z$/.exec(run.createdAt)?.[1] ?? '';
  const right = /\.(\d+)Z$/.exec(boundary.createdAt)?.[1] ?? '';
  const precision = Math.max(left.length, right.length);
  const comparison = left.padEnd(precision, '0').localeCompare(right.padEnd(precision, '0'));
  return comparison < 0 || (comparison === 0 && run.id < boundary.id);
}

/** The owner precondition stays in the browser; the server authorizes only its cookie account. */
export async function listOwnSemesterAllocationRuns(
  ownerId: string,
  input: ListOwnSemesterAllocationRunsDTO = {},
  boundary?: OwnSemesterAllocationRunV1DTO,
) {
  const owner = uuid.parse(ownerId);
  const request = ListOwnSemesterAllocationRunsSchema.parse(input);
  const checkedBoundary =
    boundary === undefined ? undefined : OwnSemesterAllocationRunV1Schema.parse(boundary);
  if (
    (request.after !== undefined && checkedBoundary?.id !== request.after) ||
    (request.after === undefined && checkedBoundary !== undefined)
  )
    throw new Error('Own simulation continuation does not match the confirmed page boundary');
  return underOwner(owner, async () => {
    const response = await apiClient.get<ApiResponse<unknown>>(
      '/users/me/semester-allocation-runs',
      {
        ...readOptions,
        params: request,
      },
    );
    if (response.data?.success !== true) throw new Error('Could not load own simulation history');
    const page = OwnSemesterAllocationHistorySchema.parse(response.data.data);
    if (
      page.after !== (request.after ?? null) ||
      (checkedBoundary && page.runs.some((run) => !olderThan(run, checkedBoundary)))
    )
      throw new Error('Own simulation history does not match its confirmed page boundary');
    return page;
  });
}

export async function getOwnSemesterAllocationRun(
  ownerId: string,
  id: string,
  expected?: OwnSemesterAllocationRunV1DTO,
) {
  const owner = uuid.parse(ownerId);
  const runId = uuid.parse(id);
  const checked =
    expected === undefined ? undefined : OwnSemesterAllocationRunV1Schema.parse(expected);
  if (checked && checked.id !== runId)
    throw new Error('Selected own simulation receipt does not match its identifier');
  return underOwner(owner, async () => {
    const response = await apiClient.get<ApiResponse<unknown>>(
      `/users/me/semester-allocation-runs/${runId}`,
      readOptions,
    );
    if (response.data?.success !== true) throw new Error('Could not load own simulation result');
    const run = OwnSemesterAllocationRunV1Schema.parse(response.data.data);
    if (run.id !== runId || (checked && JSON.stringify(checked) !== JSON.stringify(run)))
      throw new Error('Own simulation result does not match the selected immutable receipt');
    return run;
  });
}
