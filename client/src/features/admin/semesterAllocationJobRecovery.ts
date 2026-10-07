import { z } from 'zod';
import {
  CreateSemesterAllocationJobSchema,
  SemesterAllocationJobSchema,
  type ResourceScopeDTO,
} from '@iu-study-planner/shared';

const uuid = CreateSemesterAllocationJobSchema.shape.requestId;
const scopeSchema = CreateSemesterAllocationJobSchema.pick({
  curriculumId: true,
  semester: true,
  year: true,
});
const journalSchema = z
  .object({
    version: z.literal(1),
    ownerId: uuid,
    request: CreateSemesterAllocationJobSchema,
    job: SemesterAllocationJobSchema.nullable(),
  })
  .strict()
  .refine(
    (journal) => journal.ownerId === journal.request.expectedActorId,
    'Semester request recovery owner must match its request',
  )
  .refine(
    (journal) =>
      journal.job === null ||
      (journal.job.scope.curriculumId === journal.request.curriculumId &&
        journal.job.scope.semester === journal.request.semester &&
        journal.job.scope.year === journal.request.year),
    'Semester request receipt must match its scenario',
  );

export type SemesterAllocationJobJournal = z.infer<typeof journalSchema>;
export class SemesterAllocationJobRecoveryError extends Error {}

// Keep raw evidence associated with the exact object returned by read/write/confirm.
const observedBytes = new WeakMap<SemesterAllocationJobJournal, string>();

export function semesterAllocationJobRecoveryKey(ownerId: string, scope: ResourceScopeDTO) {
  const owner = uuid.parse(ownerId);
  const requested = scopeSchema.parse(scope);
  return `semester_allocation_job_request:${owner}:${requested.curriculumId}:${requested.semester}:${requested.year}`;
}

function checkedJournal(input: unknown, ownerId: string, scope: ResourceScopeDTO) {
  const journal = journalSchema.parse(input);
  const owner = uuid.parse(ownerId);
  const requested = scopeSchema.parse(scope);
  if (
    journal.ownerId !== owner ||
    journal.request.curriculumId !== requested.curriculumId ||
    journal.request.semester !== requested.semester ||
    journal.request.year !== requested.year
  )
    throw new SemesterAllocationJobRecoveryError(
      'Semester request recovery belongs to another administrator or scenario',
    );
  return journal;
}

export function readSemesterAllocationJobJournal(
  ownerId: string,
  scope: ResourceScopeDTO,
): SemesterAllocationJobJournal | null {
  try {
    const raw = sessionStorage.getItem(semesterAllocationJobRecoveryKey(ownerId, scope));
    if (raw === null) return null;
    const journal = checkedJournal(JSON.parse(raw), ownerId, scope);
    observedBytes.set(journal, raw);
    return journal;
  } catch {
    throw new SemesterAllocationJobRecoveryError(
      'Semester request recovery cannot be read or verified',
    );
  }
}

/** Confirm exactly the bytes observed before an asynchronous read without rewriting them. */
export function confirmSemesterAllocationJobJournal(
  expected: SemesterAllocationJobJournal | null,
  ownerId: string,
  scope: ResourceScopeDTO,
): SemesterAllocationJobJournal | null {
  try {
    // Validate caller expectations before touching browser evidence.
    const checked = expected === null ? null : checkedJournal(expected, ownerId, scope);
    const current = readSemesterAllocationJobJournal(ownerId, scope);
    const expectedRaw =
      expected === null ? null : (observedBytes.get(expected) ?? JSON.stringify(checked));
    const currentRaw = current === null ? null : observedBytes.get(current);
    if (currentRaw !== expectedRaw || JSON.stringify(current) !== JSON.stringify(checked))
      throw new SemesterAllocationJobRecoveryError(
        'Semester request recovery changed before it could be confirmed',
      );
    return current;
  } catch {
    throw new SemesterAllocationJobRecoveryError(
      'Semester request recovery changed or cannot be verified',
    );
  }
}

/**
 * Persist and read back the retry key synchronously immediately before an explicit POST.
 * A new key requires an observed queued receipt; the caller must freshly verify its terminal
 * outcome before requesting replacement. Terminal outcomes never enter this journal.
 */
export function writeSemesterAllocationJobJournal(
  next: SemesterAllocationJobJournal,
  previous: SemesterAllocationJobJournal | null = null,
): SemesterAllocationJobJournal {
  try {
    const checked = journalSchema.parse(next);
    const { curriculumId, semester, year } = checked.request;
    const scope = scopeSchema.parse({ curriculumId, semester, year });
    const expected = previous === null ? null : checkedJournal(previous, checked.ownerId, scope);

    if (expected === null) {
      if (checked.job !== null)
        throw new SemesterAllocationJobRecoveryError('A receipt requires a durable pending key');
    } else if (expected.request.requestId === checked.request.requestId) {
      if (
        JSON.stringify(expected.request) !== JSON.stringify(checked.request) ||
        (expected.job !== null && JSON.stringify(expected.job) !== JSON.stringify(checked.job))
      )
        throw new SemesterAllocationJobRecoveryError(
          'An existing semester request or queued receipt cannot change',
        );
    } else if (expected.job === null || checked.job !== null) {
      throw new SemesterAllocationJobRecoveryError(
        'A new pending key requires the previously confirmed receipt',
      );
    }

    confirmSemesterAllocationJobJournal(previous, checked.ownerId, scope);
    const raw = JSON.stringify(checked);
    sessionStorage.setItem(semesterAllocationJobRecoveryKey(checked.ownerId, scope), raw);
    const stored = readSemesterAllocationJobJournal(checked.ownerId, scope);
    if (stored === null || observedBytes.get(stored) !== raw)
      throw new SemesterAllocationJobRecoveryError('Semester request recovery was not confirmed');
    return stored;
  } catch {
    throw new SemesterAllocationJobRecoveryError(
      'Semester request recovery could not be saved or verified',
    );
  }
}
