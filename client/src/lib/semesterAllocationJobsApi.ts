import {
  CreateSemesterAllocationJobSchema,
  SemesterAllocationJobSchema,
  SemesterAllocationJobOutcomeSchema,
  SemesterAllocationJobExecutionSchema,
  ExecuteSemesterAllocationJobSchema,
  type ApiResponse,
  type CreateSemesterAllocationJobDTO,
  type SemesterAllocationJobDTO,
  type SemesterAllocationJobOutcomeDTO,
} from '@iu-study-planner/shared';
import apiClient, { getSession } from './api';

const uuid = SemesterAllocationJobSchema.shape.id;
const options = { timeout: 40000 };
const invalid = () =>
  new Error('Could not verify the semester request. Retry with the original request or receipt.');

type BeforeSend = () => undefined;
function checkedBeforeSend(callback?: BeforeSend) {
  if (callback !== undefined && typeof callback !== 'function') throw invalid();
  return callback;
}
function confirmBeforeSend(callback?: BeforeSend) {
  // No await separates durable tab/generation confirmation from the explicit POST.
  if (callback !== undefined && callback() !== undefined)
    throw new Error('Semester request confirmation must finish synchronously before submission.');
}

export class SemesterJobSessionChangedError extends Error {
  constructor() {
    super(
      'Your admin session changed. Sign in as this administrator before recovering the semester request.',
    );
  }
}

async function underAdmin<T>(owner: string, operation: () => Promise<T>): Promise<T> {
  const verify = async () => {
    const account = await getSession();
    const id = uuid.safeParse(account?.id);
    if (!id.success || id.data !== owner || account.role !== 'ADMIN')
      throw new SemesterJobSessionChangedError();
  };
  await verify();
  let result: { success: true; value: T } | { success: false; failure: unknown };
  try {
    result = { success: true, value: await operation() };
  } catch (failure) {
    result = { success: false, failure };
  }
  // Recheck failures too; never publish another account's reply or error to this owner.
  await verify();
  if (!result.success) throw result.failure;
  return result.value;
}

function sameScope(
  left: SemesterAllocationJobDTO['scope'],
  right: SemesterAllocationJobDTO['scope'],
) {
  return (
    left.curriculumId === right.curriculumId &&
    left.semester === right.semester &&
    left.year === right.year
  );
}

function verifyReceipt(response: ApiResponse<unknown>, scope: SemesterAllocationJobDTO['scope']) {
  const parsed = SemesterAllocationJobSchema.safeParse(response?.data);
  if (response?.success !== true || !parsed.success || !sameScope(parsed.data.scope, scope))
    throw invalid();
  return parsed.data;
}

function assertOutcome(
  outcome: SemesterAllocationJobOutcomeDTO,
  receipt: SemesterAllocationJobDTO,
) {
  if (
    outcome.jobId !== receipt.id ||
    outcome.model !== receipt.model ||
    outcome.queuedAt !== receipt.queuedAt ||
    !sameScope(outcome.scope, receipt.scope)
  )
    throw invalid();
}

function previousOutcome(
  receipt: SemesterAllocationJobDTO,
  previous?: SemesterAllocationJobOutcomeDTO,
) {
  const parsed =
    previous === undefined ? undefined : SemesterAllocationJobOutcomeSchema.parse(previous);
  if (parsed) assertOutcome(parsed, receipt);
  return parsed;
}

function assertTransition(
  next: SemesterAllocationJobOutcomeDTO,
  previous?: SemesterAllocationJobOutcomeDTO,
) {
  if (
    previous &&
    previous.status !== 'PENDING' &&
    JSON.stringify(previous) !== JSON.stringify(next)
  )
    throw invalid();
}

/** Caller confirms durable tab recovery before the one explicit enqueue; no automatic writes. */
export async function enqueueSemesterAllocationJob(
  input: CreateSemesterAllocationJobDTO,
  beforeSend?: BeforeSend,
) {
  const request = CreateSemesterAllocationJobSchema.parse(input);
  const confirmation = checkedBeforeSend(beforeSend);
  const scope = SemesterAllocationJobSchema.shape.scope.parse({
    curriculumId: request.curriculumId,
    semester: request.semester,
    year: request.year,
  });
  return underAdmin(request.expectedActorId, async () => {
    confirmBeforeSend(confirmation);
    const response = await apiClient.post<ApiResponse<unknown>>(
      '/admin/semester-allocation-jobs',
      request,
      options,
    );
    return verifyReceipt(response.data, scope);
  });
}

/** Exact confirmation is bound to the whole original immutable enqueue receipt. */
export async function getSemesterAllocationJob(
  ownerId: string,
  expected: SemesterAllocationJobDTO,
) {
  const owner = uuid.parse(ownerId);
  const receipt = SemesterAllocationJobSchema.parse(expected);
  return underAdmin(owner, async () => {
    const response = await apiClient.get<ApiResponse<unknown>>(
      `/admin/semester-allocation-jobs/${receipt.id}`,
      options,
    );
    const actual = verifyReceipt(response.data, receipt.scope);
    if (JSON.stringify(actual) !== JSON.stringify(receipt)) throw invalid();
    return actual;
  });
}

export async function getSemesterAllocationJobOutcome(
  ownerId: string,
  expected: SemesterAllocationJobDTO,
  previous?: SemesterAllocationJobOutcomeDTO,
) {
  const owner = uuid.parse(ownerId);
  const receipt = SemesterAllocationJobSchema.parse(expected);
  const prior = previousOutcome(receipt, previous);
  return underAdmin(owner, async () => {
    const response = await apiClient.get<ApiResponse<unknown>>(
      `/admin/semester-allocation-jobs/${receipt.id}/outcome`,
      options,
    );
    if (response.data?.success !== true) throw invalid();
    const outcome = SemesterAllocationJobOutcomeSchema.parse(response.data.data);
    assertOutcome(outcome, receipt);
    assertTransition(outcome, prior);
    return outcome;
  });
}

/** The selected job is the write retry identity. Lost replies never generate or submit a new key. */
export async function executeSemesterAllocationJob(
  ownerId: string,
  expected: SemesterAllocationJobDTO,
  previous?: SemesterAllocationJobOutcomeDTO,
  beforeSend?: BeforeSend,
) {
  const owner = uuid.parse(ownerId);
  const receipt = SemesterAllocationJobSchema.parse(expected);
  const prior = previousOutcome(receipt, previous);
  const confirmation = checkedBeforeSend(beforeSend);
  const request = ExecuteSemesterAllocationJobSchema.parse({
    ...receipt.scope,
    expectedActorId: owner,
  });
  return underAdmin(owner, async () => {
    confirmBeforeSend(confirmation);
    const response = await apiClient.post<ApiResponse<unknown>>(
      `/admin/semester-allocation-jobs/${receipt.id}/execute`,
      request,
      options,
    );
    if (response.data?.success !== true) throw invalid();
    const result = SemesterAllocationJobExecutionSchema.parse(response.data.data);
    assertOutcome(result.outcome, receipt);
    assertTransition(result.outcome, prior);
    return result;
  });
}
