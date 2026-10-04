import { z } from 'zod';
import {
  SimulationResourceEnvelopeSchema,
  SimulationResourcePolicySchema,
  type ResourcesSnapshotDTO,
  type SimulationResourcePolicyDTO,
} from '@iu-study-planner/shared';
import { projectSimulationResourceEnvelope } from '../services/schoolResourceEnvelope';

const context = {
  id: 'aaaaaaaa-1111-4111-8111-111111111111',
  code: 'ENVELOPE',
  name: 'Resource envelope reference',
  school: 'Simulation school',
};
function policy(blocks = 1, load = 1): SimulationResourcePolicyDTO {
  return {
    model: 'SHARED_CLASSROOM_SECTION_ENVELOPE_V1',
    classroomTimeBlocks: blocks,
    sectionsPerProfessor: load,
    roomBasis: 'ONE_CLASSROOM_SECTION_PER_ROOM_PER_BLOCK',
    teachingBasis: 'ONE_PROFESSOR_PER_SECTION_PER_BLOCK',
    sectionDurationBasis: 'ONE_SIMULATED_BLOCK',
    professorAssignmentBasis: 'INTERCHANGEABLE_FOR_ENVELOPE_ONLY',
  };
}
function resources(): ResourcesSnapshotDTO {
  return {
    kind: 'SIMULATION',
    curriculum: { ...context },
    semester: 'FALL',
    year: 2026,
    resource: {
      id: 'bbbbbbbb-1111-4111-8111-111111111111',
      curriculumId: context.id,
      semester: 'FALL',
      year: 2026,
      professors: 2,
      classrooms: 3,
      labRooms: 9,
      maxStudentsPerSection: 40,
      courseOverrides: { A: { capacity: 99999, professorCount: 99999 }, OLD: { capacity: 1 } },
      revision: 2,
      updatedBy: 'cccccccc-1111-4111-8111-111111111111',
      createdAt: '2026-10-04T00:00:00.000Z',
      updatedAt: '2026-10-04T00:00:00.000Z',
    },
  };
}
function configured() {
  const snapshot = resources();
  if (!snapshot.resource) throw new Error('Fixture requires resource settings');
  return { snapshot, row: snapshot.resource };
}

