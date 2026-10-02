import { CourseStatus, Prisma } from '@prisma/client';
import { z } from 'zod';
import { UpdateStudentRecordSchema } from '@iu-study-planner/shared';
import { prisma } from '../db';

export class StudentRecordError extends Error {
  constructor(
    message: string,
    readonly status: 404 | 409,
    readonly details?: { id: string; code: string; name: string }[],
  ) {
    super(message);
  }
}

type RecordUpdate = z.infer<typeof UpdateStudentRecordSchema>;

export async function updateStudentRecord(
  userIdentifier: string,
  data: RecordUpdate,
  removeWhenPlanned = false,
) {
  // Retry serialization conflicts so concurrent completion/uncompletion cannot
  // commit a completed course with a newly incomplete prerequisite.
  for (let attempt = 0; ; attempt++) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
            userIdentifier,
          );
          const user = await tx.user.findUnique({
            where: isUuid ? { id: userIdentifier } : { studentId: userIdentifier },
          });
          if (!user) throw new StudentRecordError('User not found', 404);

          const course = await tx.course.findUnique({
            where: { id: data.courseId },
            include: {
              prerequisites: {
                include: { prerequisite: { select: { id: true, code: true, name: true } } },
              },
            },
          });
          if (!course) throw new StudentRecordError('Course not found', 404);

          if (data.status === CourseStatus.COMPLETED) {
            const completed = await tx.studentRecord.findMany({
              where: {
                userId: user.id,
                status: CourseStatus.COMPLETED,
                courseId: { in: course.prerequisites.map((edge) => edge.prerequisiteId) },
              },
              select: { courseId: true },
            });
            const completedIds = new Set(completed.map((record) => record.courseId));
            // Product policy: every prerequisite is mandatory, including rows
            // previously tagged as recommended or corequisite.
            const unmet = course.prerequisites
              .filter((edge) => !completedIds.has(edge.prerequisiteId))
              .map((edge) => edge.prerequisite);
            if (unmet.length > 0) {
              throw new StudentRecordError('Complete all prerequisites first', 409, unmet);
            }
          }

          let uncompletedCourseIds: string[] = [];
          if (data.status !== CourseStatus.COMPLETED) {
            const edges = await tx.prerequisite.findMany({
              select: { courseId: true, prerequisiteId: true },
            });
            const dependents = new Map<string, string[]>();
            for (const edge of edges) {
              const ids = dependents.get(edge.prerequisiteId) ?? [];
              ids.push(edge.courseId);
              dependents.set(edge.prerequisiteId, ids);
            }
            const queue = [data.courseId];
            const visited = new Set(queue);
            for (let index = 0; index < queue.length; index++) {
              for (const id of dependents.get(queue[index]) ?? []) {
                if (visited.has(id)) continue;
                visited.add(id);
                queue.push(id);
              }
            }
            const completedDependents = await tx.studentRecord.findMany({
              where: {
                userId: user.id,
                status: CourseStatus.COMPLETED,
                courseId: { in: queue.slice(1) },
              },
              select: { courseId: true },
            });
            uncompletedCourseIds = completedDependents.map((record) => record.courseId);
            // Match the existing client behavior: remove completions, preserve
            // independent courses and records already planned or in progress.
            await tx.studentRecord.deleteMany({
              where: { userId: user.id, courseId: { in: uncompletedCourseIds } },
            });
          }

          if (removeWhenPlanned && data.status === CourseStatus.PLANNED) {
            await tx.studentRecord.deleteMany({
              where: { userId: user.id, courseId: data.courseId },
            });
            return {
              record: {
                id: '',
                userId: user.id,
                courseId: course.id,
                grade: null,
                gradePoints: null,
                semester: null,
                year: null,
                status: CourseStatus.PLANNED,
                course,
                createdAt: new Date(),
                updatedAt: new Date(),
              },
              uncompletedCourseIds,
            };
          }

          const record = await tx.studentRecord.upsert({
            where: { userId_courseId: { userId: user.id, courseId: data.courseId } },
            update: data,
            create: { userId: user.id, ...data },
            include: { course: true },
          });
          return { record, uncompletedCourseIds };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') {
        if (attempt < 2) continue;
        throw new StudentRecordError('Progress changed concurrently; please retry', 409);
      }
      throw error;
    }
  }
}
