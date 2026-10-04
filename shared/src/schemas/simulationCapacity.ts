import { z } from 'zod';
import type { PlannedDemandSnapshotSchema } from './index';

const count = z.number().int().nonnegative().safe();
const resourceCount = z.number().int().min(0).max(100000);

/** Explicit simulated course seats; room inventory is only a separate reference proxy. */
export const createSimulationCapacitySnapshotSchema = (
  plannedDemandSchema: typeof PlannedDemandSnapshotSchema,
) =>
  z
    .object({
      kind: z.literal('SIMULATION'),
      usage: z.literal('REFERENCE_ONLY'),
      model: z.literal('EXPLICIT_COURSE_CAPACITY_ONLY'),
      plannedSelections: plannedDemandSchema,
      resources: z
        .object({
          professors: resourceCount,
          classrooms: resourceCount,
          labRooms: resourceCount,
          maxStudentsPerSection: z.number().int().min(1).max(100000),
        })
        .strict()
        .nullable(),
      classroomSeatProxy: z
        .object({
          basis: z.literal('ONE_SIMULTANEOUS_CLASSROOM_SECTION_PER_ROOM'),
          seats: count,
        })
        .strict()
        .nullable(),
      ignoredNonmemberOverrideCount: count,
      labClassificationAvailable: z.literal(false),
      teachingLoadValidated: z.literal(false),
      allocationValidated: z.literal(false),
      courses: z.array(
        z
          .object({
            id: z
              .string()
              .uuid()
              .transform((id) => id.toLowerCase()),
            code: z.string().min(1),
            declaredSeatCapacity: resourceCount.nullable(),
            capacityBasis: z.enum(['UNSPECIFIED', 'EXPLICIT_COURSE_OVERRIDE']),
            plannedSelectionsPerDeclaredSeat: z.number().finite().nonnegative().nullable(),
            excessPlannedSelections: count.nullable(),
          })
          .strict(),
      ),
    })
    .strict()
    .superRefine((snapshot, ctx) => {
      const invalid = (message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, message });
      const { resources, classroomSeatProxy, plannedSelections } = snapshot;
      if (
        (resources === null) !== (plannedSelections.resourceRevision === null) ||
        (resources === null) !== (classroomSeatProxy === null)
      )
        invalid('Capacity resources, revision and classroom proxy must agree');
      if (
        resources !== null &&
        classroomSeatProxy !== null &&
        classroomSeatProxy.seats !== resources.classrooms * resources.maxStudentsPerSection
      )
        invalid('Classroom proxy must equal rooms multiplied by seats per section');
      if (resources === null && snapshot.ignoredNonmemberOverrideCount !== 0)
        invalid('Missing resources cannot contain ignored course overrides');
      if (snapshot.courses.length !== plannedSelections.courses.length)
        invalid('Capacity rows must align with all planned-selection courses');
      snapshot.courses.forEach((course, index) => {
        const planned = plannedSelections.courses[index];
        if (!planned || course.id !== planned.id || course.code !== planned.code)
          invalid('Capacity course identity or order does not match planned selections');
        const capacity = course.declaredSeatCapacity;
        if (
          (capacity === null) !== (course.capacityBasis === 'UNSPECIFIED') ||
          (resources === null && capacity !== null)
        )
          invalid('Declared capacity must have an explicit configured course override');
        const ratio =
          capacity !== null && capacity > 0 && planned
            ? planned.plannedStudentCount / capacity
            : null;
        const excess =
          capacity !== null && planned ? Math.max(0, planned.plannedStudentCount - capacity) : null;
        if (
          course.plannedSelectionsPerDeclaredSeat !== ratio ||
          course.excessPlannedSelections !== excess
        )
          invalid('Capacity diagnostics must match declared seats and planned selections');
      });
    });
