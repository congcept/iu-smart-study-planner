import { Prisma, UserRole } from '@prisma/client';
import {
  ResourceScopeSchema,
  PlannedDemandSnapshotSchema,
  type ResourceScopeDTO,
  type PlannedDemandSnapshotDTO,
} from '@iu-study-planner/shared';
import { prisma } from '../db';
import { SchoolResourceError } from './schoolResources';

export async function readPlannedDemand(
  actorId: string,
  input: ResourceScopeDTO,
  transaction?: Prisma.TransactionClient,
): Promise<PlannedDemandSnapshotDTO> {
  const scope = ResourceScopeSchema.parse(input);
  const read = async (tx: Prisma.TransactionClient) => {
    const actor = await tx.user.findUnique({ where: { id: actorId }, select: { role: true } });
    if (!actor) throw new SchoolResourceError('Authentication required', 401);
    if (actor.role !== UserRole.ADMIN)
      throw new SchoolResourceError('Administrator access required', 403);
    const curriculum = await tx.curriculum.findUnique({
      where: { id: scope.curriculumId },
      select: { id: true, code: true, name: true, school: true },
    });
    if (!curriculum) throw new SchoolResourceError('Curriculum not found', 404);
    const members = await tx.curriculumCourse.findMany({
      where: { curriculumId: scope.curriculumId },
      select: { course: { select: { id: true, code: true, name: true } } },
      orderBy: { course: { code: 'asc' } },
    });
    const memberIds = members.map(({ course }) => course.id);
    const cohort = { role: UserRole.STUDENT, curriculumId: scope.curriculumId };
    const [cohortStudentCount, plannedStudentCount, selections, resource] = await Promise.all([
      tx.user.count({ where: cohort }),
      memberIds.length
        ? tx.user.count({
            where: {
              ...cohort,
              studentRecords: { some: { status: 'PLANNED', courseId: { in: memberIds } } },
            },
          })
        : Promise.resolve(0),
      tx.studentRecord.groupBy({
        by: ['courseId'],
        where: { status: 'PLANNED', user: cohort },
        _count: { _all: true },
      }),
      tx.schoolResource.findUnique({
        where: { curriculumId_semester_year: scope },
        select: { revision: true },
      }),
    ]);
    // StudentRecord's unique owner/course identity counts a student's selection once,
    // regardless of repeated elective placements. No validated term is stored here.
    const counts = new Map(selections.map((row) => [row.courseId, row._count._all]));
    const memberSet = new Set(memberIds);
    const courses = members.map(({ course }) => ({
      ...course,
      plannedStudentCount: counts.get(course.id) ?? 0,
      supply: null,
      utilization: null,
    }));
    const parsed = PlannedDemandSnapshotSchema.safeParse({
      kind: 'SIMULATION',
      usage: 'REFERENCE_ONLY',
      scope,
      curriculum,
      planningBasis: 'CURRENT_PLANNED_SELECTIONS',
      termBasis: 'SCENARIO_ONLY',
      recommendationDemandAvailable: false,
      eligibilityValidated: false,
      offeringValidationAvailable: false,
      resourceRevision: resource?.revision ?? null,
      cohortStudentCount,
      plannedStudentCount,
      plannedSelectionCount: courses.reduce((sum, course) => sum + course.plannedStudentCount, 0),
      ignoredNonmemberSelectionCount: selections.reduce(
        (sum, row) => sum + (memberSet.has(row.courseId) ? 0 : row._count._all),
        0,
      ),
      courses,
    });
    if (!parsed.success) throw new Error('Stored planned-selection metadata could not be verified');
    return parsed.data;
  };
  return transaction
    ? read(transaction)
    : prisma.$transaction(read, {
        isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
      });
}
