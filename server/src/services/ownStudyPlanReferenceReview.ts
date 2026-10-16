import { Prisma } from '@prisma/client';
import {
  OwnStudyPlanReferenceReviewBodySchema,
  OwnStudyPlanReferenceReviewSchema,
  type OwnStudyPlanReferenceReviewBodyDTO,
  type OwnStudyPlanReferenceReviewDTO,
} from '@iu-study-planner/shared';
import { prisma } from '../db';
import { calculateGradeSummary } from './gradeSummary';
import { isCourseInGpaPath } from './gpaPath';
import { readOwnStudyPlanCoursesInTransaction } from './ownStudyPlanCourses';
import { OwnStudyPlanSemestersError } from './ownStudyPlanSemesters';

/** Read-only current-context checks at an explicit reference slot, with no historical inference. */
export function reviewOwnStudyPlanReferenceSlot(
  actorId: string,
  planId: string,
  semesterId: string,
  input: OwnStudyPlanReferenceReviewBodyDTO,
): Promise<OwnStudyPlanReferenceReviewDTO> {
  const body = OwnStudyPlanReferenceReviewBodySchema.parse(input);
  return prisma.$transaction(
    async (tx) => {
      const snapshot = await readOwnStudyPlanCoursesInTransaction(tx, actorId, planId, semesterId);
      if (
        snapshot.scope.userId !== body.expectedScope.userId ||
        snapshot.scope.curriculumId !== body.expectedScope.curriculumId
      )
        throw new OwnStudyPlanSemestersError(
          'Your account or curriculum changed; reload before reviewing',
          409,
        );
      const referenceSlot = {
        academicYear: body.academicYear,
        academicSemester: body.academicSemester,
      };
      const base = {
        snapshot,
        referenceSlot,
        validation: {
          calendarValidated: false,
          originalCurriculumKnown: false,
          savingEnabled: false,
        },
      };
      const curriculumId = snapshot.scope.curriculumId;
      if (curriculumId === null)
        return OwnStudyPlanReferenceReviewSchema.parse({
          ...base,
          review: { status: 'UNAVAILABLE', reason: 'NO_ASSIGNED_CURRICULUM' },
        });
      const refs = snapshot.courseReferences;
      if (refs.status !== 'RECOGNIZED')
        return OwnStudyPlanReferenceReviewSchema.parse({
          ...base,
          review: { status: 'UNAVAILABLE', reason: 'COURSE_REFERENCES_UNAVAILABLE' },
        });
      const curriculum = await tx.curriculum.findUnique({
        where: { id: curriculumId },
        select: { isGpaPath: true },
      });
      // Assignment FK and snapshot should make this impossible; do not fall back to legacy data.
      if (!curriculum) throw new OwnStudyPlanSemestersError('Current curriculum not found', 409);
      const members = await tx.curriculumCourse.findMany({
        where: { curriculumId },
        select: {
          courseId: true,
          course: { select: { id: true, code: true, credits: true } },
          placements: { select: { academicYear: true, academicSemester: true } },
        },
      });
      const memberIds = members.map(({ courseId }) => courseId);
      const records = await tx.studentRecord.findMany({
        where: { userId: snapshot.scope.userId, status: 'COMPLETED', courseId: { in: memberIds } },
        select: { courseId: true },
      });
      const attempts = curriculum.isGpaPath
        ? await tx.gradeAttempt.findMany({
            where: { userId: snapshot.scope.userId, courseId: { in: memberIds } },
            select: { courseId: true, score: true },
          })
        : [];
      const gpaPath = curriculum.isGpaPath
        ? calculateGradeSummary(
            members.map(({ course }) => course),
            attempts,
          ).gpaPath
        : null;
      const edges = await tx.curriculumPrerequisite.findMany({
        where: { curriculumId, courseId: { in: refs.entries.map(({ courseId }) => courseId) } },
        select: { courseId: true, prerequisiteId: true },
      });
      const completed = new Set(records.map(({ courseId }) => courseId));
      const parents = new Map<string, Set<string>>();
      for (const edge of edges) {
        const own = parents.get(edge.courseId) ?? new Set<string>();
        own.add(edge.prerequisiteId);
        parents.set(edge.courseId, own);
      }
      const byId = new Map(members.map((member) => [member.courseId, member]));
      const entries = refs.entries.map(({ courseId, currentCurriculumMembership }) => {
        const member = byId.get(courseId);
        const blockers: Extract<
          OwnStudyPlanReferenceReviewDTO['review'],
          { status: 'ASSESSED' }
        >['entries'][number]['blockers'] = [];
        if (currentCurriculumMembership !== 'PLACED_MEMBER' || !member) {
          blockers.push('NO_CURRENT_PLACEMENT');
          return { courseId, blockers, missingPrerequisiteCount: null };
        }
        const matches = member.placements.some(
          (placement) =>
            placement.academicYear === referenceSlot.academicYear &&
            placement.academicSemester === referenceSlot.academicSemester,
        );
        if (!matches) blockers.push('NO_MATCHING_REFERENCE_SLOT');
        else if (
          curriculum.isGpaPath &&
          referenceSlot.academicYear === 4 &&
          referenceSlot.academicSemester === 2
        ) {
          if (gpaPath === null) blockers.push('GPA_UNDETERMINED');
          else if (!isCourseInGpaPath({ code: member.course.code, ...referenceSlot }, gpaPath))
            blockers.push('GPA_EXCLUDED');
        }
        const missingPrerequisiteCount = [...(parents.get(courseId) ?? [])].filter(
          (parent) => !completed.has(parent),
        ).length;
        if (missingPrerequisiteCount > 0) blockers.push('UNMET_PREREQUISITE');
        return { courseId, blockers, missingPrerequisiteCount };
      });
      return OwnStudyPlanReferenceReviewSchema.parse({
        ...base,
        review: { status: 'ASSESSED', basis: 'CURRENT_COMPLETIONS_ONLY', gpaPath, entries },
      });
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
}
