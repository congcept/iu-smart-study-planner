import { z } from 'zod';
import {
  CreateSemesterAllocationRunSchema,
  SemesterAllocationScopeV1Schema,
  type ResourceScopeDTO,
} from '@iu-study-planner/shared';

const uuid = z
  .string()
  .length(36)
  .uuid()
  .transform((id) => id.toLowerCase());
export const SemesterAllocationRunCaptureRequestSchema = CreateSemesterAllocationRunSchema;
const journalSchema = z
  .object({
    version: z.literal(1),
    ownerId: uuid,
    request: SemesterAllocationRunCaptureRequestSchema,
    runId: uuid.optional(),
  })
  .strict()
  .refine(
    (journal) => journal.ownerId === journal.request.expectedActorId,
    'Semester capture recovery owner must match its request',
  );
export type SemesterAllocationRunJournal = z.infer<typeof journalSchema>;
export class SemesterAllocationRunRecoveryError extends Error {}
const savedBytes = new WeakMap<SemesterAllocationRunJournal, string>();

export function semesterAllocationRunRecoveryKey(ownerId: string, scope: ResourceScopeDTO) {
  const owner = uuid.parse(ownerId);
  const parsed = SemesterAllocationScopeV1Schema.parse(scope);
  return `semester_allocation_run_capture:${owner}:${parsed.curriculumId}:${parsed.semester}:${parsed.year}`;
}

function verifyJournal(input: unknown, ownerId: string, scope: ResourceScopeDTO) {
  const journal = journalSchema.parse(input);
  const requested = SemesterAllocationScopeV1Schema.parse(scope);
  if (
    journal.ownerId !== uuid.parse(ownerId) ||
    journal.request.curriculumId !== requested.curriculumId ||
    journal.request.semester !== requested.semester ||
    journal.request.year !== requested.year
  )
    throw new SemesterAllocationRunRecoveryError(
      'Semester capture recovery belongs to another administrator or scenario',
    );
  return journal;
}

export function readSemesterAllocationRunJournal(
  ownerId: string,
  scope: ResourceScopeDTO,
): SemesterAllocationRunJournal | null {
  try {
    const raw = sessionStorage.getItem(semesterAllocationRunRecoveryKey(ownerId, scope));
    if (raw === null) return null;
    const journal = verifyJournal(JSON.parse(raw), ownerId, scope);
    savedBytes.set(journal, raw);
    return journal;
  } catch {
    throw new SemesterAllocationRunRecoveryError(
      'Semester capture recovery cannot be read or verified',
    );
  }
}

/** Verify the exact bytes observed before an asynchronous operation without overwriting them. */
export function confirmSemesterAllocationRunJournal(
  expected: SemesterAllocationRunJournal | null,
  ownerId: string,
  scope: ResourceScopeDTO,
) {
  try {
    const current = readSemesterAllocationRunJournal(ownerId, scope);
    const checkedExpected = expected === null ? null : verifyJournal(expected, ownerId, scope);
    const expectedRaw =
      expected === null ? null : (savedBytes.get(expected) ?? JSON.stringify(checkedExpected));
    const currentRaw = current === null ? null : savedBytes.get(current);
    if (currentRaw !== expectedRaw || JSON.stringify(current) !== JSON.stringify(checkedExpected))
      throw new SemesterAllocationRunRecoveryError(
        'Semester capture recovery changed before it could be confirmed',
      );
    return current;
  } catch {
    throw new SemesterAllocationRunRecoveryError(
      'Semester capture recovery changed or cannot be verified',
    );
  }
}

/** Conditional, exact-byte checks preserve an existing journal instead of replacing uncertain keys. */
export function writeSemesterAllocationRunJournal(
  journal: SemesterAllocationRunJournal,
  expected: SemesterAllocationRunJournal | null,
): SemesterAllocationRunJournal {
  try {
    const { curriculumId, semester, year } = journal.request;
    const scope = SemesterAllocationScopeV1Schema.parse({ curriculumId, semester, year });
    const checked = verifyJournal(journal, journal.ownerId, scope);
    confirmSemesterAllocationRunJournal(expected, checked.ownerId, scope);
    const raw = JSON.stringify(checked);
    sessionStorage.setItem(semesterAllocationRunRecoveryKey(checked.ownerId, scope), raw);
    const stored = readSemesterAllocationRunJournal(checked.ownerId, scope);
    if (stored === null || savedBytes.get(stored) !== raw)
      throw new SemesterAllocationRunRecoveryError(
        'Semester capture recovery could not be confirmed',
      );
    return stored;
  } catch {
    throw new SemesterAllocationRunRecoveryError(
      'Semester capture recovery could not be saved or verified',
    );
  }
}
