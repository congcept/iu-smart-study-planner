import { z } from 'zod';
import type { CurriculumSemesterPreviewDTO } from '../dto/curriculum';

const uuid = z.string().uuid();
const count = z.number().int().nonnegative().safe();
const year = z.number().int().positive().safe();
const semester = z.number().int().min(1).max(3);
const difficulty = z.number().finite().min(1).max(5);
const priorSource = z.enum(['CURRICULUM_RATINGS', 'CURRICULUM_SEED']);
const placement = z
  .object({
    id: uuid,
    academicYear: year.nullable(),
    academicSemester: semester.nullable(),
    electiveGroup: z.string().nullable(),
    electiveSelectCount: z.number().int().positive().safe().nullable(),
    sourceOrder: count,
    sourceLabel: z.string().nullable(),
  })
  .strict();
export const CurriculumCourseSchema = z
  .object({
    id: uuid,
    code: z.string().min(1),
    name: z.string().min(1),
    credits: count,
    difficultyLevel: difficulty,
    description: z.string().nullable(),
    semesterOffered: z.array(z.enum(['FALL', 'SPRING', 'SUMMER'])),
    avgRating: difficulty.nullable(),
    ratingCount: count,
    ratingDifficulty: difficulty,
    ratingPriorMean: difficulty,
    ratingPriorSource: priorSource,
    placements: z.array(placement),
  })
  .strict();

/** A reference preview must never be accepted as a validated degree or calendar plan. */
export const CurriculumSemesterPreviewSchema = z
  .object({
    scope: z
      .object({
        curriculumId: uuid,
        usage: z.literal('REFERENCE_ONLY'),
        planningBasis: z.literal('SELECTED_COURSES'),
        ratingPrior: z.object({ mean: difficulty, source: priorSource }).strict().nullable(),
        electiveRequirementsValidated: z.literal(false),
        offeringValidationAvailable: z.literal(false),
        calendarDatesAvailable: z.literal(false),
      })
      .strict(),
    gpaPath: z.enum(['THESIS', 'ALTERNATIVE']).nullable(),
    slots: z.array(
      z
        .object({
          academicYear: year,
          academicSemester: semester,
          courseIds: z.array(uuid).min(1),
          totalCredits: count,
          averageDifficulty: difficulty,
        })
        .strict(),
    ),
    courses: z.array(CurriculumCourseSchema),
    ignoredPlannedIds: z.array(uuid),
    unscheduled: z.array(
      z
        .object({
          courseId: uuid,
          reason: z.enum([
            'UNPLACED',
            'GPA_EXCLUDED',
            'COURSE_EXCEEDS_CREDIT_CAP',
            'REFERENCE_SLOT_LIMIT',
            'PREREQUISITE_CYCLE',
            'UNMET_PREREQUISITE',
            'NO_REMAINING_PLACEMENT',
          ]),
        })
        .strict(),
    ),
    stats: z
      .object({
        selectedCourseCount: count,
        scheduledCourseCount: count,
        unscheduledCourseCount: count,
        selectedCredits: count,
        scheduledCredits: count,
        semestersToCompletion: z.null(),
        totalRemainingCredits: z.null(),
        estimatedGraduation: z.null(),
      })
      .strict(),
    requirements: z.array(
      z
        .object({
          id: uuid,
          kind: z.literal('FREE_ELECTIVE'),
          name: z.string().min(1),
          credits: count,
          academicYear: year.nullable(),
          academicSemester: semester.nullable(),
          sourceOrder: count,
          sourceLabel: z.string().nullable(),
        })
        .strict(),
    ),
  })
  .strict()
  .superRefine((preview, ctx) => {
    const invalid = (message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, message });
    const unique = (ids: string[]) => new Set(ids).size === ids.length;
    const courseById = new Map(preview.courses.map((item) => [item.id, item]));
    const scheduled = preview.slots.flatMap((slot) => slot.courseIds);
    const unscheduled = preview.unscheduled.map((item) => item.courseId);
    const allSelected = [...scheduled, ...unscheduled];
    if (
      !unique(preview.courses.map((item) => item.id)) ||
      !unique(preview.courses.map((item) => item.code)) ||
      !unique(allSelected) ||
      allSelected.length !== preview.courses.length ||
      allSelected.some((id) => !courseById.has(id))
    )
      invalid('Selected course references are inconsistent');
    if (!unique(preview.slots.map((slot) => `${slot.academicYear}:${slot.academicSemester}`)))
      invalid('Reference slots are duplicated');
    if (
      !unique(preview.ignoredPlannedIds) ||
      preview.ignoredPlannedIds.some((id) => courseById.has(id))
    )
      invalid('Historical selections overlap the selected curriculum courses');
    if (
      !unique(preview.requirements.map((item) => item.id)) ||
      !unique(preview.courses.flatMap((item) => item.placements.map(({ id }) => id)))
    )
      invalid('Curriculum metadata identifiers are duplicated');
    for (const item of preview.courses) {
      const prior = preview.scope.ratingPrior;
      if (!prior || item.ratingPriorMean !== prior.mean || item.ratingPriorSource !== prior.source)
        invalid('Selected courses must share the curriculum rating prior');
      if ((item.ratingCount === 0) !== (item.avgRating === null))
        invalid('Rating confidence does not match the reported average');
    }
    for (const slot of preview.slots) {
      const courses = slot.courseIds.map((id) => courseById.get(id));
      if (courses.some((item) => !item)) continue;
      const known = courses.filter((item): item is NonNullable<typeof item> => item !== undefined);
      if (
        slot.totalCredits !== known.reduce((sum, item) => sum + item.credits, 0) ||
        Math.abs(
          slot.averageDifficulty -
            known.reduce((sum, item) => sum + item.ratingDifficulty, 0) / known.length,
        ) > 1e-9
      )
        invalid('Reference slot totals are inconsistent');
      if (
        known.some(
          (item) =>
            !item.placements.some(
              (entry) =>
                entry.academicYear === slot.academicYear &&
                entry.academicSemester === slot.academicSemester,
            ),
        )
      )
        invalid('A scheduled course has no matching reference placement');
    }
    const stats = preview.stats;
    if (
      stats.selectedCourseCount !== preview.courses.length ||
      stats.scheduledCourseCount !== scheduled.length ||
      stats.unscheduledCourseCount !== unscheduled.length ||
      stats.selectedCredits !== preview.courses.reduce((sum, item) => sum + item.credits, 0) ||
      stats.scheduledCredits !== preview.slots.reduce((sum, slot) => sum + slot.totalCredits, 0)
    )
      invalid('Preview summary totals are inconsistent');
  }) satisfies z.ZodType<CurriculumSemesterPreviewDTO>;
