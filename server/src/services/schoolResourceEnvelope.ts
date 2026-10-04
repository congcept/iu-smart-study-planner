import {
  ResourcesSnapshotSchema,
  SimulationResourceEnvelopeSchema,
  SimulationResourcePolicySchema,
  type ResourcesSnapshotDTO,
  type ResourceScopeDTO,
  type SimulationResourceEnvelopeDTO,
  type SimulationResourcePolicyDTO,
} from '@iu-study-planner/shared';
import config from '../config';
import { readResources } from './schoolResources';

export function projectSimulationResourceEnvelope(
  snapshot: ResourcesSnapshotDTO,
  policy: SimulationResourcePolicyDTO,
): SimulationResourceEnvelopeDTO {
  // Validate the full stored snapshot, including overrides that this model does not apply.
  const parsedSnapshot = ResourcesSnapshotSchema.safeParse(snapshot);
  if (!parsedSnapshot.success)
    throw new Error('Stored simulation resource metadata could not be verified');
  const parsedPolicy = SimulationResourcePolicySchema.safeParse(policy);
  if (!parsedPolicy.success) throw new Error('Simulation resource policy could not be verified');

  const { curriculum, semester, year, resource } = parsedSnapshot.data;
  const capturedPolicy = parsedPolicy.data;
  const resources = resource
    ? {
        professors: resource.professors,
        classrooms: resource.classrooms,
        labRooms: resource.labRooms,
        maxStudentsPerSection: resource.maxStudentsPerSection,
      }
    : null;
  const classroomSectionCeiling = resources
    ? resources.classrooms * capturedPolicy.classroomTimeBlocks
    : 0;
  const professorSectionCeiling = resources
    ? resources.professors *
      Math.min(capturedPolicy.classroomTimeBlocks, capturedPolicy.sectionsPerProfessor)
    : 0;
  const sharedSectionCeiling = Math.min(classroomSectionCeiling, professorSectionCeiling);

  const projected = SimulationResourceEnvelopeSchema.safeParse({
    kind: 'SIMULATION',
    usage: 'REFERENCE_ONLY',
    scopeBasis: 'SCENARIO_ONLY',
    scope: { curriculumId: curriculum.id, semester, year },
    curriculum,
    resourceRevision: resource?.revision ?? null,
    policy: capturedPolicy,
    resources,
    envelope: resources
      ? {
          classroomSectionCeiling,
          professorSectionCeiling,
          sharedSectionCeiling,
          sharedSeatCeiling: sharedSectionCeiling * resources.maxStudentsPerSection,
        }
      : null,
    labSectionsModeled: false,
    courseOverridesApplied: false,
    teachingLoadValidated: false,
    professorAvailabilityValidated: false,
    professorQualificationsValidated: false,
    crossCurriculumResourcesReconciled: false,
    timetableValidated: false,
    offeringValidationAvailable: false,
    demandValidated: false,
    allocationValidated: false,
  });
  if (!projected.success) throw new Error('Simulation resource envelope could not be verified');
  return projected.data;
}

export async function readSimulationResourceEnvelope(
  actorId: string,
  inputScope: ResourceScopeDTO,
) {
  const policy = config.simulationResourcePolicy;
  const snapshot = await readResources(actorId, inputScope);
  return projectSimulationResourceEnvelope(snapshot, policy);
}
