import { readSimulationResourcePolicy } from '../config/simulationResources';

describe('simulation resource deployment assumptions', () => {
  it('defaults to one complete section opportunity and one section per professor', () => {
    expect(readSimulationResourcePolicy({})).toEqual({
      model: 'SHARED_CLASSROOM_SECTION_ENVELOPE_V1',
      classroomTimeBlocks: 1,
      sectionsPerProfessor: 1,
      roomBasis: 'ONE_CLASSROOM_SECTION_PER_ROOM_PER_BLOCK',
      teachingBasis: 'ONE_PROFESSOR_PER_SECTION_PER_BLOCK',
      sectionDurationBasis: 'ONE_SIMULATED_BLOCK',
      professorAssignmentBasis: 'INTERCHANGEABLE_FOR_ENVELOPE_ONLY',
    });
  });
  it.each([0, 1, 100])('retains explicit %i blocks and teaching load', (value) => {
    const result = readSimulationResourcePolicy({
      SIMULATION_CLASSROOM_TIME_BLOCKS: String(value),
      SIMULATION_SECTIONS_PER_PROFESSOR: String(value),
    });
    expect(result.classroomTimeBlocks).toBe(value);
    expect(result.sectionsPerProfessor).toBe(value);
    expect(Object.isFrozen(result)).toBe(true);
  });
  it('keeps room opportunities independent of the per-professor teaching limit', () => {
    expect(
      readSimulationResourcePolicy({
        SIMULATION_CLASSROOM_TIME_BLOCKS: '3',
        SIMULATION_SECTIONS_PER_PROFESSOR: '2',
      }),
    ).toMatchObject({ classroomTimeBlocks: 3, sectionsPerProfessor: 2 });
  });
  it.each(['', ' ', '-1', '1.5', '101', 'Infinity', 'NaN', '1e2', '0x10', '+1', '01'])(
    'rejects invalid configured value %j for either policy setting',
    (value) => {
      for (const name of ['SIMULATION_CLASSROOM_TIME_BLOCKS', 'SIMULATION_SECTIONS_PER_PROFESSOR'])
        expect(() => readSimulationResourcePolicy({ [name]: value })).toThrow(
          `${name} must be an integer from 0 to 100`,
        );
    },
  );
});
