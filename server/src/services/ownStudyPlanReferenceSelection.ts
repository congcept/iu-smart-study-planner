import { isDeepStrictEqual } from 'node:util';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import {
  OwnStudyPlanCoursesParamsSchema,
  OwnStudyPlanReferenceSelectionBodySchema,
  OwnStudyPlanReferenceSelectionStateSchema,
  OwnStudyPlanReferenceSelectionResultSchema,
  ReferenceSaveMetadataSchema,
  OwnStudyPlanReferenceSelectionPreviewBodySchema,
  OwnStudyPlanReferenceSelectionPreviewSchema,
  type OwnStudyPlanReferenceSelectionPreviewBodyDTO,
  type OwnStudyPlanReferenceSelectionPreviewDTO,
  type OwnStudyPlanReferenceSelectionBodyDTO,
  type OwnStudyPlanReferenceSelectionResultDTO,
  type OwnStudyPlanReferenceSelectionStateDTO,
} from '@iu-study-planner/shared';
import { prisma } from '../db';
import { readOwnStudyPlanCoursesInTransaction } from './ownStudyPlanCourses';
import { reviewOwnStudyPlanReferenceSlotInTransaction } from './ownStudyPlanReferenceReview';
import { OwnStudyPlanSemestersError } from './ownStudyPlanSemesters';
import { calculateTotals } from './plannedSemesters';

const actorUuid = z
  .string()
  .length(36)
  .uuid()
  .transform((id) => id.toLowerCase());

