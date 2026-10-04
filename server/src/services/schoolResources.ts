import { Prisma, type SchoolResource } from '@prisma/client';
import { z } from 'zod';
import {
  ResourceScopeSchema,
  UpsertResourcesSchema,
  ResourcesSnapshotSchema,
  type ResourceScopeDTO,
  type UpsertResourcesDTO,
  type ResourcesSnapshotDTO,
} from '@iu-study-planner/shared';
import { prisma } from '../db';

export class SchoolResourceError extends Error {
  constructor(
    message: string,
    readonly status: 401 | 403 | 404 | 409,
  ) {
    super(message);
  }
}
async function authorize(tx: Prisma.TransactionClient, actorId: string) {
  const actor = await tx.user.findUnique({ where: { id: actorId }, select: { role: true } });
  if (!actor) throw new SchoolResourceError('Authentication required', 401);
  if (actor.role !== 'ADMIN') throw new SchoolResourceError('Administrator access required', 403);
}
async function curriculum(tx: Prisma.TransactionClient, curriculumId: string) {
  const found = await tx.curriculum.findUnique({
    where: { id: curriculumId },
    select: { id: true, code: true, name: true, school: true },
  });
  if (!found) throw new SchoolResourceError('Curriculum not found', 404);
  return found;
}
function snapshot(
  scope: ResourceScopeDTO,
  context: ResourcesSnapshotDTO['curriculum'],
  row: SchoolResource | null,
): ResourcesSnapshotDTO {
  const parsed = ResourcesSnapshotSchema.safeParse({
    kind: 'SIMULATION',
    curriculum: context,
    semester: scope.semester,
    year: scope.year,
    resource: row
      ? { ...row, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() }
      : null,
  });
  if (!parsed.success) throw new Error('Stored simulation resource metadata could not be verified');
  return parsed.data;
}
export async function readResources(actorId: string, input: ResourceScopeDTO) {
  const scope = ResourceScopeSchema.parse(input);
  return prisma.$transaction(
    async (tx) => {
      await authorize(tx, actorId);
      const context = await curriculum(tx, scope.curriculumId);
      const row = await tx.schoolResource.findUnique({
        where: { curriculumId_semester_year: scope },
      });
      return snapshot(scope, context, row);
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
}
export async function upsertResources(actorId: string, input: UpsertResourcesDTO) {
  const { expectedRevision, ...fields } = UpsertResourcesSchema.parse(input);
  const scope = ResourceScopeSchema.parse({
    curriculumId: fields.curriculumId,
    semester: fields.semester,
    year: fields.year,
  });
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          await authorize(tx, actorId);
          const context = await curriculum(tx, scope.curriculumId);
          const current = await tx.schoolResource.findUnique({
            where: { curriculumId_semester_year: scope },
          });
          if ((current?.revision ?? 0) !== expectedRevision || current?.revision === 2147483647)
            throw new SchoolResourceError('Resource settings changed; reload before saving', 409);
          const codes = Object.keys(fields.courseOverrides);
          if (codes.length) {
            const members = await tx.curriculumCourse.findMany({
              where: { curriculumId: scope.curriculumId, course: { code: { in: codes } } },
              select: { course: { select: { code: true } } },
            });
            const known = new Set(members.map(({ course }) => course.code));
            const invalid = codes.filter((code) => !known.has(code));
            if (invalid.length)
              throw new z.ZodError(
                invalid.map((code) => ({
                  code: z.ZodIssueCode.custom,
                  path: ['courseOverrides', code],
                  message: 'Course is not a member of this curriculum',
                })),
              );
          }
          let saved: SchoolResource;
          if (current) {
            const result = await tx.schoolResource.updateMany({
              where: { id: current.id, revision: expectedRevision },
              data: { ...fields, updatedBy: actorId, revision: { increment: 1 } },
            });
            if (result.count !== 1)
              throw new SchoolResourceError('Resource settings changed; reload before saving', 409);
            saved = await tx.schoolResource.findUniqueOrThrow({ where: { id: current.id } });
          } else
            saved = await tx.schoolResource.create({
              data: { ...fields, revision: 1, updatedBy: actorId },
            });
          return { snapshot: snapshot(scope, context, saved), created: current === null };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2034' && attempt < 4) continue;
        if (['P2034', 'P2002', 'P2003'].includes(error.code))
          throw new SchoolResourceError('Resource settings changed; reload before saving', 409);
      }
      throw error;
    }
  }
  throw new SchoolResourceError('Resource settings changed; reload before saving', 409);
}
