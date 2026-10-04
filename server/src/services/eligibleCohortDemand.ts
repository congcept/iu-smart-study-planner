import { Prisma, UserRole } from '@prisma/client';
import { z } from 'zod';
import {
  CourseStatusSchema,
  CurriculumDetailSchema,
  EligibleCohortDemandPolicySchema,
  EligibleCohortDemandSnapshotSchema,
  ResourceScopeSchema,
  type CourseStatus,
  type CurriculumDetailDTO,
  type EligibleCohortDemandPolicyDTO,
  type EligibleCohortDemandSnapshotDTO,
  type ResourceScopeDTO,
} from '@iu-study-planner/shared';
import config from '../config';
import { prisma } from '../db';
import { readCurriculumSnapshot } from './curriculumContexts';
import {
  recommendCurriculumCourses,
  resolveCurriculumAvailability,
} from './curriculumRecommendations';
import { SchoolResourceError } from './schoolResources';

export interface EligibleCohortDemandStudent {
  id: string;
  records: readonly { courseId: string; status: CourseStatus }[];
  attempts: readonly { courseId: string; score: number | null }[];
}

const uuid = z
  .string()
  .uuid()
  .transform((id) => id.toLowerCase());
const studentsSchema = z
  .array(
    z
      .object({
        id: uuid,
        records: z
          .array(z.object({ courseId: uuid, status: CourseStatusSchema }).strict())
          .refine(
            (records) => new Set(records.map(({ courseId }) => courseId)).size === records.length,
            'Duplicate student course records',
          ),
        // Repeated course identities are immutable retakes, not duplicate selections.
        attempts: z.array(
          z
            .object({ courseId: uuid, score: z.number().finite().min(0).max(100).nullable() })
            .strict(),
        ),
      })
      .strict(),
  )
  .refine(
    (students) => new Set(students.map(({ id }) => id)).size === students.length,
    'Duplicate cohort students',
  );

function verifiedContext(context: CurriculumDetailDTO): CurriculumDetailDTO {
  const parsed = CurriculumDetailSchema.safeParse(context);
  if (!parsed.success)
    throw new Error('Stored eligible cohort curriculum metadata could not be verified');
  // Nested reference UUID schemas validate rather than transform; comparisons remain canonical.
  return {
    ...parsed.data,
    courses: parsed.data.courses.map((course) => ({ ...course, id: course.id.toLowerCase() })),
    prerequisites: parsed.data.prerequisites.map((edge) => ({
      ...edge,
      courseId: edge.courseId.toLowerCase(),
      prerequisiteId: edge.prerequisiteId.toLowerCase(),
    })),
  };
}

/** Pure aggregate; no student identity or per-student recommendation leaves this projection. */
export function projectEligibleCohortDemand(
  inputScope: ResourceScopeDTO,
  inputContext: CurriculumDetailDTO,
  inputStudents: readonly EligibleCohortDemandStudent[],
  inputPolicy: EligibleCohortDemandPolicyDTO,
): EligibleCohortDemandSnapshotDTO {
  const parsedScope = ResourceScopeSchema.safeParse(inputScope);
  const parsedPolicy = EligibleCohortDemandPolicySchema.safeParse(inputPolicy);
  const parsedStudents = studentsSchema.safeParse(inputStudents);
  if (!parsedScope.success || !parsedPolicy.success || !parsedStudents.success)
    throw new Error('Eligible cohort scope, policy or student metadata could not be verified');
  const context = verifiedContext(inputContext);
  const scope = parsedScope.data;
  if (scope.curriculumId !== context.id)
    throw new Error('Eligible cohort curriculum does not match its scope');
  const policy = parsedPolicy.data;
  const members = new Set(context.courses.map(({ id }) => id));
  const courses = context.courses
    .map(({ id, code, name }) => ({
      id,
      code,
      name,
      eligiblePlannedStudentCount: 0,
      recommendedStudentCount: 0,
      overlapStudentCount: 0,
      demandStudentCount: 0,
      supply: null,
      utilization: null,
    }))
    .sort((left, right) => left.code.localeCompare(right.code));
  const courseById = new Map(courses.map((course) => [course.id, course]));
  let demandStudentCount = 0;
  let eligiblePlannedStudentCount = 0;
  let recommendedStudentCount = 0;
  let ignoredNonmemberPlannedSelectionCount = 0;
  let ineligibleMemberPlannedSelectionCount = 0;
  let unresolvedGpaStudentCount = 0;

  for (const student of parsedStudents.data) {
    let studentContext = context;
    let availability = resolveCurriculumAvailability(context, student.records, student.attempts);
    if (context.isGpaPath && availability.gpaPath === null) {
      unresolvedGpaStudentCount++;
      studentContext = {
        ...context,
        courses: context.courses.map((course) => ({
          ...course,
          placements: course.placements.filter(
            (placement) => !(placement.academicYear === 4 && placement.academicSemester === 2),
          ),
        })),
      };
      availability = resolveCurriculumAvailability(
        studentContext,
        student.records,
        student.attempts,
      );
    }
    const availableIds = new Set(availability.available.map(({ id }) => id));
    const plannedIds = new Set<string>();
    for (const record of student.records) {
      if (record.status !== 'PLANNED') continue;
      if (!members.has(record.courseId)) ignoredNonmemberPlannedSelectionCount++;
      else if (!availableIds.has(record.courseId)) ineligibleMemberPlannedSelectionCount++;
      else plannedIds.add(record.courseId);
    }
    const recommendedIds = new Set(
      recommendCurriculumCourses(
        studentContext,
        student.records,
        student.attempts,
        policy,
      ).courses.map(({ id }) => id),
    );
    const demandIds = new Set([...plannedIds, ...recommendedIds]);
    if (plannedIds.size > 0) eligiblePlannedStudentCount++;
    if (recommendedIds.size > 0) recommendedStudentCount++;
    if (demandIds.size > 0) demandStudentCount++;
    for (const id of demandIds) {
      const course = courseById.get(id);
      if (!course || !availableIds.has(id))
        throw new Error('Eligible cohort recommendation is not an available member');
      const planned = plannedIds.has(id);
      const recommended = recommendedIds.has(id);
      if (planned) course.eligiblePlannedStudentCount++;
      if (recommended) course.recommendedStudentCount++;
      if (planned && recommended) course.overlapStudentCount++;
      course.demandStudentCount++;
    }
  }
  const projected = EligibleCohortDemandSnapshotSchema.safeParse({
    kind: 'SIMULATION',
    usage: 'REFERENCE_ONLY',
    scope,
    curriculum: { id: context.id, code: context.code, name: context.name, school: context.school },
    planningBasis: 'ELIGIBLE_PLANNED_OR_REFERENCE_RECOMMENDED',
    termBasis: 'SCENARIO_ONLY',
    prerequisitePolicy: 'ALL_CONTEXT_PREREQUISITES_MANDATORY',
    unknownGpaPolicy: 'DEFER_FORK_ONLY_PLACEMENTS',
    recommendationPolicy: policy,
    recommendationDemandAvailable: true,
    eligibilityValidated: false,
    offeringValidationAvailable: false,
    allocationValidated: false,
    cohortStudentCount: parsedStudents.data.length,
    demandStudentCount,
    eligiblePlannedStudentCount,
    recommendedStudentCount,
    eligiblePlannedSelectionCount: courses.reduce(
      (sum, course) => sum + course.eligiblePlannedStudentCount,
      0,
    ),
    recommendedSelectionCount: courses.reduce(
      (sum, course) => sum + course.recommendedStudentCount,
      0,
    ),
    demandSelectionCount: courses.reduce((sum, course) => sum + course.demandStudentCount, 0),
    overlapSelectionCount: courses.reduce((sum, course) => sum + course.overlapStudentCount, 0),
    ignoredNonmemberPlannedSelectionCount,
    ineligibleMemberPlannedSelectionCount,
    unresolvedGpaStudentCount,
    courses,
  });
  if (!projected.success) throw new Error('Eligible cohort demand could not be verified');
  return projected.data;
}

