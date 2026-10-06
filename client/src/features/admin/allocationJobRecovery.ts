import { z } from 'zod';
import { CreateAllocationJobSchema, type ResourceScopeDTO } from '@iu-study-planner/shared';

const uuid = CreateAllocationJobSchema.shape.requestId;
const scopeSchema = CreateAllocationJobSchema.pick({
  curriculumId: true,
  semester: true,
  year: true,
});
const journalSchema = z
  .object({
    version: z.literal(1),
    ownerId: uuid,
    request: CreateAllocationJobSchema,
    jobId: uuid.optional(),
  })
  .strict()
  .refine(
    (journal) => journal.ownerId === journal.request.expectedActorId,
    'Queue recovery owner must match its request',
  );

export type AllocationJobJournal = z.infer<typeof journalSchema>;
export class AllocationJobRecoveryError extends Error {}

export function allocationJobRecoveryKey(ownerId: string, scope: ResourceScopeDTO): string {
  const owner = uuid.parse(ownerId);
  const parsed = scopeSchema.parse(scope);
  return `allocation_job_request:${owner}:${parsed.curriculumId}:${parsed.semester}:${parsed.year}`;
}

function verifyJournal(
  input: unknown,
  ownerId: string,
  scope: ResourceScopeDTO,
): AllocationJobJournal {
  const journal = journalSchema.parse(input);
  const owner = uuid.parse(ownerId);
  const parsed = scopeSchema.parse(scope);
  if (
    journal.ownerId !== owner ||
    journal.request.curriculumId !== parsed.curriculumId ||
    journal.request.semester !== parsed.semester ||
    journal.request.year !== parsed.year
  )
    throw new AllocationJobRecoveryError(
      'Queue recovery belongs to another administrator or scenario',
    );
  return journal;
}

export function readAllocationJobJournal(
  ownerId: string,
  scope: ResourceScopeDTO,
): AllocationJobJournal | null {
  try {
    const saved = sessionStorage.getItem(allocationJobRecoveryKey(ownerId, scope));
    return saved === null ? null : verifyJournal(JSON.parse(saved), ownerId, scope);
  } catch {
    throw new AllocationJobRecoveryError('Queue recovery cannot be read or verified');
  }
}

/** Save and verify recovery before POST. New request identities require an explicit caller decision. */
export function writeAllocationJobJournal(
  journal: AllocationJobJournal,
  expected: AllocationJobJournal | null,
): AllocationJobJournal {
  try {
    const checked = journalSchema.parse(journal);
    const { curriculumId, semester, year } = checked.request;
    const scope = scopeSchema.parse({ curriculumId, semester, year });
    const previous = expected === null ? null : verifyJournal(expected, checked.ownerId, scope);
    const current = readAllocationJobJournal(checked.ownerId, scope);
    if (JSON.stringify(current) !== JSON.stringify(previous))
      throw new AllocationJobRecoveryError('Queue recovery changed before it could be saved');
    if (current?.request.requestId === checked.request.requestId) {
      if (
        JSON.stringify(current.request) !== JSON.stringify(checked.request) ||
        (current.jobId !== undefined && current.jobId !== checked.jobId)
      )
        throw new AllocationJobRecoveryError('A queued request or confirmed receipt cannot change');
    }
    sessionStorage.setItem(
      allocationJobRecoveryKey(checked.ownerId, scope),
      JSON.stringify(checked),
    );
    const saved = readAllocationJobJournal(checked.ownerId, scope);
    if (JSON.stringify(saved) !== JSON.stringify(checked))
      throw new AllocationJobRecoveryError('Queue recovery could not be confirmed');
    return checked;
  } catch {
    throw new AllocationJobRecoveryError('Queue recovery could not be saved or verified');
  }
}
