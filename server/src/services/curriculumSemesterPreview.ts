import { Prisma, type CourseStatus } from '@prisma/client';
import type {
  CurriculumCourseDTO,
  CurriculumDetailDTO,
  CurriculumSemesterPreviewDTO,
  SemesterPreviewUnscheduledReason,
} from '@iu-study-planner/shared';
import policyConfig from '../config';
import { prisma } from '../db';
import { readCurriculumSnapshot } from './curriculumContexts';
import { decorateCourseDifficulties } from './courseRatings';
import { calculateGradeSummary, type NumericGradeAttempt } from './gradeSummary';
import { isCourseInGpaPath } from './gpaPath';
import { getSemesterIntensityConfig } from '../config/semesterIntensity';
import { StudentRecordError } from './studentRecordError';

type RecordedCourse = { courseId: string; status: CourseStatus };
type ReferenceSlot = { academicYear: number; academicSemester: number };

function validSlot<T extends { academicYear: number | null; academicSemester: number | null }>(
  placement: T,
): placement is T & ReferenceSlot {
  return (
    placement.academicYear !== null &&
    Number.isSafeInteger(placement.academicYear) &&
    placement.academicYear > 0 &&
    placement.academicSemester !== null &&
    Number.isSafeInteger(placement.academicSemester) &&
    placement.academicSemester >= 1 &&
    placement.academicSemester <= 3
  );
}

const slotKey = (slot: ReferenceSlot) => `${slot.academicYear}:${slot.academicSemester}`;
const compareCourse = (left: CurriculumCourseDTO, right: CurriculumCourseDTO) =>
  left.code.localeCompare(right.code) || left.id.localeCompare(right.id);

