import type { Prisma } from '@prisma/client';
import { StudentRecordError } from './studentRecordError';

export async function readProgressCourseContext(
  tx: Prisma.TransactionClient,
  curriculumId: string,
  courseIds: string[],
) {
  const members = await tx.curriculumCourse.findMany({
    where: { curriculumId, courseId: { in: courseIds } },
    select: {
      courseId: true,
      placements: { select: { electiveGroup: true } },
      prerequisites: {
        select: {
          prerequisiteId: true,
          prerequisite: { select: { course: { select: { id: true, code: true, name: true } } } },
        },
      },
    },
  });
  const byId = new Map(members.map((member) => [member.courseId, member]));
  for (const courseId of courseIds) {
    const member = byId.get(courseId);
    if (!member || member.placements.length === 0) {
      throw new StudentRecordError('Course is not placed in the assigned curriculum', 409);
    }
  }
  return new Map(
    members.map((member) => [
      member.courseId,
      {
        placements: member.placements,
        prerequisites: member.prerequisites.map((edge) => ({
          prerequisiteId: edge.prerequisiteId,
          prerequisite: edge.prerequisite.course,
        })),
      },
    ]),
  );
}

export function validateContextClaim(
  placements: readonly { electiveGroup: string | null }[],
  claim: string | null,
) {
  if (!placements.some(({ electiveGroup }) => electiveGroup === claim)) {
    throw new StudentRecordError(
      'Select a valid course placement or elective group in the assigned curriculum',
      409,
    );
  }
}
