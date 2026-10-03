import { createHash } from 'node:crypto';
import { Prisma, type Curriculum } from '@prisma/client';
import { prisma } from '../db';
import { verifyCsReference } from './curriculumReference';
import { inspectCsBackfill } from './csBackfillPreflight';

const programUrl =
  'https://hcmiu.edu.vn/chuong-trinh-dao-tao/dao-tao-dai-hoc/khoa-cong-nghe-thong-tin/';

export class CsReferenceBackfillError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CsReferenceBackfillError';
  }
}

// Compare only explicit source fields, preserving IDs and timestamps on retries.
function missingRows<T extends object>(
  expected: T[],
  actual: T[],
  key: (row: T) => string,
  kind: string,
): T[] {
  const expectedByKey = new Map(expected.map((row) => [key(row), row]));
  const actualKeys = new Set<string>();
  for (const row of actual) {
    const wanted = expectedByKey.get(key(row));
    if (
      !wanted ||
      actualKeys.has(key(row)) ||
      (Object.keys(wanted) as (keyof T)[]).some((field) => row[field] !== wanted[field])
    ) {
      throw new CsReferenceBackfillError(`Existing ${kind} conflicts with the CS reference`);
    }
    actualKeys.add(key(row));
  }
  return expected.filter((row) => !actualKeys.has(key(row)));
}

