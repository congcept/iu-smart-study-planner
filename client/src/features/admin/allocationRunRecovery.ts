import { z } from 'zod';
import {
  CreateAllocationRunSchema,
  ResourceScopeSchema,
  type ResourceScopeDTO,
} from '@iu-study-planner/shared';

const uuid = z
  .string()
  .uuid()
  .transform((id) => id.toLowerCase());
export const AllocationRunCaptureRequestSchema = CreateAllocationRunSchema.extend({
  expectedActorId: uuid,
});
const journalSchema = z
  .object({
    version: z.literal(1),
    ownerId: uuid,
    request: AllocationRunCaptureRequestSchema,
    runId: uuid.optional(),
  })
  .strict()
  .refine(
    (journal) => journal.ownerId === journal.request.expectedActorId,
    'Capture recovery owner must match its request',
  );
export type AllocationRunJournal = z.infer<typeof journalSchema>;
export class AllocationRunRecoveryError extends Error {}

export function allocationRunRecoveryKey(ownerId: string, scope: ResourceScopeDTO): string {
  const owner = uuid.parse(ownerId);
  const parsed = ResourceScopeSchema.parse(scope);
  return `allocation_run_capture:${owner}:${parsed.curriculumId}:${parsed.semester}:${parsed.year}`;
}

function verifyJournal(
  input: unknown,
  ownerId: string,
  scope: ResourceScopeDTO,
): AllocationRunJournal {
  const journal = journalSchema.parse(input);
  const parsed = ResourceScopeSchema.parse(scope);
  if (
    journal.ownerId !== uuid.parse(ownerId) ||
    journal.request.curriculumId !== parsed.curriculumId ||
    journal.request.semester !== parsed.semester ||
    journal.request.year !== parsed.year
  )
    throw new AllocationRunRecoveryError(
      'Capture recovery belongs to another administrator or scenario',
    );
  return journal;
}

export function readAllocationRunJournal(
  ownerId: string,
  scope: ResourceScopeDTO,
): AllocationRunJournal | null {
  try {
    const saved = sessionStorage.getItem(allocationRunRecoveryKey(ownerId, scope));
    return saved === null ? null : verifyJournal(JSON.parse(saved), ownerId, scope);
  } catch {
    throw new AllocationRunRecoveryError('Capture recovery cannot be read or verified');
  }
}

/** Conditional writes preserve recovery data if another mounted view changed it. */
export function writeAllocationRunJournal(
  journal: AllocationRunJournal,
  expected: AllocationRunJournal | null,
): AllocationRunJournal {
  const { curriculumId, semester, year } = journal.request;
  const scope = ResourceScopeSchema.parse({ curriculumId, semester, year });
  try {
    const checked = verifyJournal(journal, journal.ownerId, scope);
    const current = readAllocationRunJournal(journal.ownerId, scope);
    if (JSON.stringify(current) !== JSON.stringify(expected))
      throw new AllocationRunRecoveryError('Capture recovery changed before it could be saved');
    sessionStorage.setItem(
      allocationRunRecoveryKey(journal.ownerId, scope),
      JSON.stringify(checked),
    );
    const saved = readAllocationRunJournal(journal.ownerId, scope);
    if (JSON.stringify(saved) !== JSON.stringify(checked))
      throw new AllocationRunRecoveryError('Capture recovery could not be confirmed');
    return checked;
  } catch {
    throw new AllocationRunRecoveryError('Capture recovery could not be saved or verified');
  }
}
