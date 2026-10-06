import {
  SimulationAllocationPolicySchema,
  SimulationResourceEnvelopeSchema,
  SimulationSemesterAllocationInputSchema,
  SimulationSemesterAllocationResultSchema,
  type SimulationSemesterAllocationInputDTO,
  type SimulationSemesterAllocationResultDTO,
} from '@iu-study-planner/shared';

const lexical = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Frozen supplied choices, ordinary credit budgets and one course per student per round.
 * This internal simulation does not discover prerequisites, offerings or same-slot unlocks.
 * Opening sections persists across rounds; original supplied-choice demand stays fixed.
 */
export function allocateSimulationSemester(
  rawEnvelope: unknown,
  rawInput: unknown,
  rawPolicy: unknown,
): SimulationSemesterAllocationResultDTO {
  const envelope = SimulationResourceEnvelopeSchema.parse(rawEnvelope);
  const input = SimulationSemesterAllocationInputSchema.parse(rawInput);
  const policy = SimulationAllocationPolicySchema.parse(rawPolicy);
  const ledger = new Map(
    input.courses.map((course) => [
      course.courseId,
      {
        ...course,
        demandStudentCount: 0,
        openedSections: 0,
        seatCapacity: 0,
        assignedStudentCount: 0,
      },
    ]),
  );
  const students = new Map(
    input.students.map((student) => [
      student.studentId,
      {
        studentId: student.studentId,
        targetCredits: student.targetCredits,
        courseIds: [] as string[],
        assignedCredits: 0,
        remainingCredits: student.targetCredits,
        assigned: new Set<string>(),
      },
    ]),
  );
  for (const student of input.students)
    for (const candidate of student.candidates)
      ledger.get(candidate.courseId)!.demandStudentCount++;
  const assignments: SimulationSemesterAllocationResultDTO['assignments'] = [];
  const sections = envelope.envelope?.sharedSectionCeiling ?? 0;
  const seats = envelope.resources?.maxStudentsPerSection ?? 0;
  let usedSections = 0;
  let round = 1;
  const feasible = (student: SimulationSemesterAllocationInputDTO['students'][number]) => {
    const current = students.get(student.studentId)!;
    if (current.remainingCredits === 0 || envelope.resources === null) return [];
    return student.candidates.filter((candidate) => {
      const course = ledger.get(candidate.courseId)!;
      return (
        !current.assigned.has(candidate.courseId) &&
        course.credits <= current.remainingCredits &&
        (course.assignedStudentCount < course.seatCapacity || usedSections < sections)
      );
    });
  };

  while (round <= 100) {
    const pending = new Set(input.students.map((student) => student.studentId));
    let assignedThisRound = 0;
    while (pending.size) {
      let next:
        | {
            student: SimulationSemesterAllocationInputDTO['students'][number];
            candidates: ReturnType<typeof feasible>;
          }
        | undefined;
      // Counts are recomputed against the current budgets and shared ledger after each seat.
      for (const student of input.students) {
        if (!pending.has(student.studentId)) continue;
        const candidates = feasible(student);
        if (!candidates.length) {
          pending.delete(student.studentId);
          continue;
        }
        const credits = students.get(student.studentId)!.assignedCredits;
        const previousCredits = next ? students.get(next.student.studentId)!.assignedCredits : 0;
        if (
          !next ||
          candidates.length < next.candidates.length ||
          (candidates.length === next.candidates.length &&
            (credits < previousCredits ||
              (credits === previousCredits &&
                lexical(student.studentId, next.student.studentId) < 0)))
        )
          next = { student, candidates };
      }
      if (!next) break;
      const scored = next.candidates.map((candidate) => {
        const course = ledger.get(candidate.courseId)!;
        const capacity =
          course.assignedStudentCount < course.seatCapacity
            ? course.seatCapacity
            : course.seatCapacity + seats;
        const resourceUtilization = course.demandStudentCount / capacity;
        const resourceFit =
          1 - Math.min(1, Math.max(0, resourceUtilization - policy.congestionThreshold));
        const fairness = 1 / next.candidates.length;
        const weightedScore = Math.min(
          1,
          candidate.studentUtility * policy.studentUtilityWeight +
            resourceFit * policy.resourceFitWeight +
            fairness * policy.fairnessWeight,
        );
        return { ...candidate, resourceUtilization, resourceFit, fairness, weightedScore };
      });
      const alternatives = scored.filter((candidate) => candidate.resourceUtilization < 1);
      const chosen = (alternatives.length ? alternatives : scored).sort(
        (a, b) => b.weightedScore - a.weightedScore || lexical(a.courseId, b.courseId),
      )[0];
      const course = ledger.get(chosen.courseId)!;
      if (course.assignedStudentCount === course.seatCapacity) {
        course.openedSections++;
        course.seatCapacity += seats;
        usedSections++;
      }
      course.assignedStudentCount++;
      const current = students.get(next.student.studentId)!;
      current.assigned.add(chosen.courseId);
      current.courseIds.push(chosen.courseId);
      current.assignedCredits += course.credits;
      current.remainingCredits -= course.credits;
      pending.delete(next.student.studentId);
      assignedThisRound++;
      assignments.push({
        studentId: next.student.studentId,
        courseId: chosen.courseId,
        round,
        credits: course.credits,
        feasibleChoiceCount: next.candidates.length,
        studentUtility: chosen.studentUtility,
        resourceUtilization: chosen.resourceUtilization,
        resourceFit: chosen.resourceFit,
        fairness: chosen.fairness,
        weightedScore: chosen.weightedScore,
      });
    }
    if (!assignedThisRound) break;
    round++;
  }
  const results: SimulationSemesterAllocationResultDTO['students'] = input.students.map(
    (student) => {
      const current = students.get(student.studentId)!;
      const remaining = student.candidates.filter(
        (candidate) => !current.assigned.has(candidate.courseId),
      );
      const fitting = remaining.filter(
        (candidate) => ledger.get(candidate.courseId)!.credits <= current.remainingCredits,
      );
      // Target and supplied-choice exhaustion take precedence over unavailable resources.
      const reason =
        current.remainingCredits === 0
          ? 'TARGET_REACHED'
          : remaining.length === 0
            ? 'NO_REMAINING_CHOICES'
            : fitting.length === 0
              ? 'CREDIT_LIMIT'
              : envelope.resources === null
                ? 'RESOURCE_UNKNOWN'
                : 'CAPACITY_EXHAUSTED';
      return {
        studentId: student.studentId,
        targetCredits: student.targetCredits,
        courseIds: current.courseIds,
        assignedCredits: current.assignedCredits,
        remainingCredits: current.remainingCredits,
        reason,
      };
    },
  );
  return SimulationSemesterAllocationResultSchema.parse({
    kind: 'SIMULATION',
    usage: 'INTERNAL_REFERENCE_ONLY',
    model: 'SEMESTER_CREDIT_BUDGET_V1',
    utilityBasis: 'SUPPLIED_NORMALIZED_ELIGIBLE_CHOICES',
    processingBasis: 'ROUND_BARRIER_CURRENT_SCARCITY_THEN_ASSIGNED_CREDITS',
    congestionBasis: 'ORIGINAL_COURSE_DEMAND_OVER_OPENED_OR_PROSPECTIVE_SEATS',
    eligibilityValidated: false,
    allocationValidated: false,
    timetableValidated: false,
    persisted: false,
    envelope,
    policy,
    input,
    students: results,
    assignments,
    courses: [...ledger.values()],
    usedSections,
    assignedCourseCount: assignments.length,
    assignedStudentCount: results.filter((student) => student.courseIds.length > 0).length,
    rounds: assignments.at(-1)?.round ?? 0,
  });
}