/** Preview the selected courses against reference slots, never a degree or calendar schedule. */
export function buildCurriculumSemesterPreview(
  context: CurriculumDetailDTO,
  records: readonly RecordedCourse[],
  attempts: readonly NumericGradeAttempt[],
  intensityMode: string,
): CurriculumSemesterPreviewDTO {
  const intensity = getSemesterIntensityConfig(intensityMode);
  const memberIds = new Set(context.courses.map(({ id }) => id));
  const gpaPath = context.isGpaPath
    ? calculateGradeSummary(
        context.courses,
        attempts.filter(({ courseId }) => memberIds.has(courseId)),
      ).gpaPath
    : null;
  const planned = new Set(
    records.filter(({ status }) => status === 'PLANNED').map(({ courseId }) => courseId),
  );
  const completed = new Set(
    records
      .filter(({ courseId, status }) => status === 'COMPLETED' && memberIds.has(courseId))
      .map(({ courseId }) => courseId),
  );
  const taken = new Set(
    records
      .filter(({ status }) => status === 'COMPLETED' || status === 'IN_PROGRESS')
      .map(({ courseId }) => courseId),
  );
  const courses = context.courses
    .filter(({ id }) => planned.has(id) && !taken.has(id))
    .sort(compareCourse);
  const selectedById = new Map(courses.map((course) => [course.id, course]));
  const allSurvivingSlots = new Map<string, ReferenceSlot>();
  const courseSlots = new Map<string, Set<string>>();
  const originalSlotCount = new Map<string, number>();
  for (const course of context.courses) {
    const original = course.placements.filter(validSlot);
    originalSlotCount.set(course.id, original.length);
    const surviving = original.filter((placement) =>
      isCourseInGpaPath({ code: course.code, ...placement }, gpaPath),
    );
    const ownSlots = new Set<string>();
    for (const placement of surviving) {
      const slot = {
        academicYear: placement.academicYear,
        academicSemester: placement.academicSemester,
      };
      const key = slotKey(slot);
      ownSlots.add(key);
      allSurvivingSlots.set(key, slot);
    }
    courseSlots.set(course.id, ownSlots);
  }
  const referenceSlots = [...allSurvivingSlots.values()].sort(
    (left, right) =>
      left.academicYear - right.academicYear || left.academicSemester - right.academicSemester,
  );
  const processedSlots = referenceSlots.slice(0, intensity.maxSemesters);
  const processedKeys = new Set(processedSlots.map(slotKey));
  const parents = new Map<string, Set<string>>();
  const children = new Map<string, Set<string>>();
  for (const edge of context.prerequisites) {
    const courseParents = parents.get(edge.courseId) ?? new Set<string>();
    courseParents.add(edge.prerequisiteId);
    parents.set(edge.courseId, courseParents);
    const parentChildren = children.get(edge.prerequisiteId) ?? new Set<string>();
    parentChildren.add(edge.courseId);
    children.set(edge.prerequisiteId, parentChildren);
  }
  const scheduled = new Set<string>();
  const slots: CurriculumSemesterPreviewDTO['slots'] = [];
  for (const slot of processedSlots) {
    const key = slotKey(slot);
    // Freeze eligibility before selecting anything in this slot. Same-slot courses cannot unlock peers.
    const available = courses.filter(
      (course) =>
        !scheduled.has(course.id) &&
        courseSlots.get(course.id)?.has(key) &&
        [...(parents.get(course.id) ?? [])].every(
          (parent) => completed.has(parent) || scheduled.has(parent),
        ),
    );
    const scored = available
      .map((course) => ({
        course,
        score:
          [...(children.get(course.id) ?? [])].filter((child) => {
            const selected = selectedById.get(child);
            return (
              selected !== undefined &&
              !scheduled.has(child) &&
              selected.credits <= intensity.maxCreditsPerSemester &&
              processedSlots.some(
                (later) =>
                  (later.academicYear > slot.academicYear ||
                    (later.academicYear === slot.academicYear &&
                      later.academicSemester > slot.academicSemester)) &&
                  courseSlots.get(child)?.has(slotKey(later)) &&
                  [...(parents.get(child) ?? [])].every((parent) => {
                    if (completed.has(parent) || scheduled.has(parent)) return true;
                    const selectedParent = selectedById.get(parent);
                    return (
                      selectedParent !== undefined &&
                      selectedParent.credits <= intensity.maxCreditsPerSemester &&
                      processedSlots.some(
                        (parentSlot) =>
                          (parentSlot.academicYear > slot.academicYear ||
                            (parentSlot.academicYear === slot.academicYear &&
                              parentSlot.academicSemester >= slot.academicSemester)) &&
                          (parentSlot.academicYear < later.academicYear ||
                            (parentSlot.academicYear === later.academicYear &&
                              parentSlot.academicSemester < later.academicSemester)) &&
                          courseSlots.get(parent)?.has(slotKey(parentSlot)),
                      )
                    );
                  }),
              )
            );
          }).length *
            10 -
          (course.ratingDifficulty - 1) * policyConfig.semesterDifficultyPenaltyWeight -
          course.credits,
      }))
      .sort((left, right) => right.score - left.score || compareCourse(left.course, right.course));
    const chosen: CurriculumCourseDTO[] = [];
    let credits = 0;
    for (const { course } of scored) {
      if (credits + course.credits > intensity.maxCreditsPerSemester) continue;
      chosen.push(course);
      credits += course.credits;
    }
    if (chosen.length) {
      slots.push({
        ...slot,
        courseIds: chosen.map(({ id }) => id),
        totalCredits: credits,
        averageDifficulty:
          chosen.reduce((sum, course) => sum + course.ratingDifficulty, 0) / chosen.length,
      });
      chosen.forEach(({ id }) => scheduled.add(id));
    }
  }
  const remaining = new Set(courses.filter(({ id }) => !scheduled.has(id)).map(({ id }) => id));
  const cycleMemo = new Map<string, boolean>();
  const visiting = new Set<string>();
  const hasCycle = (courseId: string): boolean => {
    if (visiting.has(courseId)) return true;
    const cached = cycleMemo.get(courseId);
    if (cached !== undefined) return cached;
    visiting.add(courseId);
    const cyclic = [...(parents.get(courseId) ?? [])].some(
      (parent) => !completed.has(parent) && remaining.has(parent) && hasCycle(parent),
    );
    visiting.delete(courseId);
    cycleMemo.set(courseId, cyclic);
    return cyclic;
  };
  const unscheduled = courses
    .filter(({ id }) => remaining.has(id))
    .map(({ id, credits }) => {
      const ownSlots = courseSlots.get(id)!;
      let reason: SemesterPreviewUnscheduledReason;
      if (originalSlotCount.get(id) === 0) reason = 'UNPLACED';
      else if (ownSlots.size === 0) reason = 'GPA_EXCLUDED';
      else if (credits > intensity.maxCreditsPerSemester) reason = 'COURSE_EXCEEDS_CREDIT_CAP';
      else if (![...ownSlots].some((key) => processedKeys.has(key)))
        reason = 'REFERENCE_SLOT_LIMIT';
      else if (hasCycle(id)) reason = 'PREREQUISITE_CYCLE';
      else if (
        [...(parents.get(id) ?? [])].some(
          (parent) => !completed.has(parent) && !scheduled.has(parent),
        )
      )
        reason = 'UNMET_PREREQUISITE';
      else reason = 'NO_REMAINING_PLACEMENT';
      return { courseId: id, reason };
    });
  return {
    scope: {
      curriculumId: context.id,
      usage: context.usage,
      planningBasis: 'SELECTED_COURSES',
      ratingPrior: context.ratingPrior,
      electiveRequirementsValidated: false,
      offeringValidationAvailable: false,
      calendarDatesAvailable: false,
    },
    gpaPath,
    slots,
    courses,
    ignoredPlannedIds: [...planned].filter((id) => !memberIds.has(id)).sort(),
    unscheduled,
    stats: {
      selectedCourseCount: courses.length,
      scheduledCourseCount: scheduled.size,
      unscheduledCourseCount: unscheduled.length,
      selectedCredits: courses.reduce((sum, course) => sum + course.credits, 0),
      scheduledCredits: slots.reduce((sum, slot) => sum + slot.totalCredits, 0),
      semestersToCompletion: null,
      totalRemainingCredits: null,
      estimatedGraduation: null,
    },
    requirements: context.requirements,
  };
}

/** Resolve assigned and legacy planning inputs without a split account/catalog snapshot. */
export function readCurriculumSemesterPreview(userId: string | undefined, intensityMode: string) {
  return prisma.$transaction(
    async (tx) => {
      let curriculumId: string | null = null;
      if (userId !== undefined) {
        const owner = await tx.user.findUnique({
          where: { id: userId },
          select: { curriculumId: true },
        });
        if (!owner) throw new StudentRecordError('User not found', 404);
        curriculumId = owner.curriculumId;
      }
      if (curriculumId) {
        const context = await readCurriculumSnapshot(tx, curriculumId);
        if (!context) throw new StudentRecordError('Curriculum not found', 404);
        const records = await tx.studentRecord.findMany({
          where: { userId },
          select: { courseId: true, status: true },
        });
        const attempts = await tx.gradeAttempt.findMany({
          where: { userId },
          select: { courseId: true, score: true },
        });
        return {
          kind: 'CONTEXT' as const,
          data: buildCurriculumSemesterPreview(context, records, attempts, intensityMode),
        };
      }
      const rows = await tx.course.findMany({
        include: {
          prerequisites: { include: { prerequisite: true } },
          isPrerequisiteFor: { include: { course: { select: { id: true } } } },
        },
      });
      return { kind: 'LEGACY' as const, courses: await decorateCourseDifficulties(tx, rows) };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
}