/** Actor, reference, cohort and history share one read-only consistent database snapshot. */
export async function readEligibleCohortDemand(
  actorId: string,
  inputScope: ResourceScopeDTO,
  transaction?: Prisma.TransactionClient,
): Promise<EligibleCohortDemandSnapshotDTO> {
  const scope = ResourceScopeSchema.parse(inputScope);
  const parsedPolicy = EligibleCohortDemandPolicySchema.safeParse(config.cohortDemandPolicy);
  if (!parsedPolicy.success)
    throw new Error('Eligible cohort recommendation policy could not be verified');
  const policy = Object.freeze(parsedPolicy.data);
  const read = async (tx: Prisma.TransactionClient) => {
    const actor = await tx.user.findUnique({ where: { id: actorId }, select: { role: true } });
    if (!actor) throw new SchoolResourceError('Authentication required', 401);
    if (actor.role !== UserRole.ADMIN)
      throw new SchoolResourceError('Administrator access required', 403);
    const snapshot = await readCurriculumSnapshot(tx, scope.curriculumId);
    if (!snapshot) throw new SchoolResourceError('Curriculum not found', 404);
    const context = verifiedContext(snapshot);
    const cohort = await tx.user.findMany({
      where: { role: UserRole.STUDENT, curriculumId: scope.curriculumId },
      select: { id: true },
    });
    const ids = cohort.map(({ id }) => id);
    const [records, attempts] = ids.length
      ? await Promise.all([
          tx.studentRecord.findMany({
            where: { userId: { in: ids } },
            select: { userId: true, courseId: true, status: true },
          }),
          tx.gradeAttempt.findMany({
            where: { userId: { in: ids } },
            select: { userId: true, courseId: true, score: true },
          }),
        ])
      : [[], []];
    const students = cohort.map(({ id }) => ({
      id,
      records: [] as { courseId: string; status: CourseStatus }[],
      attempts: [] as { courseId: string; score: number | null }[],
    }));
    const studentById = new Map(students.map((student) => [student.id.toLowerCase(), student]));
    for (const { userId, courseId, status } of records) {
      const student = studentById.get(userId.toLowerCase());
      if (!student) throw new Error('Stored eligible cohort record has an unknown owner');
      student.records.push({ courseId, status });
    }
    for (const { userId, courseId, score } of attempts) {
      const student = studentById.get(userId.toLowerCase());
      if (!student) throw new Error('Stored eligible cohort grade has an unknown owner');
      student.attempts.push({ courseId, score });
    }
    return projectEligibleCohortDemand(scope, context, students, policy);
  };
  return transaction
    ? read(transaction)
    : prisma.$transaction(read, {
        isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
      });
}