/** Read-only proposed selection assessment; later saves independently recheck all policy. */
export function previewOwnStudyPlanReferenceSelection(
  actorId: string,
  selectedPlan: string,
  selectedSemester: string,
  input: OwnStudyPlanReferenceSelectionPreviewBodyDTO,
): Promise<OwnStudyPlanReferenceSelectionPreviewDTO> {
  actorId = actorUuid.parse(actorId);
  const { planId, semesterId } = OwnStudyPlanCoursesParamsSchema.parse({
    planId: selectedPlan,
    semesterId: selectedSemester,
  });
  const body = OwnStudyPlanReferenceSelectionPreviewBodySchema.parse(input);
  return prisma.$transaction(
    async (tx) => {
      const version = await ownedVersion(tx, actorId, planId, semesterId);
      const snapshot = await readOwnStudyPlanCoursesInTransaction(tx, actorId, planId, semesterId);
      if (
        snapshot.scope.userId !== body.expectedScope.userId ||
        snapshot.scope.curriculumId !== body.expectedScope.curriculumId
      )
        throw new OwnStudyPlanSemestersError(
          'Your account or curriculum changed; reload before checking',
          409,
        );
      if (version.revision !== body.expectedRevision)
        throw new OwnStudyPlanSemestersError('Saved semester changed; reload before checking', 409);
      if (snapshot.courseReferences.status !== 'RECOGNIZED')
        throw new OwnStudyPlanSemestersError(
          'Saved course references cannot be safely edited',
          409,
        );
      const rows = await tx.curriculumCourse.findMany({
        where: {
          curriculumId: body.expectedScope.curriculumId,
          courseId: { in: body.courseIds },
          placements: { some: {} },
        },
        select: { course: { select: { id: true, code: true, name: true } } },
      });
      const catalog = new Map(rows.map(({ course }) => [course.id, course]));
      // Internal adapter for the shared policy evaluator, never returned as saved evidence.
      const proposed = {
        ...snapshot,
        courseReferences: {
          status: 'RECOGNIZED' as const,
          order: 'STORED_ARRAY_ORDER' as const,
          entries: body.courseIds.map((courseId, storedPosition) => ({
            courseId,
            storedPosition,
            currentCurriculumMembership: catalog.has(courseId)
              ? ('PLACED_MEMBER' as const)
              : ('NO_CURRENT_PLACEMENT' as const),
            catalog: catalog.has(courseId)
              ? { code: catalog.get(courseId)!.code, name: catalog.get(courseId)!.name }
              : null,
          })),
        },
      };
      const reviewed = await reviewOwnStudyPlanReferenceSlotInTransaction(tx, proposed, body);
      if (reviewed.review.status !== 'ASSESSED')
        throw new OwnStudyPlanSemestersError('Proposed courses could not be assessed', 409);
      return OwnStudyPlanReferenceSelectionPreviewSchema.parse({
        scope: body.expectedScope,
        planId,
        semesterId,
        revision: version.revision,
        referenceSlot: { academicYear: body.academicYear, academicSemester: body.academicSemester },
        courseIds: body.courseIds,
        assessment: {
          basis: reviewed.review.basis,
          gpaPath: reviewed.review.gpaPath,
          entries: reviewed.review.entries,
        },
        validation: { readOnly: true, calendarValidated: false, degreeValidated: false },
      });
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
}

async function ownedVersion(
  tx: Prisma.TransactionClient,
  actorId: string,
  planId: string,
  semesterId: string,
) {
  const actor = await tx.user.findUnique({ where: { id: actorId }, select: { id: true } });
  if (!actor) throw new OwnStudyPlanSemestersError('Authentication required', 401);
  const semester = await tx.plannedSemester.findFirst({
    where: { id: semesterId, studyPlanId: planId, studyPlan: { userId: actor.id } },
    select: { revision: true, referenceMetadata: true },
  });
  if (!semester) throw new OwnStudyPlanSemestersError('Saved semester not found', 404);
  return semester;
}

export function readOwnStudyPlanReferenceSelection(
  actorId: string,
  selectedPlan: string,
  selectedSemester: string,
): Promise<OwnStudyPlanReferenceSelectionStateDTO> {
  actorId = actorUuid.parse(actorId);
  const { planId, semesterId } = OwnStudyPlanCoursesParamsSchema.parse({
    planId: selectedPlan,
    semesterId: selectedSemester,
  });
  return prisma.$transaction(
    async (tx) => {
      const version = await ownedVersion(tx, actorId, planId, semesterId);
      const snapshot = await readOwnStudyPlanCoursesInTransaction(tx, actorId, planId, semesterId);
      const curriculumId = snapshot.scope.curriculumId;
      let editing: OwnStudyPlanReferenceSelectionStateDTO['editing'];
      if (curriculumId === null)
        editing = { status: 'UNAVAILABLE', reason: 'NO_ASSIGNED_CURRICULUM' };
      else if (snapshot.courseReferences.status !== 'RECOGNIZED')
        editing = { status: 'UNAVAILABLE', reason: 'COURSE_REFERENCES_UNAVAILABLE' };
      else {
        const rows = await tx.curriculumCourse.findMany({
          where: { curriculumId, placements: { some: {} } },
          select: { course: { select: { id: true, code: true, name: true } } },
          orderBy: { courseId: 'asc' },
          take: 1001,
        });
        if (rows.length > 1000)
          throw new OwnStudyPlanSemestersError(
            'Current curriculum exceeds the reference editor limit',
            409,
          );
        editing = { status: 'AVAILABLE', courses: rows.map(({ course }) => course) };
      }
      const metadata =
        version.referenceMetadata === null
          ? null
          : ReferenceSaveMetadataSchema.safeParse(version.referenceMetadata);
      if (metadata && !metadata.success)
        throw new OwnStudyPlanSemestersError('Saved reference metadata could not be verified', 409);
      const state = OwnStudyPlanReferenceSelectionStateSchema.safeParse({
        snapshot,
        revision: version.revision,
        lastReferenceSave: metadata ? metadata.data : null,
        editing,
      });
      if (!state.success)
        throw new OwnStudyPlanSemestersError('Saved reference state could not be verified', 409);
      return state.data;
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
}

/** Serializable policy validation, exact revision compare-and-save and immutable retry receipt. */
export async function saveOwnStudyPlanReferenceSelection(
  actorId: string,
  selectedPlan: string,
  selectedSemester: string,
  input: OwnStudyPlanReferenceSelectionBodyDTO,
): Promise<OwnStudyPlanReferenceSelectionResultDTO> {
  actorId = actorUuid.parse(actorId);
  const { planId, semesterId } = OwnStudyPlanCoursesParamsSchema.parse({
    planId: selectedPlan,
    semesterId: selectedSemester,
  });
  const body = OwnStudyPlanReferenceSelectionBodySchema.parse(input);
  const canonical = { planId, semesterId, ...body };
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          const version = await ownedVersion(tx, actorId, planId, semesterId);
          const prior = await tx.referenceSelectionReceipt.findUnique({
            where: { userId_requestId: { userId: actorId, requestId: body.requestId } },
          });
          if (prior) {
            if (!isDeepStrictEqual(prior.requestJson, canonical))
              throw new OwnStudyPlanSemestersError(
                'Request key was already used for different input',
                409,
              );
            const parsed = OwnStudyPlanReferenceSelectionResultSchema.safeParse({
              receipt: prior.receiptJson,
              replayed: true,
            });
            if (!parsed.success)
              throw new OwnStudyPlanSemestersError(
                'Saved acknowledgement could not be verified',
                409,
              );
            const receipt = parsed.data.receipt;
            const expectedBinding = {
              requestId: body.requestId,
              userId: actorId,
              curriculumId: body.expectedScope.curriculumId,
              planId,
              semesterId,
              previousRevision: body.expectedRevision,
              referenceSlot: {
                academicYear: body.academicYear,
                academicSemester: body.academicSemester,
              },
              courseIds: body.courseIds,
            };
            const binding = {
              requestId: receipt.requestId,
              userId: receipt.userId,
              curriculumId: receipt.curriculumId,
              planId: receipt.planId,
              semesterId: receipt.semesterId,
              previousRevision: receipt.previousRevision,
              referenceSlot: receipt.referenceSlot,
              courseIds: receipt.courseIds,
            };
            if (!isDeepStrictEqual(binding, expectedBinding))
              throw new OwnStudyPlanSemestersError(
                'Saved acknowledgement does not match the original request',
                409,
              );
            return parsed.data;
          }
          const snapshot = await readOwnStudyPlanCoursesInTransaction(
            tx,
            actorId,
            planId,
            semesterId,
          );
          if (
            snapshot.scope.userId !== body.expectedScope.userId ||
            snapshot.scope.curriculumId !== body.expectedScope.curriculumId
          )
            throw new OwnStudyPlanSemestersError(
              'Your account or curriculum changed; reload before saving',
              409,
            );
          if (version.revision !== body.expectedRevision)
            throw new OwnStudyPlanSemestersError(
              'Saved semester changed; reload before saving',
              409,
            );
          if (version.revision === 2147483647)
            throw new OwnStudyPlanSemestersError('Saved semester revision limit reached', 409);
          if (snapshot.courseReferences.status !== 'RECOGNIZED')
            throw new OwnStudyPlanSemestersError(
              'Saved course references cannot be safely edited',
              409,
            );
          const rows = await tx.curriculumCourse.findMany({
            where: {
              curriculumId: body.expectedScope.curriculumId,
              courseId: { in: body.courseIds },
              placements: { some: {} },
            },
            select: { course: { select: { id: true, code: true, name: true } } },
          });
          const catalog = new Map(rows.map(({ course }) => [course.id, course]));
          if (catalog.size !== body.courseIds.length)
            throw new OwnStudyPlanSemestersError(
              'One or more courses have no placement in your current curriculum',
              409,
            );
          const proposed = {
            ...snapshot,
            courseReferences: {
              status: 'RECOGNIZED' as const,
              order: 'STORED_ARRAY_ORDER' as const,
              entries: body.courseIds.map((courseId, storedPosition) => ({
                courseId,
                storedPosition,
                currentCurriculumMembership: 'PLACED_MEMBER' as const,
                catalog: { code: catalog.get(courseId)!.code, name: catalog.get(courseId)!.name },
              })),
            },
          };
          const review = await reviewOwnStudyPlanReferenceSlotInTransaction(tx, proposed, body);
          if (
            review.review.status !== 'ASSESSED' ||
            review.review.entries.some(({ blockers }) => blockers.length > 0)
          )
            throw new OwnStudyPlanSemestersError(
              'Selected courses do not satisfy the current reference-slot requirements; review placement, GPA and mandatory prerequisites',
              409,
            );
          const courses = body.courseIds.map((courseId, position) => ({ courseId, position }));
          const totals = await calculateTotals(tx, courses, body.expectedScope.curriculumId);
          const savedAt = new Date().toISOString();
          const savedRevision = version.revision + 1;
          const metadata = ReferenceSaveMetadataSchema.parse({
            policy: 'CURRENT_COMPLETIONS_ONLY_V1',
            curriculumId: body.expectedScope.curriculumId,
            academicYear: body.academicYear,
            academicSemester: body.academicSemester,
            checkedAt: savedAt,
            revision: savedRevision,
          });
          const updated = await tx.plannedSemester.updateMany({
            where: { id: semesterId, studyPlanId: planId, revision: body.expectedRevision },
            data: { courses, ...totals, revision: savedRevision, referenceMetadata: metadata },
          });
          if (updated.count !== 1)
            throw new OwnStudyPlanSemestersError(
              'Saved semester changed; reload before saving',
              409,
            );
          const result = OwnStudyPlanReferenceSelectionResultSchema.parse({
            replayed: false,
            receipt: {
              requestId: body.requestId,
              userId: actorId,
              curriculumId: body.expectedScope.curriculumId,
              planId,
              semesterId,
              previousRevision: version.revision,
              savedRevision,
              referenceSlot: {
                academicYear: body.academicYear,
                academicSemester: body.academicSemester,
              },
              courseIds: body.courseIds,
              storedTotalCredits: totals.totalCredits,
              storedDifficultyScore: totals.difficultyScore,
              savedAt,
            },
          });
          await tx.referenceSelectionReceipt.create({
            data: {
              userId: actorId,
              requestId: body.requestId,
              semesterId,
              requestJson: canonical,
              receiptJson: result.receipt,
            },
          });
          return result;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        ['P2034', 'P2002'].includes(error.code)
      ) {
        if (attempt < 4) continue;
        throw new OwnStudyPlanSemestersError(
          'Plan changed concurrently; retry the same request',
          409,
        );
      }
      throw error;
    }
  }
  throw new OwnStudyPlanSemestersError('Plan changed concurrently; retry the same request', 409);
}
