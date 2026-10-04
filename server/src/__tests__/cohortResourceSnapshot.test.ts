import { randomUUID } from 'node:crypto';
import {
  CohortResourceSnapshotSchema,
  type CurriculumDetailDTO,
  type EligibleCohortDemandSnapshotDTO,
  type SimulationResourceEnvelopeDTO,
} from '@iu-study-planner/shared';
import { projectCohortResourceSnapshot } from '../services/cohortResourceSnapshot';
import { projectEligibleCohortDemand } from '../services/eligibleCohortDemand';
import { projectSimulationResourceEnvelope } from '../services/schoolResourceEnvelope';

const context: CurriculumDetailDTO = {
  id: randomUUID(),
  code: 'COHERENT',
  name: 'Reference curriculum',
  school: 'CSE',
  degree: 'Bachelor',
  programUrl: 'https://example.test/reference',
  totalCredits: null,
  isGpaPath: false,
  sourceLabel: null,
  sourceUrl: null,
  usage: 'REFERENCE_ONLY',
  courses: [],
  requirements: [],
  prerequisites: [],
  ratingPrior: null,
};
const scope = { curriculumId: context.id, semester: 'FALL' as const, year: 2026 };
const demand = (): EligibleCohortDemandSnapshotDTO =>
  projectEligibleCohortDemand(scope, context, [{ id: randomUUID(), records: [], attempts: [] }], {
    maxCredits: 18,
    maxDifficulty: 3.5,
  });
const envelope = (): SimulationResourceEnvelopeDTO =>
  projectSimulationResourceEnvelope(
    {
      kind: 'SIMULATION',
      curriculum: {
        id: context.id,
        code: context.code,
        name: context.name,
        school: context.school,
      },
      semester: 'FALL',
      year: 2026,
      resource: null,
    },
    {
      model: 'SHARED_CLASSROOM_SECTION_ENVELOPE_V1',
      classroomTimeBlocks: 1,
      sectionsPerProfessor: 1,
      roomBasis: 'ONE_CLASSROOM_SECTION_PER_ROOM_PER_BLOCK',
      teachingBasis: 'ONE_PROFESSOR_PER_SECTION_PER_BLOCK',
      sectionDurationBasis: 'ONE_SIMULATED_BLOCK',
      professorAssignmentBasis: 'INTERCHANGEABLE_FOR_ENVELOPE_ONLY',
    },
  );

describe('coherent cohort demand and shared-resource snapshot contract', () => {
  it('preserves complete diagnostics and inputs without inventing allocation or supply', () => {
    const sourceDemand = demand();
    const sourceEnvelope = envelope();
    const before = JSON.stringify({ sourceDemand, sourceEnvelope });
    const result = projectCohortResourceSnapshot(sourceDemand, sourceEnvelope);
    expect(result).toEqual({
      kind: 'SIMULATION',
      usage: 'REFERENCE_ONLY',
      consistencyBasis: 'SINGLE_DATABASE_SNAPSHOT',
      demand: sourceDemand,
      resourceEnvelope: sourceEnvelope,
    });
    expect(CohortResourceSnapshotSchema.parse(result)).toEqual(result);
    expect(JSON.stringify({ sourceDemand, sourceEnvelope })).toBe(before);
    expect(result).not.toHaveProperty('allocation');
    expect(result).not.toHaveProperty('courses');
    expect(result.resourceEnvelope.envelope).toBeNull();
  });

  it.each(['curriculumId', 'semester', 'year', 'code', 'name', 'school'] as const)(
    'rejects individually valid but mismatched %s diagnostics',
    (field) => {
      const sourceDemand = demand();
      const sourceEnvelope = envelope();
      if (field === 'curriculumId') {
        sourceEnvelope.scope.curriculumId = randomUUID();
        sourceEnvelope.curriculum.id = sourceEnvelope.scope.curriculumId;
      } else if (field === 'semester') sourceEnvelope.scope.semester = 'SPRING';
      else if (field === 'year') sourceEnvelope.scope.year = 2027;
      else sourceEnvelope.curriculum[field] = `Other ${field}`;
      expect(() => projectCohortResourceSnapshot(sourceDemand, sourceEnvelope)).toThrow(Error);
      expect(
        CohortResourceSnapshotSchema.safeParse({
          kind: 'SIMULATION',
          usage: 'REFERENCE_ONLY',
          consistencyBasis: 'SINGLE_DATABASE_SNAPSHOT',
          demand: sourceDemand,
          resourceEnvelope: sourceEnvelope,
        }).success,
      ).toBe(false);
    },
  );

  it.each([
    { consistencyBasis: 'TWO_READS' },
    { kind: 'VALIDATED' },
    { usage: 'DEGREE_PLANNING' },
    { allocationValidated: true },
    { supply: 50 },
    { accountId: randomUUID() },
  ])('rejects added or misleading snapshot fields %j', (fields) => {
    const valid = projectCohortResourceSnapshot(demand(), envelope());
    expect(CohortResourceSnapshotSchema.safeParse({ ...valid, ...fields }).success).toBe(false);
  });

  it('validates nested diagnostics instead of silently stripping unknown or corrupt fields', () => {
    const valid = projectCohortResourceSnapshot(demand(), envelope());
    expect(
      CohortResourceSnapshotSchema.safeParse({
        ...valid,
        demand: { ...valid.demand, cohortStudentCount: -1 },
      }).success,
    ).toBe(false);
    expect(
      CohortResourceSnapshotSchema.safeParse({
        ...valid,
        resourceEnvelope: { ...valid.resourceEnvelope, updatedBy: randomUUID() },
      }).success,
    ).toBe(false);
    expect(() =>
      projectCohortResourceSnapshot(
        { ...valid.demand, cohortStudentCount: -1 },
        valid.resourceEnvelope,
      ),
    ).toThrow(Error);
  });

  it('retains nested resource arithmetic validation when composing valid primitive counts', () => {
    const sourceEnvelope = envelope();
    sourceEnvelope.resourceRevision = 1;
    sourceEnvelope.resources = {
      professors: 2,
      classrooms: 3,
      labRooms: 0,
      maxStudentsPerSection: 40,
    };
    sourceEnvelope.envelope = {
      classroomSectionCeiling: 3,
      professorSectionCeiling: 2,
      sharedSectionCeiling: 2,
      sharedSeatCeiling: 80,
    };
    const valid = projectCohortResourceSnapshot(demand(), sourceEnvelope);
    expect(CohortResourceSnapshotSchema.safeParse(valid).success).toBe(true);
    sourceEnvelope.envelope.sharedSeatCeiling = 81;
    expect(
      CohortResourceSnapshotSchema.safeParse({ ...valid, resourceEnvelope: sourceEnvelope })
        .success,
    ).toBe(false);
    expect(() => projectCohortResourceSnapshot(valid.demand, sourceEnvelope)).toThrow(Error);
  });
});
