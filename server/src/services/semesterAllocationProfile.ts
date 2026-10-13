import { createHash } from 'node:crypto';
import {
  SimulationResourceEnvelopeSchema,
  SimulationSemesterAllocationInputSchema,
  SimulationSemesterAllocationResultSchema,
  type SimulationSemesterAllocationResultDTO,
} from '@iu-study-planner/shared';
import { readSimulationAllocationPolicy } from '../config/simulationAllocation';

export const PROFILE_SCENARIOS = [
  'reference',
  'max-students',
  'max-rounds',
  'max-catalog',
  'scarce',
  'missing-resources',
] as const;
export type ProfileScenario = (typeof PROFILE_SCENARIOS)[number];

const courseId = (index: number) =>
  `aaaaaaaa-0000-4000-8000-${String(index + 1).padStart(12, '0')}`;
const studentId = (index: number) =>
  `bbbbbbbb-0000-4000-8000-${String(index + 1).padStart(12, '0')}`;

/** Fixed synthetic data only: no database, account, environment or curriculum discovery. */
export function buildSemesterAllocationProfileFixture(scenario: ProfileScenario) {
  if (!PROFILE_SCENARIOS.includes(scenario)) throw new Error('Unknown profile scenario');
  const small = scenario === 'reference' || scenario === 'missing-resources';
  const deep = scenario === 'max-rounds';
  const disjoint = scenario === 'max-catalog';
  const studentCount = small ? 12 : deep ? 100 : 500;
  const choicesPerStudent = small ? 4 : deep ? 100 : 20;
  const catalogCount = small ? 8 : disjoint ? 10000 : choicesPerStudent;
  const credits = small || scenario === 'scarce' ? 3 : 0;
  const targetCredits = small ? 9 : scenario === 'scarce' ? 18 : 30;
  const sections = small ? 8 : scenario === 'scarce' ? 4 : catalogCount;
  const seats = disjoint ? 1 : scenario === 'scarce' ? 10 : studentCount;
  const missing = scenario === 'missing-resources';
  const context = 'cccccccc-0000-4000-8000-000000000001';
  const input = SimulationSemesterAllocationInputSchema.parse({
    courses: Array.from({ length: catalogCount }, (_, index) => ({
      courseId: courseId(index),
      credits,
    })),
    students: Array.from({ length: studentCount }, (_, student) => ({
      studentId: studentId(student),
      targetCredits,
      candidates: Array.from({ length: choicesPerStudent }, (_, choice) => ({
        courseId: courseId(
          disjoint ? student * choicesPerStudent + choice : (student + choice) % catalogCount,
        ),
        studentUtility: (choicesPerStudent - choice) / choicesPerStudent,
      })),
    })),
  });
  const envelope = SimulationResourceEnvelopeSchema.parse({
    kind: 'SIMULATION',
    usage: 'REFERENCE_ONLY',
    scopeBasis: 'SCENARIO_ONLY',
    scope: { curriculumId: context, semester: 'FALL', year: 2026 },
    curriculum: { id: context, code: 'PROFILE', name: 'Synthetic profile fixture', school: 'CSE' },
    resourceRevision: missing ? null : 1,
    policy: {
      model: 'SHARED_CLASSROOM_SECTION_ENVELOPE_V1',
      classroomTimeBlocks: 1,
      sectionsPerProfessor: 1,
      roomBasis: 'ONE_CLASSROOM_SECTION_PER_ROOM_PER_BLOCK',
      teachingBasis: 'ONE_PROFESSOR_PER_SECTION_PER_BLOCK',
      sectionDurationBasis: 'ONE_SIMULATED_BLOCK',
      professorAssignmentBasis: 'INTERCHANGEABLE_FOR_ENVELOPE_ONLY',
    },
    resources: missing
      ? null
      : { professors: sections, classrooms: sections, labRooms: 0, maxStudentsPerSection: seats },
    envelope: missing
      ? null
      : {
          classroomSectionCeiling: sections,
          professorSectionCeiling: sections,
          sharedSectionCeiling: sections,
          sharedSeatCeiling: sections * seats,
        },
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
  return { scenario, envelope, input, policy: readSimulationAllocationPolicy({}) };
}

/** This includes strict deterministic replay, so its cost must be reported as validation. */
export function summarizeSemesterAllocationProfileResult(raw: unknown) {
  const result = SimulationSemesterAllocationResultSchema.parse(raw);
  const stopReasonCounts = {
    TARGET_REACHED: 0,
    NO_REMAINING_CHOICES: 0,
    CREDIT_LIMIT: 0,
    RESOURCE_UNKNOWN: 0,
    CAPACITY_EXHAUSTED: 0,
  };
  for (const student of result.students) stopReasonCounts[student.reason]++;
  return {
    studentCount: result.students.length,
    catalogCourseCount: result.input.courses.length,
    totalChoices: result.input.students.reduce(
      (sum, student) => sum + student.candidates.length,
      0,
    ),
    assignedCourseCount: result.assignedCourseCount,
    assignedStudentCount: result.assignedStudentCount,
    totalTargetCredits: result.students.reduce((sum, student) => sum + student.targetCredits, 0),
    totalAssignedCredits: result.students.reduce(
      (sum, student) => sum + student.assignedCredits,
      0,
    ),
    totalRemainingCredits: result.students.reduce(
      (sum, student) => sum + student.remainingCredits,
      0,
    ),
    usedSections: result.usedSections,
    rounds: result.rounds,
    meanAssignedUtility: result.assignments.length
      ? result.assignments.reduce((sum, assignment) => sum + assignment.studentUtility, 0) /
        result.assignments.length
      : null,
    stopReasonCounts,
  };
}

/** Unvalidated JSON identity; callers separately validate results before trusting the digest. */
export function profileDigest(value: unknown) {
  const json = JSON.stringify(value);
  if (json === undefined) throw new Error('Profile digest requires JSON data');
  return createHash('sha256').update(json).digest('hex');
}

export function summarizeProfileSamples(samples: number[]) {
  if (!samples.length || samples.some((sample) => !Number.isFinite(sample) || sample < 0))
    throw new Error('Profile timings must be nonempty finite nonnegative milliseconds');
  const sorted = [...samples].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return {
    sampleCount: sorted.length,
    minMs: sorted[0],
    medianMs: sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2,
    maxMs: sorted.at(-1)!,
  };
}

export function parseSemesterAllocationProfileOptions(argv: string[]) {
  let scenario: 'all' | ProfileScenario = 'all';
  let samples = 3;
  let warmup = 1;
  let timeoutMs = 60000;
  const seen = new Set<string>();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (seen.has(flag) || value === undefined)
      throw new Error('Duplicate or missing profile option');
    seen.add(flag);
    if (flag === '--scenario') {
      if (value !== 'all' && !PROFILE_SCENARIOS.some((name) => name === value))
        throw new Error('Unknown profile scenario');
      scenario = value as 'all' | ProfileScenario;
      continue;
    }
    const limits: Record<string, [number, number]> = {
      '--samples': [1, 10],
      '--warmup': [0, 3],
      '--timeout-ms': [1000, 120000],
    };
    const bounds = limits[flag];
    if (
      !Object.prototype.hasOwnProperty.call(limits, flag) ||
      !bounds ||
      value.trim() !== value ||
      !/^(0|[1-9]\d*)$/.test(value)
    )
      throw new Error('Invalid profile option');
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < bounds[0] || parsed > bounds[1])
      throw new Error('Profile option is outside its supported range');
    if (flag === '--samples') samples = parsed;
    else if (flag === '--warmup') warmup = parsed;
    else timeoutMs = parsed;
  }
  return { scenario, samples, warmup, timeoutMs };
}

