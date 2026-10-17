import { z } from 'zod';
import type { ReferenceSelectionScope } from './savedStudyPlanReferenceSelectionApi';

const normalizedUuid = z
  .string()
  .length(36)
  .uuid()
  .transform((value) => value.toLowerCase());
const draftSchema = z
  .object({
    year: z.string().max(64),
    semester: z.enum(['', '1', '2', '3']),
    courseIds: z
      .array(normalizedUuid)
      .max(100)
      .refine((ids) => new Set(ids).size === ids.length, 'Course IDs must be unique'),
  })
  .strict();

export type ReferenceSelectionDraft = z.infer<typeof draftSchema>;
export const StoredReferenceSelectionDraftSchema = z
  .object({
    version: z.literal(1),
    ownerId: normalizedUuid,
    curriculumId: normalizedUuid,
    planId: normalizedUuid,
    semesterId: normalizedUuid,
    baseRevision: z.number().int().min(0).max(2147483647),
    draft: draftSchema,
  })
  .strict();
export type StoredReferenceSelectionDraft = z.infer<typeof StoredReferenceSelectionDraftSchema>;
export type DraftRecovery =
  | { status: 'NONE' }
  | { status: 'FOUND'; value: StoredReferenceSelectionDraft; raw: string }
  | { status: 'INVALID' }
  | { status: 'UNAVAILABLE' };

const scopeSchema = z.object({
  ownerId: normalizedUuid,
  expectedCurriculumId: normalizedUuid.nullable(),
  planId: normalizedUuid,
  semesterId: normalizedUuid,
});

export function referenceSelectionDraftKey(scope: ReferenceSelectionScope): string {
  const normalized = scopeSchema.parse(scope);
  return `unsent_reference_selection:${normalized.ownerId}:${normalized.expectedCurriculumId ?? 'null'}:${normalized.planId}:${normalized.semesterId}`;
}

export function loadReferenceSelectionDraft(scope: ReferenceSelectionScope): DraftRecovery {
  const normalized = scopeSchema.safeParse(scope);
  if (!normalized.success) return { status: 'INVALID' };
  let raw: string | null;
  try {
    raw = sessionStorage.getItem(referenceSelectionDraftKey(normalized.data));
  } catch {
    return { status: 'UNAVAILABLE' };
  }
  if (raw === null) return { status: 'NONE' };
  if (raw.length > 16384) return { status: 'INVALID' };
  let parsed: z.SafeParseReturnType<unknown, StoredReferenceSelectionDraft>;
  try {
    parsed = StoredReferenceSelectionDraftSchema.safeParse(JSON.parse(raw));
  } catch {
    return { status: 'INVALID' };
  }
  if (!parsed.success) return { status: 'INVALID' };
  const value = parsed.data;
  if (
    value.ownerId !== normalized.data.ownerId ||
    value.curriculumId !== normalized.data.expectedCurriculumId ||
    value.planId !== normalized.data.planId ||
    value.semesterId !== normalized.data.semesterId
  )
    return { status: 'INVALID' };
  return { status: 'FOUND', value, raw };
}
