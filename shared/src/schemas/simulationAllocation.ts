import { z } from 'zod';
import type { SimulationResourceEnvelopeSchema } from './index';

const unit = z.number().finite().min(0).max(1);
const count = z.number().int().nonnegative().safe();
const uuid = z
  .string()
  .uuid()
  .transform((value) => value.toLowerCase());
const approximately = (a: number, b: number) => Math.abs(a - b) <= 1e-10;

export const SimulationAllocationPolicySchema = z
  .object({
    studentUtilityWeight: unit,
    resourceFitWeight: unit,
    fairnessWeight: unit,
    congestionThreshold: z.number().finite().min(0).max(1),
  })
  .strict()
  .refine(
    (policy) =>
      approximately(
        policy.studentUtilityWeight + policy.resourceFitWeight + policy.fairnessWeight,
        1,
      ),
    'Allocation weights must sum to one',
  );

export const SimulationAllocationRosterSchema = z
  .array(
    z
      .object({
        studentId: uuid,
        candidates: z.array(z.object({ courseId: uuid, studentUtility: unit }).strict()).max(1000),
      })
      .strict(),
  )
  .max(10000)
  .superRefine((roster, ctx) => {
    const issue = (message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, message });
    if (new Set(roster.map((student) => student.studentId)).size !== roster.length)
      issue('Students must be unique after UUID normalization');
    for (const student of roster)
      if (
        new Set(student.candidates.map((course) => course.courseId)).size !==
        student.candidates.length
      )
        issue('Course choices must be unique per student after UUID normalization');
    if (roster.reduce((total, student) => total + student.candidates.length, 0) > 100000)
      issue('Allocation roster exceeds the supported candidate count');
  });

export const createSimulationAllocationResultSchema = (
  envelopeSchema: typeof SimulationResourceEnvelopeSchema,
) =>
  z
    .object({
      kind: z.literal('SIMULATION'),
      usage: z.literal('INTERNAL_REFERENCE_ONLY'),
      model: z.literal('ONE_COURSE_PER_STUDENT_ROUND_V1'),
      utilityBasis: z.literal('SUPPLIED_NORMALIZED_ELIGIBLE_CHOICES'),
      processingBasis: z.literal('FEWEST_CURRENT_FEASIBLE_CHOICES_FIRST'),
      congestionBasis: z.literal('ORIGINAL_COURSE_DEMAND_OVER_OPENED_OR_PROSPECTIVE_SEATS'),
      eligibilityValidated: z.literal(false),
      allocationValidated: z.literal(false),
      timetableValidated: z.literal(false),
      persisted: z.literal(false),
      envelope: envelopeSchema,
      policy: SimulationAllocationPolicySchema,
      rosterStudentIds: z.array(uuid).max(10000),
      assignments: z.array(
        z
          .object({
            studentId: uuid,
            courseId: uuid,
            feasibleChoiceCount: count.min(1).max(1000),
            studentUtility: unit,
            resourceUtilization: z.number().finite().nonnegative(),
            resourceFit: unit,
            fairness: unit,
            weightedScore: unit,
          })
          .strict(),
      ),
      unassigned: z.array(
        z
          .object({
            studentId: uuid,
            reason: z.enum(['NO_CHOICES', 'RESOURCE_UNKNOWN', 'CAPACITY_EXHAUSTED']),
          })
          .strict(),
      ),
      courses: z.array(
        z
          .object({
            courseId: uuid,
            demandStudentCount: count.min(1),
            openedSections: count,
            seatCapacity: count,
            assignedStudentCount: count,
          })
          .strict(),
      ),
      usedSections: count,
      assignedStudentCount: count,
      unassignedStudentCount: count,
    })
    .strict()
    .superRefine((result, ctx) => {
      const issue = (message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, message });
      const roster = new Set(result.rosterStudentIds);
      const outcomes = [...result.assignments, ...result.unassigned].map((row) => row.studentId);
      if (
        roster.size !== result.rosterStudentIds.length ||
        new Set(outcomes).size !== outcomes.length ||
        outcomes.length !== roster.size ||
        outcomes.some((id) => !roster.has(id))
      )
        issue('Allocation outcomes must partition the unique roster exactly once');
      if (
        result.assignedStudentCount !== result.assignments.length ||
        result.unassignedStudentCount !== result.unassigned.length
      )
        issue('Allocation outcome counts must match their rows');
      const courses = new Map(result.courses.map((course) => [course.courseId, course]));
      if (courses.size !== result.courses.length) issue('Allocation courses must be unique');
      const assigned = new Map<string, number>();
      const seatsPerSection = result.envelope.resources?.maxStudentsPerSection ?? 0;
      for (const row of result.assignments) {
        assigned.set(row.courseId, (assigned.get(row.courseId) ?? 0) + 1);
        const course = courses.get(row.courseId);
        const capacityAtAssignment =
          seatsPerSection > 0
            ? Math.ceil(assigned.get(row.courseId)! / seatsPerSection) * seatsPerSection
            : 0;
        if (
          course === undefined ||
          capacityAtAssignment === 0 ||
          !approximately(row.resourceUtilization, course.demandStudentCount / capacityAtAssignment)
        )
          issue('Allocation utilization must use its course demand and capacity at assignment');
        const fit =
          1 - Math.min(1, Math.max(0, row.resourceUtilization - result.policy.congestionThreshold));
        const score =
          row.studentUtility * result.policy.studentUtilityWeight +
          row.resourceFit * result.policy.resourceFitWeight +
          row.fairness * result.policy.fairnessWeight;
        if (
          !approximately(row.resourceFit, fit) ||
          !approximately(row.fairness, 1 / row.feasibleChoiceCount) ||
          !approximately(row.weightedScore, score)
        )
          issue('Allocation score components must match the captured policy');
        if (!courses.has(row.courseId))
          issue('Assigned courses must be present in the course rows');
      }
      for (const course of result.courses) {
        if (
          course.seatCapacity !== course.openedSections * seatsPerSection ||
          course.assignedStudentCount !== (assigned.get(course.courseId) ?? 0) ||
          course.assignedStudentCount > course.seatCapacity ||
          course.assignedStudentCount > course.demandStudentCount ||
          course.demandStudentCount > roster.size ||
          (course.openedSections === 0) !== (course.assignedStudentCount === 0) ||
          (seatsPerSection > 0 &&
            course.openedSections !== Math.ceil(course.assignedStudentCount / seatsPerSection))
        )
          issue('Course sections, seats and assignment counts must agree');
      }
      if (
        result.usedSections !==
          result.courses.reduce((total, course) => total + course.openedSections, 0) ||
        result.usedSections > (result.envelope.envelope?.sharedSectionCeiling ?? 0) ||
        result.assignedStudentCount > (result.envelope.envelope?.sharedSeatCeiling ?? 0)
      )
        issue('Allocation must respect the shared section and seat ceilings');
      for (const row of result.unassigned) {
        if (row.reason === 'RESOURCE_UNKNOWN' && result.envelope.resources !== null)
          issue('Unknown-resource outcomes require missing resources');
        if (row.reason === 'CAPACITY_EXHAUSTED' && result.envelope.resources === null)
          issue('Shared-section outcomes require configured resources');
      }
    });
