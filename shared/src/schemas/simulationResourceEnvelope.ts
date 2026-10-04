import { z } from 'zod';
import type { ResourceScopeSchema, ResourcesSnapshotSchema } from './index';

const count = z.number().int().nonnegative().safe();
const resourceCount = z.number().int().min(0).max(100000);
const policyCount = z.number().int().min(0).max(100);

/** Abstract nonoverlapping blocks, each containing one complete simulated section. */
export const SimulationResourcePolicySchema = z
  .object({
    model: z.literal('SHARED_CLASSROOM_SECTION_ENVELOPE_V1'),
    classroomTimeBlocks: policyCount,
    sectionsPerProfessor: policyCount,
    roomBasis: z.literal('ONE_CLASSROOM_SECTION_PER_ROOM_PER_BLOCK'),
    teachingBasis: z.literal('ONE_PROFESSOR_PER_SECTION_PER_BLOCK'),
    sectionDurationBasis: z.literal('ONE_SIMULATED_BLOCK'),
    professorAssignmentBasis: z.literal('INTERCHANGEABLE_FOR_ENVELOPE_ONLY'),
  })
  .strict();

/** A scenario ceiling shared across courses; it does not validate a feasible allocation. */
export const createSimulationResourceEnvelopeSchema = (
  scopeSchema: typeof ResourceScopeSchema,
  curriculumSchema: ReturnType<typeof ResourcesSnapshotSchema.innerType>['shape']['curriculum'],
) =>
  z
    .object({
      kind: z.literal('SIMULATION'),
      usage: z.literal('REFERENCE_ONLY'),
      scopeBasis: z.literal('SCENARIO_ONLY'),
      scope: scopeSchema,
      curriculum: curriculumSchema,
      resourceRevision: z.number().int().min(1).max(2147483647).nullable(),
      policy: SimulationResourcePolicySchema,
      resources: z
        .object({
          professors: resourceCount,
          classrooms: resourceCount,
          labRooms: resourceCount,
          maxStudentsPerSection: z.number().int().min(1).max(100000),
        })
        .strict()
        .nullable(),
      envelope: z
        .object({
          classroomSectionCeiling: count,
          professorSectionCeiling: count,
          sharedSectionCeiling: count,
          sharedSeatCeiling: count,
        })
        .strict()
        .nullable(),
      labSectionsModeled: z.literal(false),
      courseOverridesApplied: z.literal(false),
      teachingLoadValidated: z.literal(false),
      professorAvailabilityValidated: z.literal(false),
      professorQualificationsValidated: z.literal(false),
      crossCurriculumResourcesReconciled: z.literal(false),
      timetableValidated: z.literal(false),
      offeringValidationAvailable: z.literal(false),
      demandValidated: z.literal(false),
      allocationValidated: z.literal(false),
    })
    .strict()
    .superRefine((snapshot, ctx) => {
      const invalid = (message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, message });
      if (snapshot.scope.curriculumId !== snapshot.curriculum.id)
        invalid('Resource envelope scope must match its curriculum');

      const { resources, envelope, policy, resourceRevision } = snapshot;
      if (
        (resources === null) !== (resourceRevision === null) ||
        (resources === null) !== (envelope === null)
      )
        invalid('Resource envelope resources, revision and ceilings must agree');

      if (resources !== null && envelope !== null) {
        const classroomSections = resources.classrooms * policy.classroomTimeBlocks;
        const professorSections =
          resources.professors * Math.min(policy.classroomTimeBlocks, policy.sectionsPerProfessor);
        const sharedSections = Math.min(classroomSections, professorSections);
        if (
          envelope.classroomSectionCeiling !== classroomSections ||
          envelope.professorSectionCeiling !== professorSections ||
          envelope.sharedSectionCeiling !== sharedSections ||
          envelope.sharedSeatCeiling !== sharedSections * resources.maxStudentsPerSection
        )
          invalid('Resource envelope ceilings must match its resources and policy');
      }
    });
