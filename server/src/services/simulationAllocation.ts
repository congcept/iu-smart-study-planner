import {
  SimulationAllocationPolicySchema,
  SimulationAllocationResultSchema,
  SimulationAllocationRosterSchema,
  SimulationResourceEnvelopeSchema,
  type SimulationAllocationPolicyDTO,
  type SimulationAllocationResultDTO,
  type SimulationAllocationRosterDTO,
  type SimulationResourceEnvelopeDTO,
} from '@iu-study-planner/shared';

const lexical = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * A deterministic greedy, single-course round over supplied eligible choices.
 * Scarcity orders students; its constant per-student fairness component does not
 * change that student's course ranking. This is not a maximum-matching solver.
 */
export function allocateSimulationRound(
  rawEnvelope: SimulationResourceEnvelopeDTO,
  rawRoster: SimulationAllocationRosterDTO,
  rawPolicy: SimulationAllocationPolicyDTO,
): SimulationAllocationResultDTO {
  const envelope = SimulationResourceEnvelopeSchema.parse(rawEnvelope);
  const roster = SimulationAllocationRosterSchema.parse(rawRoster)
    .map((student) => ({
      ...student,
      candidates: [...student.candidates].sort((a, b) => lexical(a.courseId, b.courseId)),
    }))
    .sort((a, b) => lexical(a.studentId, b.studentId));
  const policy = Object.freeze(SimulationAllocationPolicySchema.parse(rawPolicy));
  const courses = new Map<string, SimulationAllocationResultDTO['courses'][number]>();
  for (const student of roster)
    for (const candidate of student.candidates) {
      const course = courses.get(candidate.courseId) ?? {
        courseId: candidate.courseId,
        demandStudentCount: 0,
        openedSections: 0,
        seatCapacity: 0,
        assignedStudentCount: 0,
      };
      course.demandStudentCount += 1;
      courses.set(candidate.courseId, course);
    }
  const assignments: SimulationAllocationResultDTO['assignments'] = [];
  const unassigned: SimulationAllocationResultDTO['unassigned'] = [];
  const sections = envelope.envelope?.sharedSectionCeiling ?? 0;
  const seatsPerSection = envelope.resources?.maxStudentsPerSection ?? 0;
  let usedSections = 0;
  const pending = roster.filter((student) => {
    if (student.candidates.length === 0) {
      unassigned.push({ studentId: student.studentId, reason: 'NO_CHOICES' });
      return false;
    }
    if (envelope.resources === null) {
      unassigned.push({ studentId: student.studentId, reason: 'RESOURCE_UNKNOWN' });
      return false;
    }
    return true;
  });
  const feasible = (student: SimulationAllocationRosterDTO[number]) =>
    student.candidates.filter((candidate) => {
      const course = courses.get(candidate.courseId)!;
      return course.assignedStudentCount < course.seatCapacity || usedSections < sections;
    });

  while (pending.length > 0) {
    // Recompute capacity-feasible choices after every seat; congestion is a separate
    // course-ranking filter and must not distort this scarcity ordering.
    const ordered = pending
      .map((student) => ({ student, candidates: feasible(student) }))
      .sort(
        (a, b) =>
          a.candidates.length - b.candidates.length ||
          lexical(a.student.studentId, b.student.studentId),
      );
    const { student, candidates } = ordered[0];
    pending.splice(pending.indexOf(student), 1);
    if (candidates.length === 0) {
      unassigned.push({ studentId: student.studentId, reason: 'CAPACITY_EXHAUSTED' });
      continue;
    }
    const scored = candidates.map((candidate) => {
      const course = courses.get(candidate.courseId)!;
      const capacity =
        course.assignedStudentCount < course.seatCapacity
          ? course.seatCapacity
          : course.seatCapacity + seatsPerSection;
      const resourceUtilization = course.demandStudentCount / capacity;
      const resourceFit =
        1 - Math.min(1, Math.max(0, resourceUtilization - policy.congestionThreshold));
      const fairness = 1 / candidates.length;
      return {
        ...candidate,
        resourceUtilization,
        resourceFit,
        fairness,
        weightedScore: Math.min(
          1,
          candidate.studentUtility * policy.studentUtilityWeight +
            resourceFit * policy.resourceFitWeight +
            fairness * policy.fairnessWeight,
        ),
      };
    });
    const uncongested = scored.filter((candidate) => candidate.resourceUtilization < 1);
    const ranked = (uncongested.length > 0 ? uncongested : scored).sort(
      (a, b) => b.weightedScore - a.weightedScore || lexical(a.courseId, b.courseId),
    );
    const choice = ranked[0];
    const course = courses.get(choice.courseId)!;
    if (course.assignedStudentCount === course.seatCapacity) {
      course.openedSections += 1;
      course.seatCapacity += seatsPerSection;
      usedSections += 1;
    }
    course.assignedStudentCount += 1;
    assignments.push({
      studentId: student.studentId,
      courseId: choice.courseId,
      feasibleChoiceCount: candidates.length,
      studentUtility: choice.studentUtility,
      resourceUtilization: choice.resourceUtilization,
      resourceFit: choice.resourceFit,
      fairness: choice.fairness,
      weightedScore: choice.weightedScore,
    });
  }
  return SimulationAllocationResultSchema.parse({
    kind: 'SIMULATION',
    usage: 'INTERNAL_REFERENCE_ONLY',
    model: 'ONE_COURSE_PER_STUDENT_ROUND_V1',
    utilityBasis: 'SUPPLIED_NORMALIZED_ELIGIBLE_CHOICES',
    processingBasis: 'FEWEST_CURRENT_FEASIBLE_CHOICES_FIRST',
    congestionBasis: 'ORIGINAL_COURSE_DEMAND_OVER_OPENED_OR_PROSPECTIVE_SEATS',
    eligibilityValidated: false,
    allocationValidated: false,
    timetableValidated: false,
    persisted: false,
    envelope,
    policy,
    rosterStudentIds: roster.map((student) => student.studentId),
    assignments,
    unassigned: unassigned.sort((a, b) => lexical(a.studentId, b.studentId)),
    courses: [...courses.values()].sort((a, b) => lexical(a.courseId, b.courseId)),
    usedSections,
    assignedStudentCount: assignments.length,
    unassignedStudentCount: unassigned.length,
  });
}
