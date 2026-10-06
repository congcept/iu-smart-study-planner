import { z } from 'zod';
import { SimulationAllocationPolicySchema } from './simulationAllocation';
import type { SimulationResourceEnvelopeSchema } from './index';

const uuid = z
  .string()
  .length(36)
  .uuid()
  .transform((value) => value.toLowerCase());
const count = z.number().int().nonnegative().safe();
const credits = count.max(10);
const unit = z.number().finite().min(0).max(1);
const lexical = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const approximately = (a: number, b: number) => Math.abs(a - b) <= 1e-10;

export const SimulationSemesterAllocationInputSchema = z
  .object({
    courses: z.array(z.object({ courseId: uuid, credits }).strict()).max(10000),
    students: z
      .array(
        z
          .object({
            studentId: uuid,
            targetCredits: count.max(30),
            candidates: z
              .array(z.object({ courseId: uuid, studentUtility: unit }).strict())
              .max(100),
          })
          .strict(),
      )
      .max(500),
  })
  .strict()
  .superRefine((input, ctx) => {
    const fail = (message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, message });
    const catalog = new Set(input.courses.map((course) => course.courseId));
    if (catalog.size !== input.courses.length) fail('Catalog course IDs must be unique');
    if (new Set(input.students.map((student) => student.studentId)).size !== input.students.length)
      fail('Student IDs must be unique');
    let choices = 0;
    for (const student of input.students) {
      choices += student.candidates.length;
      if (
        new Set(student.candidates.map((candidate) => candidate.courseId)).size !==
        student.candidates.length
      )
        fail('Student choices must be unique');
      if (student.candidates.some((candidate) => !catalog.has(candidate.courseId)))
        fail('Every supplied choice must exist in the captured course catalog');
    }
    if (choices > 10000) fail('Semester allocation supports at most ten thousand supplied choices');
  })
  .transform((input) => ({
    courses: [...input.courses].sort((a, b) => lexical(a.courseId, b.courseId)),
    students: input.students
      .map((student) => ({
        ...student,
        candidates: [...student.candidates].sort((a, b) => lexical(a.courseId, b.courseId)),
      }))
      .sort((a, b) => lexical(a.studentId, b.studentId)),
  }));

export const SimulationSemesterAllocationReasonSchema = z.enum([
  'TARGET_REACHED',
  'NO_REMAINING_CHOICES',
  'CREDIT_LIMIT',
  'RESOURCE_UNKNOWN',
  'CAPACITY_EXHAUSTED',
]);
export type SimulationSemesterAllocationInputDTO = z.infer<
  typeof SimulationSemesterAllocationInputSchema
>;

const ledgerSchema = z
  .object({
    courseId: uuid,
    credits,
    demandStudentCount: count.max(500),
    openedSections: count.max(500),
    seatCapacity: count,
    assignedStudentCount: count.max(500),
  })
  .strict();