/** Independent fixture totals supplement the allocator's pinned replay validation. */
export function assertProfileExpectations(
  scenario: ProfileScenario,
  result: SimulationSemesterAllocationResultDTO,
) {
  const small = scenario === 'reference' || scenario === 'missing-resources';
  const missing = scenario === 'missing-resources';
  const scarce = scenario === 'scarce';
  const expectedAssignments = missing ? 0 : small ? 36 : scarce ? 40 : 10000;
  const expectedRounds = missing
    ? 0
    : small
      ? 3
      : scarce
        ? 1
        : scenario === 'max-rounds'
          ? 100
          : 20;
  const reason = missing
    ? 'RESOURCE_UNKNOWN'
    : small
      ? 'TARGET_REACHED'
      : scarce
        ? 'CAPACITY_EXHAUSTED'
        : 'NO_REMAINING_CHOICES';
  if (
    result.assignments.length !== expectedAssignments ||
    result.rounds !== expectedRounds ||
    result.students.some((student) => student.reason !== reason)
  )
    throw new Error('Profile fixture outcomes differ from independent expected totals');
  const pairs = new Set<string>();
  const slots = new Set<string>();
  const assignedByCourse = new Map<string, number>();
  const catalog = new Map(result.input.courses.map((course) => [course.courseId, course]));
  const roster = new Map(result.input.students.map((student) => [student.studentId, student]));
  const demand = new Map<string, number>();
  const assignedByStudent = new Map<string, { credits: number; courseIds: string[] }>();
  for (const student of result.input.students) {
    assignedByStudent.set(student.studentId, { credits: 0, courseIds: [] });
    for (const choice of student.candidates)
      demand.set(choice.courseId, (demand.get(choice.courseId) ?? 0) + 1);
  }
  if (
    result.students.length !== roster.size ||
    new Set(result.students.map((student) => student.studentId)).size !== roster.size ||
    result.courses.length !== catalog.size ||
    new Set(result.courses.map((course) => course.courseId)).size !== catalog.size ||
    result.kind !== 'SIMULATION' ||
    result.usage !== 'INTERNAL_REFERENCE_ONLY' ||
    result.model !== 'SEMESTER_CREDIT_BUDGET_V1' ||
    result.eligibilityValidated !== false ||
    result.allocationValidated !== false ||
    result.timetableValidated !== false ||
    result.persisted !== false
  )
    throw new Error(
      'Profile reference-only result must retain the complete unique roster and catalog',
    );
  for (const row of result.assignments) {
    const pair = `${row.studentId}:${row.courseId}`;
    const slot = `${row.studentId}:${row.round}`;
    if (
      pairs.has(pair) ||
      slots.has(slot) ||
      !Number.isInteger(row.round) ||
      row.round < 1 ||
      row.round > 100 ||
      row.credits !== catalog.get(row.courseId)?.credits ||
      !roster.get(row.studentId)?.candidates.some((choice) => choice.courseId === row.courseId)
    )
      throw new Error('Profile allocation violates supplied choices or round/credit accounting');
    pairs.add(pair);
    slots.add(slot);
    assignedByCourse.set(row.courseId, (assignedByCourse.get(row.courseId) ?? 0) + 1);
    const student = assignedByStudent.get(row.studentId)!;
    student.credits += row.credits;
    student.courseIds.push(row.courseId);
  }
  const seats = result.envelope.resources?.maxStudentsPerSection ?? 0;
  if (
    result.usedSections !==
      result.courses.reduce((sum, course) => sum + course.openedSections, 0) ||
    result.usedSections > (result.envelope.envelope?.sharedSectionCeiling ?? 0) ||
    result.assignedCourseCount !== result.assignments.length ||
    result.rounds !== result.assignments.reduce((max, row) => Math.max(max, row.round), 0) ||
    result.assignedStudentCount !==
      [...assignedByStudent.values()].filter((student) => student.courseIds.length > 0).length ||
    result.courses.some(
      (course) =>
        !catalog.has(course.courseId) ||
        course.credits !== catalog.get(course.courseId)?.credits ||
        course.demandStudentCount !== (demand.get(course.courseId) ?? 0) ||
        course.assignedStudentCount !== (assignedByCourse.get(course.courseId) ?? 0) ||
        course.seatCapacity !== course.openedSections * seats ||
        course.assignedStudentCount > course.seatCapacity,
    ) ||
    result.students.some(
      (student) =>
        !roster.has(student.studentId) ||
        student.targetCredits !== roster.get(student.studentId)?.targetCredits ||
        student.assignedCredits !== assignedByStudent.get(student.studentId)?.credits ||
        JSON.stringify(student.courseIds) !==
          JSON.stringify(assignedByStudent.get(student.studentId)?.courseIds) ||
        student.assignedCredits + student.remainingCredits !== student.targetCredits ||
        student.assignedCredits > student.targetCredits,
    )
  )
    throw new Error('Profile shared capacity or student budget totals do not reconcile');
}