/** Add a legacy reference context only. Never change global courses or student evidence. */
export async function backfillCsReference(bytes: Buffer, contextCode = 'CS-REFERENCE') {
  let input: unknown;
  try {
    input = JSON.parse(bytes.toString('utf8')) as unknown;
  } catch {
    throw new CsReferenceBackfillError('Invalid JSON in CS reference');
  }
  const source = verifyCsReference(input);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  if (!contextCode.trim()) throw new CsReferenceBackfillError('Context code must not be blank');

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          const catalog = await tx.course.findMany({
            where: { code: { in: source.courses.map(({ code }) => code) } },
            select: { id: true, code: true, name: true, credits: true },
          });
          const prerequisites = await tx.prerequisite.findMany({
            where: { courseId: { in: catalog.map(({ id }) => id) } },
            select: { courseId: true, prerequisiteId: true, isStrict: true, isCorequisite: true },
            orderBy: [{ courseId: 'asc' }, { prerequisiteId: 'asc' }],
          });
          const preflight = inspectCsBackfill(input, catalog, prerequisites);
          if (!preflight.preview) {
            throw new CsReferenceBackfillError(
              `CS catalog compatibility failed: ${JSON.stringify(preflight.issues)}`,
            );
          }
          const preview = preflight.preview;
          const prerequisiteSha256 = createHash('sha256')
            .update(JSON.stringify(preview.prerequisites))
            .digest('hex');
          const sourceLabel = `LEGACY_HTML_REFERENCE; sha256=${sha256}; prerequisiteSha256=${prerequisiteSha256}`;
          const metadata: Omit<Curriculum, 'id' | 'createdAt' | 'updatedAt'> = {
            code: contextCode,
            name: 'Computer Science (legacy reference)',
            school: 'School of Computer Science and Engineering',
            degree: 'Bachelor',
            programUrl,
            totalCredits: null,
            // The confirmed application policy, not a signed-cohort eligibility claim.
            isGpaPath: true,
            sourceLabel,
            sourceUrl: programUrl,
          };
          const existing = await tx.curriculum.findUnique({ where: { code: contextCode } });
          if (existing) missingRows([metadata], [existing], ({ code }) => code, 'context metadata');
          const context = existing ?? (await tx.curriculum.create({ data: metadata }));
          const curriculumId = context.id;
          const memberships = preview.courseIds.map(({ courseId }) => ({ curriculumId, courseId }));
          const storedMemberships = await tx.curriculumCourse.findMany({
            where: { curriculumId },
            select: { curriculumId: true, courseId: true },
          });
          const newMemberships = missingRows(
            memberships,
            storedMemberships,
            ({ courseId }) => courseId,
            'membership',
          );
          if (newMemberships.length) await tx.curriculumCourse.createMany({ data: newMemberships });
          const membershipRows = await tx.curriculumCourse.findMany({ where: { curriculumId } });
          const membershipIdByCourse = new Map(
            membershipRows.map(({ courseId, id }) => [courseId, id]),
          );
          const courseIdByCode = new Map(
            preview.courseIds.map(({ code, courseId }) => [code, courseId]),
          );
          const placements = source.placements.map(
            ({
              code,
              academicYear,
              academicSemester,
              electiveGroup,
              electiveSelectCount,
              sourceOrder,
            }) => ({
              curriculumCourseId: membershipIdByCourse.get(courseIdByCode.get(code)!)!,
              academicYear,
              academicSemester,
              electiveGroup,
              electiveSelectCount,
              sourceOrder,
              sourceLabel,
            }),
          );
          const storedPlacements = await tx.curriculumPlacement.findMany({
            where: { curriculumCourse: { curriculumId } },
            select: {
              curriculumCourseId: true,
              academicYear: true,
              academicSemester: true,
              electiveGroup: true,
              electiveSelectCount: true,
              sourceOrder: true,
              sourceLabel: true,
            },
          });
          const newPlacements = missingRows(
            placements,
            storedPlacements,
            ({ curriculumCourseId, sourceOrder }) =>
              JSON.stringify([curriculumCourseId, sourceOrder]),
            'placement',
          );
          const requirements = source.requirements.map(
            ({ kind, name, credits, academicYear, academicSemester, sourceOrder }) => ({
              curriculumId,
              kind,
              name,
              credits,
              academicYear,
              academicSemester,
              sourceOrder,
              sourceLabel,
            }),
          );
          const storedRequirements = await tx.curriculumRequirement.findMany({
            where: { curriculumId },
            select: {
              curriculumId: true,
              kind: true,
              name: true,
              credits: true,
              academicYear: true,
              academicSemester: true,
              sourceOrder: true,
              sourceLabel: true,
            },
          });
          const newRequirements = missingRows(
            requirements,
            storedRequirements,
            ({ sourceOrder }) => String(sourceOrder),
            'requirement',
          );
          const edges = preview.prerequisites.map((edge) => ({ curriculumId, ...edge }));
          const storedEdges = await tx.curriculumPrerequisite.findMany({
            where: { curriculumId },
            select: {
              curriculumId: true,
              courseId: true,
              prerequisiteId: true,
              isStrict: true,
              isCorequisite: true,
            },
          });
          const newEdges = missingRows(
            edges,
            storedEdges,
            ({ courseId, prerequisiteId }) => JSON.stringify([courseId, prerequisiteId]),
            'prerequisite',
          );
          if (newPlacements.length)
            await tx.curriculumPlacement.createMany({ data: newPlacements });
          if (newRequirements.length)
            await tx.curriculumRequirement.createMany({ data: newRequirements });
          if (newEdges.length) await tx.curriculumPrerequisite.createMany({ data: newEdges });
          return {
            curriculumId,
            code: contextCode,
            sha256,
            prerequisiteSha256,
            provenance: 'LEGACY_HTML_REFERENCE' as const,
            counts: {
              memberships: memberships.length,
              placements: placements.length,
              requirements: requirements.length,
              prerequisites: edges.length,
            },
            created: {
              context: existing ? 0 : 1,
              memberships: newMemberships.length,
              placements: newPlacements.length,
              requirements: newRequirements.length,
              prerequisites: newEdges.length,
            },
            readyForActivation: false as const,
          };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 15000 },
      );
    } catch (error) {
      // Concurrent identical runs can race on context uniqueness or predicate locks.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        ['P2034', 'P2002'].includes(error.code)
      )
        continue;
      throw error;
    }
  }
  throw new CsReferenceBackfillError('CS reference changed concurrently; retry the backfill');
}
