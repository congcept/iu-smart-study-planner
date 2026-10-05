import { randomUUID } from 'node:crypto';
import type { CourseStatus } from '@prisma/client';
import {
  AllocationPreviewSchema,
  type CurriculumCourseDTO,
  type CurriculumDetailDTO,
} from '@iu-study-planner/shared';
import {
  projectEligibleCohortDemand,
  projectEligibleCohortDemandWithChoices,
} from '../services/eligibleCohortDemand';
import { projectAllocationPreview } from '../services/allocationPreview';
import { projectCohortResourceSnapshot } from '../services/cohortResourceSnapshot';
import { projectSimulationResourceEnvelope } from '../services/schoolResourceEnvelope';
import { allocateSimulationRound } from '../services/simulationAllocation';
import config from '../config';
import { calculateAllocationStudentUtility } from '../services/allocationUtility';

const ids = Array.from({ length: 10 }, () => randomUUID());
const course = (index: number, year = 1, semester = 1): CurriculumCourseDTO => ({
  id: ids[index],
  code: `TEST${index}IU`,
  name: `Reference ${index}`,
  credits: 3,
  difficultyLevel: 2,
  description: null,
  semesterOffered: [],
  avgRating: null,
  ratingCount: 0,
  ratingDifficulty: 2,
  ratingPriorMean: 2,
  ratingPriorSource: 'CURRICULUM_SEED',
  placements: [
    {
      id: randomUUID(),
      academicYear: year,
      academicSemester: semester,
      electiveGroup: null,
      electiveSelectCount: null,
      sourceOrder: index,
      sourceLabel: null,
    },
  ],
});
const context = (courses: CurriculumCourseDTO[], isGpaPath = false): CurriculumDetailDTO => ({
  id: ids[9],
  code: 'TEST',
  name: 'Reference curriculum',
  school: 'CSE',
  degree: 'Bachelor',
  programUrl: 'https://example.test/reference',
  totalCredits: null,
  isGpaPath,
  sourceLabel: null,
  sourceUrl: null,
  usage: 'REFERENCE_ONLY',
  courses,
  requirements: [],
  prerequisites: [],
  ratingPrior: courses.length ? { mean: 2, source: 'CURRICULUM_SEED' } : null,
});
const scope = { curriculumId: ids[9], semester: 'FALL' as const, year: 2026 };
const policy = { maxCredits: 18, maxDifficulty: 3.5 };
const student = (
  records: { courseId: string; status: CourseStatus }[] = [],
  attempts: { courseId: string; score: number | null }[] = [],
) => ({ id: randomUUID(), records, attempts });
const planned = (index: number) => ({ courseId: ids[index], status: 'PLANNED' as const });
const build = (
  source = context([course(0), course(1)]),
  students = [
    student([planned(0)]),
    student(),
    student([
      { courseId: ids[0], status: 'COMPLETED' },
      { courseId: ids[1], status: 'COMPLETED' },
    ]),
  ],
  seats: number | null = 1,
) => {
  const pair = projectEligibleCohortDemandWithChoices(scope, source, students, policy);
  const envelope = projectSimulationResourceEnvelope(
    {
      kind: 'SIMULATION',
      curriculum: { id: source.id, code: source.code, name: source.name, school: source.school },
      semester: 'FALL',
      year: 2026,
      resource:
        seats === null
          ? null
          : {
              ...scope,
              id: randomUUID(),
              updatedBy: null,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              professors: 1,
              classrooms: 1,
              labRooms: 8,
              maxStudentsPerSection: seats,
              courseOverrides: {},
              revision: 1,
            },
    },
    { ...config.simulationResourcePolicy, classroomTimeBlocks: 1, sectionsPerProfessor: 1 },
  );
  const snapshot = projectCohortResourceSnapshot(pair.demand, envelope);
  const allocation = allocateSimulationRound(
    envelope,
    pair.choices.map(({ studentId, candidates }) => ({
      studentId,
      candidates: candidates.map(({ courseId, ratingDifficulty, immediateUnlockCount }) => ({
        courseId,
        studentUtility: calculateAllocationStudentUtility(
          { ratingDifficulty, immediateUnlockCount },
          config.allocationUtilityPolicy,
        ),
      })),
    })),
    config.simulationAllocationPolicy,
  );
  return {
    students,
    pair,
    snapshot,
    allocation,
    preview: projectAllocationPreview(snapshot, allocation, config.allocationUtilityPolicy),
  };
};