describe('shared simulated section and seat envelope projection', () => {
  it('projects hand-checked shared ceilings with explicit scope and assumptions', () => {
    const result = projectSimulationResourceEnvelope(resources(), policy(4, 3));
    expect(result).toMatchObject({
      kind: 'SIMULATION',
      usage: 'REFERENCE_ONLY',
      scope: { curriculumId: context.id, semester: 'FALL', year: 2026 },
      curriculum: context,
      scopeBasis: 'SCENARIO_ONLY',
      resourceRevision: 2,
      policy: policy(4, 3),
      resources: { professors: 2, classrooms: 3, labRooms: 9, maxStudentsPerSection: 40 },
      envelope: {
        classroomSectionCeiling: 12,
        professorSectionCeiling: 6,
        sharedSectionCeiling: 6,
        sharedSeatCeiling: 240,
      },
    });
    expect(SimulationResourceEnvelopeSchema.parse(result)).toEqual(result);
  });

  it.each([
    [10, 1, 1, 10, 10, 1, 1],
    [10, 1, 4, 10, 40, 4, 4],
    [1, 10, 4, 10, 4, 40, 4],
    [3, 2, 4, 1, 12, 2, 2],
    [3, 2, 4, 3, 12, 6, 6],
    [3, 2, 4, 4, 12, 8, 8],
    [3, 2, 4, 10, 12, 8, 8],
    [3, 2, 0, 10, 0, 0, 0],
    [3, 2, 4, 0, 12, 0, 0],
    [0, 2, 4, 3, 0, 6, 0],
    [3, 0, 4, 3, 12, 0, 0],
  ])(
    'bounds rooms=%i professors=%i blocks=%i load=%i without simultaneous staff duplication',
    (rooms, professors, blocks, load, classroomCeiling, professorCeiling, sharedCeiling) => {
      const { snapshot, row } = configured();
      row.classrooms = rooms;
      row.professors = professors;
      expect(projectSimulationResourceEnvelope(snapshot, policy(blocks, load)).envelope).toEqual({
        classroomSectionCeiling: classroomCeiling,
        professorSectionCeiling: professorCeiling,
        sharedSectionCeiling: sharedCeiling,
        sharedSeatCeiling: sharedCeiling * 40,
      });
    },
  );

  it('keeps absent settings unknown and configured zero inventory known', () => {
    const snapshot = resources();
    snapshot.resource = null;
    const missing = projectSimulationResourceEnvelope(snapshot, policy());
    expect(missing).toMatchObject({ resourceRevision: null, resources: null, envelope: null });
    const { snapshot: zeroSnapshot, row } = configured();
    row.classrooms = 0;
    row.professors = 0;
    expect(projectSimulationResourceEnvelope(zeroSnapshot, policy())).toMatchObject({
      resourceRevision: 2,
      envelope: {
        classroomSectionCeiling: 0,
        professorSectionCeiling: 0,
        sharedSectionCeiling: 0,
        sharedSeatCeiling: 0,
      },
    });
  });

  it('keeps labs and course overrides outside the shared classroom and staff math', () => {
    const { snapshot, row } = configured();
    const original = projectSimulationResourceEnvelope(snapshot, policy(4, 3));
    row.labRooms = 100000;
    row.courseOverrides = { A: { capacity: 0 }, OLD: { professorCount: 100000 } };
    const result = projectSimulationResourceEnvelope(snapshot, policy(4, 3));
    expect(result.envelope).toEqual(original.envelope);
    expect(result.resources?.labRooms).toBe(100000);
    expect(result).not.toHaveProperty('courses');
    expect(result).not.toHaveProperty('courseOverrides');
  });

  it('handles the bounded trillion-seat maximum as an exact safe integer', () => {
    const { snapshot, row } = configured();
    row.classrooms = 100000;
    row.professors = 100000;
    row.maxStudentsPerSection = 100000;
    const result = projectSimulationResourceEnvelope(snapshot, policy(100, 100));
    expect(result.envelope).toEqual({
      classroomSectionCeiling: 10000000,
      professorSectionCeiling: 10000000,
      sharedSectionCeiling: 10000000,
      sharedSeatCeiling: 1000000000000,
    });
    expect(Number.isSafeInteger(result.envelope?.sharedSeatCeiling)).toBe(true);
  });

  it('normalizes both resource and context UUID identities before matching them', () => {
    const { snapshot, row } = configured();
    snapshot.curriculum.id = context.id.toUpperCase();
    row.curriculumId = context.id.toUpperCase();
    expect(projectSimulationResourceEnvelope(snapshot, policy()).scope.curriculumId).toBe(
      context.id,
    );
  });

  it('preserves inputs and hides audit timestamps, identity and override contents', () => {
    const snapshot = resources();
    const assumptions = policy(4, 3);
    const before = JSON.stringify({ snapshot, assumptions });
    const result = projectSimulationResourceEnvelope(snapshot, assumptions);
    expect(JSON.stringify({ snapshot, assumptions })).toBe(before);
    const serialized = JSON.stringify(result);
    for (const field of [
      'updatedBy',
      'createdAt',
      'updatedAt',
      '"courseOverrides":',
      'professorCount',
    ])
      expect(serialized).not.toContain(field);
    expect(serialized).not.toContain(snapshot.resource?.id);
    expect(serialized).not.toContain(snapshot.resource?.updatedBy);
  });

  it.each(
    [
      { OLD: { capacity: -1 } },
      { OLD: { professorCount: 100001 } },
      { OLD: {} },
      { OLD: { capacity: 1, sections: 2 } },
      { constructor: { capacity: 1 } },
      { ' OLD': { capacity: 1 } },
      [],
      null,
    ].map((overrides: unknown) => ({ overrides })),
  )('validates ignored historical override JSON completely: %j', ({ overrides }) => {
    const { snapshot, row } = configured();
    row.courseOverrides = overrides as unknown as typeof row.courseOverrides;
    expect(() => projectSimulationResourceEnvelope(snapshot, policy())).toThrow(Error);
  });

  it.each(['curriculum', 'semester', 'year', 'count', 'revision'] as const)(
    'rejects corrupt persisted %s as server metadata failure',
    (field) => {
      const { snapshot, row } = configured();
      if (field === 'curriculum') row.curriculumId = row.id;
      if (field === 'semester') row.semester = 'SPRING';
      if (field === 'year') row.year = 2027;
      if (field === 'count') row.professors = -1;
      if (field === 'revision') row.revision = 0;
      expect(() => projectSimulationResourceEnvelope(snapshot, policy())).toThrow(Error);
      try {
        projectSimulationResourceEnvelope(snapshot, policy());
      } catch (error) {
        expect(error).not.toBeInstanceOf(z.ZodError);
      }
    },
  );
});

