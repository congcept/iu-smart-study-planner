import { Prisma } from '@prisma/client';
import { z } from 'zod';
import {
  OwnStudyPlanCoursesParamsSchema,
  OwnStudyPlanCoursesSchema,
  type OwnStudyPlanCoursesDTO,
} from '@iu-study-planner/shared';
import { prisma } from '../db';
import { OwnStudyPlanSemestersError } from './ownStudyPlanSemesters';

const storedReferences = z
  .array(
    z
      .object({
        courseId: z
          .string()
          .length(36)
          .uuid()
          .transform((id) => id.toLowerCase()),
        position: z.number().int().min(Number.MIN_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER),
      })
      .strict(),
  )
  .max(100)
  .superRefine((entries, ctx) => {
    if (new Set(entries.map(({ courseId }) => courseId)).size !== entries.length)
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Duplicate course references' });
  });

/** Only bounded recognized JSON reaches application lookups; no historical eligibility is inferred. */
export function readOwnStudyPlanCourses(
  actorId: string,
  selectedPlanId: string,
  selectedSemesterId: string,
) {
  const actor = z
    .string()
    .uuid()
    .transform((id) => id.toLowerCase())
    .parse(actorId);
  const { planId, semesterId } = OwnStudyPlanCoursesParamsSchema.parse({
    planId: selectedPlanId,
    semesterId: selectedSemesterId,
  });
  return prisma.$transaction(
    async (tx) => {
      const owner = await tx.user.findUnique({
        where: { id: actor },
        select: { id: true, curriculumId: true },
      });
      if (!owner) throw new OwnStudyPlanSemestersError('Authentication required', 401);
      const storedPlan = await tx.studyPlan.findFirst({
        where: { id: planId, userId: owner.id },
        select: {
          id: true,
          name: true,
          description: true,
          isActive: true,
          createdAt: true,
          updatedAt: true,
          _count: { select: { semesters: true } },
        },
      });
      const unavailable = () => new OwnStudyPlanSemestersError('Saved semester not found', 404);
      if (!storedPlan) throw unavailable();
      const semester = await tx.plannedSemester.findFirst({
        where: { id: semesterId, studyPlanId: planId },
        select: {
          id: true,
          semester: true,
          year: true,
          totalCredits: true,
          createdAt: true,
          updatedAt: true,
        },
      });
      if (!semester) throw unavailable();
      // CASE nesting prevents jsonb_array_length from being evaluated for nonarrays.
      // The guard bounds transfer and application work, not database JSON inspection cost.
      // Check exact JSONB numeric positions before the driver can round them into JS numbers.
      const [guarded] = await tx.$queryRaw<{ reason: string | null; payload: unknown }[]>`
      WITH bounded AS (
      SELECT
        CASE WHEN jsonb_typeof(courses) = 'array' THEN
          CASE WHEN jsonb_array_length(courses) > 100 OR octet_length(courses::text) > 65536
            THEN 'READER_LIMIT' ELSE NULL END
          ELSE 'UNSUPPORTED_FORMAT' END AS reason,
        CASE WHEN jsonb_typeof(courses) = 'array' THEN
          CASE WHEN jsonb_array_length(courses) <= 100 AND octet_length(courses::text) <= 65536
            THEN courses ELSE NULL END
          ELSE NULL END AS payload
      FROM planned_semesters WHERE id = ${semesterId} AND study_plan_id = ${planId}
      ), checked AS (
        SELECT reason, payload, EXISTS (
          SELECT 1 FROM jsonb_array_elements(payload) AS entry(item)
          WHERE CASE WHEN jsonb_typeof(item->'position') = 'number' THEN
            (item->>'position')::numeric <> trunc((item->>'position')::numeric)
            OR (item->>'position')::numeric < -9007199254740991
            OR (item->>'position')::numeric > 9007199254740991
            ELSE false END
        ) AS invalid_position
        FROM bounded
      )
      SELECT CASE WHEN invalid_position THEN 'UNSUPPORTED_FORMAT' ELSE reason END AS reason,
        CASE WHEN invalid_position THEN NULL ELSE payload END AS payload
      FROM checked
    `;
      if (!guarded) throw unavailable();
      let courseReferences: OwnStudyPlanCoursesDTO['courseReferences'];
      if (guarded.reason !== null) {
        courseReferences = {
          status: 'UNAVAILABLE',
          reason: guarded.reason === 'READER_LIMIT' ? 'READER_LIMIT' : 'UNSUPPORTED_FORMAT',
        };
      } else {
        const parsed = storedReferences.safeParse(guarded.payload);
        if (!parsed.success)
          courseReferences = { status: 'UNAVAILABLE', reason: 'UNSUPPORTED_FORMAT' };
        else {
          const courses = await tx.course.findMany({
            where: { id: { in: parsed.data.map(({ courseId }) => courseId) } },
            select: { id: true, code: true, name: true },
          });
          const placedMembers = owner.curriculumId
            ? await tx.curriculumCourse.findMany({
                where: {
                  curriculumId: owner.curriculumId,
                  courseId: { in: parsed.data.map(({ courseId }) => courseId) },
                  placements: { some: {} },
                },
                select: { courseId: true },
              })
            : [];
          const placedCourseIds = new Set(placedMembers.map(({ courseId }) => courseId));
          const catalog = new Map(courses.map(({ id, code, name }) => [id, { code, name }]));
          courseReferences = {
            status: 'RECOGNIZED',
            order: 'STORED_ARRAY_ORDER',
            entries: parsed.data.map(({ courseId, position }) => ({
              courseId,
              storedPosition: position,
              currentCurriculumMembership:
                owner.curriculumId === null
                  ? 'NO_ASSIGNED_CURRICULUM'
                  : placedCourseIds.has(courseId)
                    ? 'PLACED_MEMBER'
                    : 'NO_CURRENT_PLACEMENT',
              catalog: catalog.get(courseId) ?? null,
            })),
          };
        }
      }
      const { _count, ...plan } = storedPlan;
      const { totalCredits, ...metadata } = semester;
      return OwnStudyPlanCoursesSchema.parse({
        visibility: 'CURRENT_ACCOUNT_ONLY',
        scope: { userId: owner.id, curriculumId: owner.curriculumId, studyPlansValidated: false },
        plan: {
          ...plan,
          createdAt: plan.createdAt.toISOString(),
          updatedAt: plan.updatedAt.toISOString(),
          semesterCount: _count.semesters,
        },
        semester: {
          ...metadata,
          storedTotalCredits: totalCredits,
          createdAt: metadata.createdAt.toISOString(),
          updatedAt: metadata.updatedAt.toISOString(),
        },
        courseReferences,
      });
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
}
