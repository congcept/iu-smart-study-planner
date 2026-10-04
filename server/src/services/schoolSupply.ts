import { Prisma } from '@prisma/client';
import {
  PlannedDemandSnapshotSchema,
  ResourcesSnapshotSchema,
  ResourceScopeSchema,
  SimulationCapacitySnapshotSchema,
  type PlannedDemandSnapshotDTO,
  type ResourcesSnapshotDTO,
  type ResourceScopeDTO,
  type SimulationCapacitySnapshotDTO,
} from '@iu-study-planner/shared';
import { prisma } from '../db';
import { readPlannedDemand } from './schoolDemand';

export function projectSimulationCapacity(
  plannedDemand: PlannedDemandSnapshotDTO,
  resourceSnapshot: ResourcesSnapshotDTO,
): SimulationCapacitySnapshotDTO {
  const demandResult = PlannedDemandSnapshotSchema.safeParse(plannedDemand);
  const resourceResult = ResourcesSnapshotSchema.safeParse(resourceSnapshot);
  if (!demandResult.success || !resourceResult.success)
    throw new Error('Stored simulation capacity metadata could not be verified');
  const demand = demandResult.data;
  const snapshot = resourceResult.data;
  if (
    snapshot.curriculum.id !== demand.scope.curriculumId ||
    snapshot.curriculum.code !== demand.curriculum.code ||
    snapshot.curriculum.name !== demand.curriculum.name ||
    snapshot.curriculum.school !== demand.curriculum.school ||
    snapshot.semester !== demand.scope.semester ||
    snapshot.year !== demand.scope.year ||
    (snapshot.resource?.revision ?? null) !== demand.resourceRevision
  )
    throw new Error('Stored simulation capacity snapshots do not share a scenario and revision');
  const resource = snapshot.resource;
  const memberCodes = new Set(demand.courses.map((course) => course.code));
  const parsed = SimulationCapacitySnapshotSchema.safeParse({
    kind: 'SIMULATION',
    usage: 'REFERENCE_ONLY',
    model: 'EXPLICIT_COURSE_CAPACITY_ONLY',
    plannedSelections: demand,
    resources: resource
      ? {
          professors: resource.professors,
          classrooms: resource.classrooms,
          labRooms: resource.labRooms,
          maxStudentsPerSection: resource.maxStudentsPerSection,
        }
      : null,
    classroomSeatProxy: resource
      ? {
          basis: 'ONE_SIMULTANEOUS_CLASSROOM_SECTION_PER_ROOM',
          seats: resource.classrooms * resource.maxStudentsPerSection,
        }
      : null,
    ignoredNonmemberOverrideCount: resource
      ? Object.keys(resource.courseOverrides).filter((code) => !memberCodes.has(code)).length
      : 0,
    labClassificationAvailable: false,
    teachingLoadValidated: false,
    allocationValidated: false,
    courses: demand.courses.map((course) => {
      const capacity = resource?.courseOverrides[course.code]?.capacity ?? null;
      return {
        id: course.id,
        code: course.code,
        declaredSeatCapacity: capacity,
        capacityBasis: capacity === null ? 'UNSPECIFIED' : 'EXPLICIT_COURSE_OVERRIDE',
        plannedSelectionsPerDeclaredSeat:
          capacity !== null && capacity > 0 ? course.plannedStudentCount / capacity : null,
        excessPlannedSelections:
          capacity === null ? null : Math.max(0, course.plannedStudentCount - capacity),
      };
    }),
  });
  if (!parsed.success)
    throw new Error('Stored simulation capacity projection could not be verified');
  return parsed.data;
}

export async function readSimulationCapacity(
  actorId: string,
  input: ResourceScopeDTO,
  transaction?: Prisma.TransactionClient,
): Promise<SimulationCapacitySnapshotDTO> {
  const scope = ResourceScopeSchema.parse(input);
  const read = async (tx: Prisma.TransactionClient) => {
    // Actor, membership, cohort, revision and resource settings share this snapshot.
    const demand = await readPlannedDemand(actorId, scope, tx);
    const row = await tx.schoolResource.findUnique({
      where: { curriculumId_semester_year: scope },
    });
    const resources = ResourcesSnapshotSchema.safeParse({
      kind: 'SIMULATION',
      curriculum: demand.curriculum,
      semester: scope.semester,
      year: scope.year,
      resource: row
        ? { ...row, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() }
        : null,
    });
    if (!resources.success)
      throw new Error('Stored simulation resource metadata could not be verified');
    return projectSimulationCapacity(demand, resources.data);
  };
  return transaction
    ? read(transaction)
    : prisma.$transaction(read, {
        isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
      });
}