describe('aggregate allocation preview projection', () => {
  it('shares exact planned/recommended union with public demand and retains empty-choice students', () => {
    const source = context([course(0), course(1)]);
    const result = build(source);
    expect(result.pair.demand).toEqual(
      projectEligibleCohortDemand(scope, source, result.students, policy),
    );
    expect(result.pair.choices.map(({ candidates }) => candidates.length)).toEqual([2, 2, 0]);
    expect(result.pair.choices[0].candidates.map(({ courseId }) => courseId)).toEqual(
      [ids[0], ids[1]].sort(),
    );
    expect(
      result.pair.choices[0].candidates.every(({ ratingDifficulty }) => ratingDifficulty === 2),
    ).toBe(true);
    expect(result.preview).toMatchObject({
      assignedStudentCount: 1,
      noChoicesStudentCount: 1,
      capacityExhaustedStudentCount: 1,
      resourceUnknownStudentCount: 0,
      usedSections: 1,
    });
    expect(result.preview.courses.reduce((total, row) => total + row.seatCapacity, 0)).toBe(1);
    expect(AllocationPreviewSchema.parse(result.preview)).toEqual(result.preview);
  });
  it('keeps utility difficulty from current context rather than a seed or global course category', () => {
    const source = context([
      { ...course(0), ratingDifficulty: 4 },
      { ...course(1), ratingDifficulty: 1 },
    ]);
    const result = build(source, [student()]);
    expect(result.pair.choices[0].candidates).toEqual(
      expect.arrayContaining([
        { courseId: ids[0], ratingDifficulty: 4, immediateUnlockCount: 0 },
        { courseId: ids[1], ratingDifficulty: 1, immediateUnlockCount: 0 },
      ]),
    );
    expect(result.preview.courses.find(({ id }) => id === ids[1])?.assignedStudentCount).toBe(1);
  });
  it('does not allocate a mandatory dependent before its prerequisite', () => {
    const source = context([course(0), course(1)]);
    source.prerequisites.push({
      id: randomUUID(),
      courseId: ids[1],
      prerequisiteId: ids[0],
      isStrict: false,
      isCorequisite: true,
      mandatory: true,
    });
    const result = build(source, [
      student([planned(1)]),
      student([{ courseId: ids[0], status: 'COMPLETED' }]),
    ]);
    expect(result.pair.choices[0].candidates.map(({ courseId }) => courseId)).toEqual([ids[0]]);
    expect(result.pair.choices[1].candidates.map(({ courseId }) => courseId)).toEqual([ids[1]]);
    expect(result.pair.demand.ineligibleMemberPlannedSelectionCount).toBe(1);
    expect(result.preview.assignedStudentCount).toBe(1);
  });
  it.each([
    [70, 2],
    [70.00001, 1],
    [null, null],
  ] as const)(
    'keeps exact highest-retake GPA eligibility in allocator choices at %s',
    (score, chosen) => {
      const source = context(
        [
          course(0),
          { ...course(1, 4, 2), code: 'IT058IU' },
          { ...course(2, 4, 2), code: 'IT168IU' },
        ],
        true,
      );
      const result = build(source, [
        student(
          [planned(1), planned(2)],
          [
            { courseId: ids[0], score: score === null ? null : 20 },
            { courseId: ids[0], score },
          ],
        ),
      ]);
      const candidates = result.pair.choices[0].candidates.map(({ courseId }) => courseId);
      if (chosen === null) {
        expect(candidates).not.toContain(ids[1]);
        expect(candidates).not.toContain(ids[2]);
      } else {
        expect(candidates).toContain(ids[chosen]);
        expect(candidates).not.toContain(ids[chosen === 1 ? 2 : 1]);
      }
    },
  );
  it('does not leak internal roster/assignment scores or mutate inputs', () => {
    const { snapshot, allocation, students } = build();
    const before = JSON.stringify({ snapshot, allocation });
    const result = projectAllocationPreview(snapshot, allocation, config.allocationUtilityPolicy);
    expect(JSON.stringify({ snapshot, allocation })).toBe(before);
    for (const { id } of students) expect(JSON.stringify(result)).not.toContain(id);
    for (const key of [
      'studentId',
      'rosterStudentIds',
      'assignments',
      'unassigned',
      'studentUtility',
      'finalScore',
    ])
      expect(result).not.toHaveProperty(key);
  });
  it('distinguishes no choices from unknown resources and zero capacity', () => {
    const missing = build(undefined, undefined, null).preview;
    expect(missing).toMatchObject({
      assignedStudentCount: 0,
      noChoicesStudentCount: 1,
      resourceUnknownStudentCount: 2,
      capacityExhaustedStudentCount: 0,
    });
    expect(missing.courses.every(({ seatUtilization }) => seatUtilization === null)).toBe(true);
    const empty = build(context([]), [student()], null).preview;
    expect(empty).toMatchObject({
      noChoicesStudentCount: 1,
      resourceUnknownStudentCount: 0,
      courses: [],
    });
    expect(build(context([]), []).preview).toMatchObject({
      assignedStudentCount: 0,
      noChoicesStudentCount: 0,
      courses: [],
    });
  });
  it('retains member rows with zero demand and uses assigned-seat utilization', () => {
    const result = build(
      undefined,
      [student([{ courseId: ids[0], status: 'COMPLETED' }])],
      40,
    ).preview;
    expect(result.courses.find(({ id }) => id === ids[0])).toMatchObject({
      demandStudentCount: 0,
      assignedStudentCount: 0,
      openedSections: 0,
      seatCapacity: 0,
      seatUtilization: null,
    });
    expect(result.courses.find(({ id }) => id === ids[1])).toMatchObject({
      assignedStudentCount: 1,
      openedSections: 1,
      seatCapacity: 40,
      seatUtilization: 1 / 40,
    });
    expect(
      result.snapshot.demand.courses.every(
        ({ supply, utilization }) => supply === null && utilization === null,
      ),
    ).toBe(true);
  });
  it.each([
    { persisted: true },
    { allocationValidated: true },
    { eligibilityValidated: true },
    { timetableValidated: true },
    { categoryPersonalizationAvailable: true },
    { gradePersonalizationAvailable: true },
    { timelinePersonalizationAvailable: true },
    { utilityBasis: 'GRADE_FIT' },
    { studentId: ids[8] },
    { assignedStudentCount: 2 },
    { noChoicesStudentCount: 0 },
    { capacityExhaustedStudentCount: 0 },
    { resourceUnknownStudentCount: 1 },
    { usedSections: 2 },
  ])('rejects misleading/private aggregate fields %#', (fields) => {
    const { preview } = build();
    expect(AllocationPreviewSchema.safeParse({ ...preview, ...fields }).success).toBe(false);
  });
  it.each([
    'duplicate',
    'missing',
    'nonmember',
    'code',
    'demand',
    'assigned',
    'sections',
    'capacity',
    'utilization',
    'private',
  ] as const)('rejects corrupt course row %s', (kind) => {
    const { preview } = build();
    const row = preview.courses.find(({ assignedStudentCount }) => assignedStudentCount > 0)!;
    if (kind === 'duplicate') preview.courses.push({ ...row });
    if (kind === 'missing') preview.courses.pop();
    if (kind === 'nonmember') row.id = randomUUID();
    if (kind === 'code') row.code = 'OTHER';
    if (kind === 'demand') row.demandStudentCount++;
    if (kind === 'assigned') row.assignedStudentCount++;
    if (kind === 'sections') row.openedSections++;
    if (kind === 'capacity') row.seatCapacity++;
    if (kind === 'utilization') row.seatUtilization = null;
    const input =
      kind === 'private'
        ? {
            ...preview,
            courses: [
              { ...row, studentIds: [ids[8]] },
              ...preview.courses.filter((c) => c !== row),
            ],
          }
        : preview;
    expect(AllocationPreviewSchema.safeParse(input).success).toBe(false);
  });
  it('rejects allocations from a different envelope, roster size or eligible union', () => {
    const a = build();
    const b = build(undefined, undefined, 40);
    expect(() =>
      projectAllocationPreview(a.snapshot, b.allocation, config.allocationUtilityPolicy),
    ).toThrow('envelope or cohort');
    const fewer = build(undefined, [student()]);
    expect(() =>
      projectAllocationPreview(a.snapshot, fewer.allocation, config.allocationUtilityPolicy),
    ).toThrow('envelope or cohort');
    const different = build(context([course(2)]));
    expect(() =>
      projectAllocationPreview(a.snapshot, different.allocation, config.allocationUtilityPolicy),
    ).toThrow('choices do not match');
  });
});
