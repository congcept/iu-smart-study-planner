import { CourseStatus, Prisma } from '@prisma/client';
import type { StudentProgressDTO, UpsertProgressDTO } from '@iu-study-planner/shared';
import { prisma } from '../db';
import { readStudentProgress } from './studentProgress';
import { StudentRecordError } from './studentRecords';
import { readProgressCourseContext, validateContextClaim } from './progressCourseContext';
import { assertProgressWriteScope } from './progressWriteScope';
import { loadExternalCourses, unmetPrerequisites } from './prerequisiteSatisfaction';

export async function importStudentProgress(
  userId: string,
  data: UpsertProgressDTO,
): Promise<StudentProgressDTO> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          const user = await tx.user.findUnique({
            where: { id: userId },
            select: { id: true, curriculumId: true },
          });
          if (!user) throw new StudentRecordError('User not found', 404);
          assertProgressWriteScope(data.expectedScope, user);

          const completedIds = Object.keys(data.completedIds);
          const incomingIds = [...completedIds, ...data.plannedIds];
          const courses = await tx.course.findMany({
            where: { id: { in: incomingIds } },
            select: {
              id: true,
              code: true,
              name: true,
              prerequisites: {
                select: {
                  prerequisiteId: true,
                  prerequisite: { select: { id: true, code: true, name: true } },
                },
              },
            },
          });
          const coursesById = new Map(courses.map((course) => [course.id, course]));
          if (incomingIds.some((id) => !coursesById.has(id))) {
            throw new StudentRecordError('One or more imported courses were not found', 404);
          }
          const context = user.curriculumId
            ? await readProgressCourseContext(tx, user.curriculumId, incomingIds)
            : null;
          // The legacy global graph has no external branch; normalize it to the same shape so one
          // rule covers both sources.
          const prerequisitesFor = (id: string) =>
            context
              ? context.get(id)!.prerequisites
              : coursesById.get(id)!.prerequisites.map((edge) => ({
                  prerequisiteId: edge.prerequisiteId,
                  externalPrerequisite: null,
                  prerequisite: edge.prerequisite,
                }));

          const records = await tx.studentRecord.findMany({
            where: { userId },
            select: { courseId: true, status: true },
          });
          const recordsById = new Map(records.map((record) => [record.courseId, record]));
          const currentCompletedIds = new Set(
            records
              .filter((record) => record.status === CourseStatus.COMPLETED)
              .map((record) => record.courseId),
          );
          const finalCompletedIds = new Set([...currentCompletedIds, ...completedIds]);
          if (context) {
            for (const id of completedIds) {
              // Existing completions keep their server claim; ignored archive metadata
              // must not cause a no-op import to fail or overwrite historical evidence.
              if (!currentCompletedIds.has(id))
                validateContextClaim(context.get(id)!.placements, data.completedIds[id]);
            }
          }
          const unmet = new Map<string, { id: string; code: string; name: string }>();
          for (const id of completedIds) {
            const edges = prerequisitesFor(id);
            const externalCourses = await loadExternalCourses(tx, edges);
            // Every prerequisite is mandatory, including recommended/corequisite rows and one
            // satisfied by a course from outside this curriculum.
            for (const prerequisite of unmetPrerequisites(
              edges,
              finalCompletedIds,
              externalCourses,
            ))
              unmet.set(prerequisite.id, prerequisite);
          }
          if (unmet.size > 0) {
            throw new StudentRecordError('Complete all prerequisites before importing', 409, [
              ...unmet.values(),
            ]);
          }

          // A batch can include an entire chain, but new completions must not
          // mutually unlock one another through a prerequisite cycle.
          const newCompletedIds = completedIds.filter((id) => !currentCompletedIds.has(id));
          const newCompletedSet = new Set(newCompletedIds);
          const dependencyCounts = new Map<string, number>();
          const dependents = new Map<string, string[]>();
          for (const id of newCompletedIds) {
            // Only member prerequisites can unlock one another within a batch.
            const dependencies = prerequisitesFor(id).flatMap((edge) =>
              edge.prerequisiteId !== null && newCompletedSet.has(edge.prerequisiteId)
                ? [edge.prerequisiteId]
                : [],
            );
            dependencyCounts.set(id, dependencies.length);
            for (const prerequisiteId of dependencies) {
              const ids = dependents.get(prerequisiteId) ?? [];
              ids.push(id);
              dependents.set(prerequisiteId, ids);
            }
          }
          const orderedIds = newCompletedIds.filter((id) => dependencyCounts.get(id) === 0);
          for (let index = 0; index < orderedIds.length; index++) {
            for (const id of dependents.get(orderedIds[index]) ?? []) {
              const count = (dependencyCounts.get(id) ?? 0) - 1;
              dependencyCounts.set(id, count);
              if (count === 0) orderedIds.push(id);
            }
          }
          if (orderedIds.length !== newCompletedIds.length) {
            const blocked = newCompletedIds
              .filter((id) => (dependencyCounts.get(id) ?? 0) > 0)
              .map((id) => {
                const course = coursesById.get(id)!;
                return { id: course.id, code: course.code, name: course.name };
              });
            throw new StudentRecordError(
              'Imported completions contain a prerequisite cycle',
              409,
              blocked,
            );
          }

          // Validate first, then merge. Existing completions and metadata win;
          // no records are removed or downgraded by an import.
          for (const id of orderedIds) {
            await tx.studentRecord.upsert({
              where: { userId_courseId: { userId, courseId: id } },
              create: {
                userId,
                courseId: id,
                status: CourseStatus.COMPLETED,
                electiveGroup: data.completedIds[id],
              },
              update: { status: CourseStatus.COMPLETED, electiveGroup: data.completedIds[id] },
            });
          }
          const missingPlannedIds = data.plannedIds.filter((id) => !recordsById.has(id));
          if (missingPlannedIds.length > 0) {
            await tx.studentRecord.createMany({
              data: missingPlannedIds.map((courseId) => ({
                userId,
                courseId,
                status: CourseStatus.PLANNED,
              })),
            });
          }
          return readStudentProgress(userId, tx);
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
