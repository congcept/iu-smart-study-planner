import { z } from 'zod';
import type { CsReferenceVerification } from './curriculumReference';

const codeSchema = z.string().regex(/^[A-Z]{2,}\d{3,4}IU$/);
const creditsSchema = z.number().int().safe().positive();
const legacyCourseSchema = z.object({ code: codeSchema, credits: creditsSchema }).strict();
const signedCourseSchema = z
  .object({
    code: codeSchema,
    credits: creditsSchema,
    pdfPage: z.number().int().safe().positive(),
  })
  .strict();

export type SignedReferenceCatalogCourse = z.infer<typeof signedCourseSchema>;

export interface ReferenceCatalogComparison {
  sharedCodes: string[];
  legacyOnly: { code: string; credits: number }[];
  signedOnly: SignedReferenceCatalogCourse[];
  changedCredits: {
    code: string;
    legacyCredits: number;
    signedCredits: number;
    pdfPage: number;
  }[];
}

function uniqueCodes<T extends { code: string }>(rows: T[], catalog: string): Map<string, T> {
  const result = new Map<string, T>();
  for (const row of rows) {
    if (result.has(row.code)) throw new Error(`Duplicate course code in ${catalog}: ${row.code}`);
    result.set(row.code, row);
  }
  return result;
}

const compareCodes = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

/** Compare exact catalog identities and credits only; this does not verify degree rules. */
export function compareReferenceCatalogs(
  legacy: CsReferenceVerification,
  signedInput: unknown,
): ReferenceCatalogComparison {
  // The verifier's canonical course rows count once, regardless of repeated placements.
  const legacyRows = z
    .array(legacyCourseSchema)
    .parse(legacy.courses.map(({ code, credits }) => ({ code, credits })));
  const signedRows = z.array(signedCourseSchema).parse(signedInput);
  const legacyByCode = uniqueCodes(legacyRows, 'legacy reference');
  const signedByCode = uniqueCodes(signedRows, 'signed catalog');
  const sharedCodes = [...legacyByCode.keys()]
    .filter((code) => signedByCode.has(code))
    .sort(compareCodes);

  return {
    sharedCodes,
    legacyOnly: legacyRows
      .filter(({ code }) => !signedByCode.has(code))
      .sort((left, right) => compareCodes(left.code, right.code)),
    signedOnly: signedRows
      .filter(({ code }) => !legacyByCode.has(code))
      .sort((left, right) => compareCodes(left.code, right.code)),
    changedCredits: sharedCodes.flatMap((code) => {
      const legacyCourse = legacyByCode.get(code)!;
      const signedCourse = signedByCode.get(code)!;
      return legacyCourse.credits === signedCourse.credits
        ? []
        : [
            {
              code,
              legacyCredits: legacyCourse.credits,
              signedCredits: signedCourse.credits,
              pdfPage: signedCourse.pdfPage,
            },
          ];
    }),
  };
}
