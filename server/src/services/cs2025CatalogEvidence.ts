import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { CsReferenceVerification } from './curriculumReference';
import { compareReferenceCatalogs } from './referenceCatalogComparison';

const page = z.number().int().min(1).max(576);
const course = z
  .object({
    code: z.string().regex(/^[A-Z]{2,}\d{3,4}IU$/),
    credits: z.number().int().safe().positive(),
    pdfPage: z.number().int().min(7).max(11),
  })
  .strict();
const evidenceSchema = z
  .object({
    source: z
      .object({
        officialUrl: z.literal(
          'https://hcmiu.edu.vn/wp-content/uploads/2026/04/CTDT-K2025-Nganh-Khoa-hoc-May-tinh-Signed_compressed.pdf',
        ),
        retrievedOn: z.literal('2026-10-18'),
        bytes: z.literal(11072162),
        sha256: z.literal('00dc4476c314b80324b53f85fc5ead94e7f89350b93dd2b96e76d642ca160c9b'),
        pdfPages: z.literal(576),
        cohort: z.literal('2025'),
        programCode: z.literal('7480101'),
      })
      .strict(),
    scope: z.literal('TABLE_6_CATALOG_ONLY'),
    readiness: z.literal(false),
    statedGraduationCredits: z.literal(126),
    statedGraduationCreditsPdfPage: z.literal(6),
    courses: z.array(course).length(57),
    requirements: z
      .array(
        z
          .object({
            kind: z.literal('FREE_ELECTIVE'),
            credits: z.literal(3),
            pdfPage: z.literal(11),
            sourceRow: z.literal(54),
          })
          .strict(),
      )
      .length(1),
    blockers: z
      .array(
        z
          .object({
            code: z.enum([
              'PREREQUISITE_POLICY_CONFLICTS',
              'ELECTIVE_RULE_CONFLICTS',
              'INTERNAL_SOURCE_CONFLICTS',
              'COHORT_AND_GRADUATION_UNVERIFIED',
            ]),
            pdfPages: z.array(page).nonempty(),
            message: z.string().trim().min(1),
          })
          .strict(),
      )
      .length(4),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (new Set(value.courses.map(({ code }) => code)).size !== value.courses.length)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['courses'],
        message: 'Duplicate catalog code',
      });
    if (new Set(value.blockers.map(({ code }) => code)).size !== 4)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['blockers'],
        message: 'Every unresolved blocker must be retained',
      });
  });

/** Structural evidence validation never establishes source authenticity or curriculum readiness. */
export function readCs2025CatalogEvidence(input: unknown) {
  return evidenceSchema.parse(input);
}

/** Verify only exact artifact bytes before comparing the manually reviewed Table 6 catalog. */
export function inspectCs2025Catalog(
  legacy: CsReferenceVerification,
  evidenceInput: unknown,
  sourceBytes: Uint8Array,
) {
  const evidence = readCs2025CatalogEvidence(evidenceInput);
  if (
    sourceBytes.byteLength !== evidence.source.bytes ||
    createHash('sha256').update(sourceBytes).digest('hex') !== evidence.source.sha256
  )
    throw new Error('PDF does not match the reviewed CS 2025 source artifact');
  const comparison = compareReferenceCatalogs(legacy, evidence.courses);
  return {
    source: evidence.source,
    scope: evidence.scope,
    sourceBodyHashMatched: true,
    signatureVerified: false,
    readiness: false,
    statedGraduationCredits: evidence.statedGraduationCredits,
    statedGraduationCreditsPdfPage: evidence.statedGraduationCreditsPdfPage,
    counts: {
      legacyIdentities: legacy.courses.length,
      catalogIdentities: evidence.courses.length,
      sharedIdentities: comparison.sharedCodes.length,
      freeElectiveRequirements: evidence.requirements.length,
    },
    requirements: evidence.requirements,
    blockers: evidence.blockers,
    comparison,
  };
}