describe('simulation resource envelope policy and response contracts', () => {
  it.each([
    { classroomTimeBlocks: -1 },
    { classroomTimeBlocks: 101 },
    { classroomTimeBlocks: 1.5 },
    { classroomTimeBlocks: '1' },
    { sectionsPerProfessor: -1 },
    { sectionsPerProfessor: 101 },
    { sectionsPerProfessor: 0.5 },
    { sectionsPerProfessor: Infinity },
    { model: 'REAL' },
    { roomBasis: 'LABS_AND_CLASSROOMS' },
    { teachingBasis: 'ANY_NUMBER_PER_BLOCK' },
    { sectionDurationBasis: 'SEMESTER' },
    { professorAssignmentBasis: 'QUALIFICATIONS_VALIDATED' },
    { extra: true },
  ])('rejects invalid or overriding strict assumptions %j', (invalid) => {
    const payload = { ...policy(), ...invalid };
    expect(SimulationResourcePolicySchema.safeParse(payload).success).toBe(false);
    expect(() =>
      projectSimulationResourceEnvelope(resources(), payload as SimulationResourcePolicyDTO),
    ).toThrow();
  });

  it('requires every policy field, including each declared modeling basis', () => {
    for (const field of Object.keys(policy())) {
      const incomplete: Record<string, unknown> = { ...policy() };
      delete incomplete[field];
      expect(SimulationResourcePolicySchema.safeParse(incomplete).success).toBe(false);
    }
  });

  it.each([
    'labSectionsModeled',
    'courseOverridesApplied',
    'teachingLoadValidated',
    'timetableValidated',
    'offeringValidationAvailable',
    'demandValidated',
    'allocationValidated',
    'professorAvailabilityValidated',
    'professorQualificationsValidated',
    'crossCurriculumResourcesReconciled',
  ])('fixes unsupported capability %s to false', (field) => {
    const result = projectSimulationResourceEnvelope(resources(), policy());
    expect(result).toHaveProperty(field, false);
    expect(SimulationResourceEnvelopeSchema.safeParse({ ...result, [field]: true }).success).toBe(
      false,
    );
  });

  it.each([
    'classroomSectionCeiling',
    'professorSectionCeiling',
    'sharedSectionCeiling',
    'sharedSeatCeiling',
  ] as const)('rejects mathematically contradictory %s', (field) => {
    const result = projectSimulationResourceEnvelope(resources(), policy(4, 3));
    if (!result.envelope) throw new Error('Fixture requires an envelope');
    result.envelope[field] += 1;
    expect(SimulationResourceEnvelopeSchema.safeParse(result).success).toBe(false);
  });

  it.each([
    (result: ReturnType<typeof projectSimulationResourceEnvelope>) => ({
      ...result,
      audit: 'private',
    }),
    (result: ReturnType<typeof projectSimulationResourceEnvelope>) => ({
      ...result,
      resources: { ...result.resources, courseOverrides: {} },
    }),
    (result: ReturnType<typeof projectSimulationResourceEnvelope>) => ({
      ...result,
      envelope: { ...result.envelope, utilization: 1 },
    }),
    (result: ReturnType<typeof projectSimulationResourceEnvelope>) => ({
      ...result,
      scope: { ...result.scope, curriculumId: 'dddddddd-1111-4111-8111-111111111111' },
    }),
    (result: ReturnType<typeof projectSimulationResourceEnvelope>) => ({
      ...result,
      resources: null,
    }),
    (result: ReturnType<typeof projectSimulationResourceEnvelope>) => ({
      ...result,
      envelope: null,
    }),
    (result: ReturnType<typeof projectSimulationResourceEnvelope>) => ({
      ...result,
      resourceRevision: null,
    }),
    (result: ReturnType<typeof projectSimulationResourceEnvelope>) => ({
      ...result,
      resourceRevision: 0,
    }),
    (result: ReturnType<typeof projectSimulationResourceEnvelope>) => ({
      ...result,
      resourceRevision: 2147483648,
    }),
    (result: ReturnType<typeof projectSimulationResourceEnvelope>) => ({
      ...result,
      scopeBasis: 'OFFERED_TERM',
    }),
  ])('rejects unknown or inconsistent response metadata %#', (corrupt) => {
    const result = projectSimulationResourceEnvelope(resources(), policy());
    expect(SimulationResourceEnvelopeSchema.safeParse(corrupt(result)).success).toBe(false);
  });

  it('rejects invented zero totals or a revision for absent resources', () => {
    const snapshot = resources();
    snapshot.resource = null;
    const result = projectSimulationResourceEnvelope(snapshot, policy());
    expect(
      SimulationResourceEnvelopeSchema.safeParse({ ...result, resourceRevision: 1 }).success,
    ).toBe(false);
    expect(
      SimulationResourceEnvelopeSchema.safeParse({
        ...result,
        envelope: {
          classroomSectionCeiling: 0,
          professorSectionCeiling: 0,
          sharedSectionCeiling: 0,
          sharedSeatCeiling: 0,
        },
      }).success,
    ).toBe(false);
  });
});