/** A distinct, internal budget simulation; supplied choices do not establish official eligibility. */
export const createSimulationSemesterAllocationResultSchema = (
  envelopeSchema: typeof SimulationResourceEnvelopeSchema,
) =>
  z
    .object({
      kind: z.literal('SIMULATION'),
      usage: z.literal('INTERNAL_REFERENCE_ONLY'),
      model: z.literal('SEMESTER_CREDIT_BUDGET_V1'),
      utilityBasis: z.literal('SUPPLIED_NORMALIZED_ELIGIBLE_CHOICES'),
      processingBasis: z.literal('ROUND_BARRIER_CURRENT_SCARCITY_THEN_ASSIGNED_CREDITS'),
      congestionBasis: z.literal('ORIGINAL_COURSE_DEMAND_OVER_OPENED_OR_PROSPECTIVE_SEATS'),
      eligibilityValidated: z.literal(false),
      allocationValidated: z.literal(false),
      timetableValidated: z.literal(false),
      persisted: z.literal(false),
      envelope: envelopeSchema,
      policy: SimulationAllocationPolicySchema,
      input: SimulationSemesterAllocationInputSchema,
      students: z
        .array(
          z
            .object({
              studentId: uuid,
              targetCredits: count.max(30),
              courseIds: z.array(uuid).max(100),
              assignedCredits: count.max(30),
              remainingCredits: count.max(30),
              reason: SimulationSemesterAllocationReasonSchema,
            })
            .strict(),
        )
        .max(500),
      assignments: z
        .array(
          z
            .object({
              studentId: uuid,
              courseId: uuid,
              round: count.min(1).max(100),
              credits,
              feasibleChoiceCount: count.min(1).max(100),
              studentUtility: unit,
              resourceUtilization: z.number().finite().nonnegative(),
              resourceFit: unit,
              fairness: unit,
              weightedScore: unit,
            })
            .strict(),
        )
        .max(10000),
      courses: z.array(ledgerSchema).max(10000),
      usedSections: count.max(10000),
      assignedCourseCount: count.max(10000),
      assignedStudentCount: count.max(500),
      rounds: count.max(100),
    })
    .strict()
    .superRefine((result, ctx) => {
      const fail = (message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, message });
      const { input, envelope, policy } = result;
      // Zod may invoke this refinement with a structurally valid but already dirty input.
      // Never dereference references that its nested semantic validation rejected.
      if (!SimulationSemesterAllocationInputSchema.safeParse(input).success) return;
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
      const state = new Map(
        input.students.map((student) => [
          student.studentId,
          { assignedCredits: 0, courseIds: [] as string[], assigned: new Set<string>() },
        ]),
      );
      for (const student of input.students)
        for (const candidate of student.candidates)
          ledger.get(candidate.courseId)!.demandStudentCount++;
      const sections = envelope.envelope?.sharedSectionCeiling ?? 0;
      const seats = envelope.resources?.maxStudentsPerSection ?? 0;
      let usedSections = 0;
      let round = 1;
      let pending = new Set(input.students.map((student) => student.studentId));
      const feasible = (student: SimulationSemesterAllocationInputDTO['students'][number]) => {
        const current = state.get(student.studentId)!;
        const remaining = student.targetCredits - current.assignedCredits;
        if (remaining <= 0 || envelope.resources === null) return [];
        return student.candidates.filter((candidate) => {
          const course = ledger.get(candidate.courseId)!;
          return (
            !current.assigned.has(candidate.courseId) &&
            course.credits <= remaining &&
            (course.assignedStudentCount < course.seatCapacity || usedSections < sections)
          );
        });
      };
      const nextStudent = () => {
        let best:
          | {
              student: SimulationSemesterAllocationInputDTO['students'][number];
              candidates: ReturnType<typeof feasible>;
            }
          | undefined;
        for (const student of input.students) {
          if (!pending.has(student.studentId)) continue;
          const candidates = feasible(student);
          if (!candidates.length) continue;
          if (
            !best ||
            candidates.length < best.candidates.length ||
            (candidates.length === best.candidates.length &&
              (state.get(student.studentId)!.assignedCredits <
                state.get(best.student.studentId)!.assignedCredits ||
                (state.get(student.studentId)!.assignedCredits ===
                  state.get(best.student.studentId)!.assignedCredits &&
                  lexical(student.studentId, best.student.studentId) < 0)))
          )
            best = { student, candidates };
        }
        return best;
      };
      for (const assignment of result.assignments) {
        if (assignment.round !== round) {
          if (assignment.round !== round + 1 || nextStudent() !== undefined) {
            fail('Assignments must finish each one-course-per-student round before the next');
            return;
          }
          round++;
          pending = new Set(input.students.map((student) => student.studentId));
        }
        const next = nextStudent();
        if (!next || next.student.studentId !== assignment.studentId) {
          fail(
            'Assignment student must follow current scarcity, assigned credits and UUID ordering',
          );
          return;
        }
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
        if (
          assignment.courseId !== chosen.courseId ||
          assignment.credits !== course.credits ||
          assignment.feasibleChoiceCount !== next.candidates.length ||
          assignment.studentUtility !== chosen.studentUtility ||
          !approximately(assignment.resourceUtilization, chosen.resourceUtilization) ||
          !approximately(assignment.resourceFit, chosen.resourceFit) ||
          !approximately(assignment.fairness, chosen.fairness) ||
          !approximately(assignment.weightedScore, chosen.weightedScore)
        ) {
          fail(
            'Assignment choices, frozen utility and score components must match captured inputs and capacity',
          );
          return;
        }
        const student = state.get(assignment.studentId)!;
        student.assigned.add(chosen.courseId);
        student.courseIds.push(chosen.courseId);
        student.assignedCredits += course.credits;
        pending.delete(assignment.studentId);
        if (course.assignedStudentCount === course.seatCapacity) {
          course.openedSections++;
          course.seatCapacity += seats;
          usedSections++;
        }
        course.assignedStudentCount++;
      }
      const students = input.students.map((student) => {
        const current = state.get(student.studentId)!;
        const remainingCredits = student.targetCredits - current.assignedCredits;
        const remaining = student.candidates.filter(
          (candidate) => !current.assigned.has(candidate.courseId),
        );
        const fitting = remaining.filter(
          (candidate) => ledger.get(candidate.courseId)!.credits <= remainingCredits,
        );
        const reason =
          remainingCredits === 0
            ? 'TARGET_REACHED'
            : remaining.length === 0
              ? 'NO_REMAINING_CHOICES'
              : fitting.length === 0
                ? 'CREDIT_LIMIT'
                : envelope.resources === null
                  ? 'RESOURCE_UNKNOWN'
                  : 'CAPACITY_EXHAUSTED';
        if (feasible(student).length)
          fail('Allocation cannot stop while supplied budget/capacity-feasible choices remain');
        return {
          studentId: student.studentId,
          targetCredits: student.targetCredits,
          courseIds: current.courseIds,
          assignedCredits: current.assignedCredits,
          remainingCredits,
          reason,
        };
      });
      if (JSON.stringify(result.students) !== JSON.stringify(students))
        fail(
          'Student results must exactly partition captured students and match budgets, assignments and terminal reasons',
        );
      if (JSON.stringify(result.courses) !== JSON.stringify([...ledger.values()]))
        fail(
          'Course ledger must match the complete captured catalog, original demand and replayed sections',
        );
      if (
        result.usedSections !== usedSections ||
        result.assignedCourseCount !== result.assignments.length ||
        result.assignedStudentCount !==
          students.filter((student) => student.courseIds.length > 0).length ||
        result.rounds !== (result.assignments.at(-1)?.round ?? 0) ||
        usedSections > sections ||
        result.assignments.length > (envelope.envelope?.sharedSeatCeiling ?? 0)
      )
        fail('Assignment, student and round counts must match and respect shared ceilings');
    });

export type SimulationSemesterAllocationResultDTO = z.infer<
  ReturnType<typeof createSimulationSemesterAllocationResultSchema>
>;
