import {
  SimulationResourcePolicySchema,
  type SimulationResourcePolicyDTO,
} from '@iu-study-planner/shared';

/** Deployment assumptions for an abstract scenario, not university teaching rules. */
export function readSimulationResourcePolicy(env: NodeJS.ProcessEnv): SimulationResourcePolicyDTO {
  const integer = (name: string) => {
    const raw = env[name];
    if (raw === undefined) return 1;
    if (!/^(0|[1-9]\d*)$/.test(raw) || Number(raw) > 100)
      throw new Error(`${name} must be an integer from 0 to 100`);
    return Number(raw);
  };
  return Object.freeze(
    SimulationResourcePolicySchema.parse({
      model: 'SHARED_CLASSROOM_SECTION_ENVELOPE_V1',
      classroomTimeBlocks: integer('SIMULATION_CLASSROOM_TIME_BLOCKS'),
      sectionsPerProfessor: integer('SIMULATION_SECTIONS_PER_PROFESSOR'),
      roomBasis: 'ONE_CLASSROOM_SECTION_PER_ROOM_PER_BLOCK',
      teachingBasis: 'ONE_PROFESSOR_PER_SECTION_PER_BLOCK',
      sectionDurationBasis: 'ONE_SIMULATED_BLOCK',
      professorAssignmentBasis: 'INTERCHANGEABLE_FOR_ENVELOPE_ONLY',
    }),
  );
}
