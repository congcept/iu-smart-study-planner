import { z } from 'zod';
import type { ContextStudentProgressDTO } from '../dto/curriculum';
import { CurriculumCourseSchema } from './curriculumSemesterPreview';

const uuid = z.string().uuid();
const count = z.number().int().nonnegative().safe();
const baseRecord = z.object({
  id: uuid,
  userId: uuid,
  courseId: uuid,
  status: z.enum(['PLANNED', 'IN_PROGRESS', 'COMPLETED', 'DROPPED']),
  grade: z.string().nullable(),
  gradePoints: z.number().finite().nullable(),
  electiveGroup: z.string().nullable(),
  semester: z.string().nullable(),
  year: z.number().int().safe().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
const currentRecord = baseRecord.extend({ course: CurriculumCourseSchema }).strict();
const historicalRecord = baseRecord
  .extend({
    course: z
      .object({ id: uuid, code: z.string().min(1), name: z.string().min(1), credits: count })
      .strict(),
  })
  .strict();

export const ContextStudentProgressSchema = z
  .object({
    completed: z.array(currentRecord),
    inProgress: z.array(currentRecord),
    planned: z.array(currentRecord),
    historicalRecords: z.array(historicalRecord),
    available: z.array(CurriculumCourseSchema),
    progress: z
      .object({
        totalCourses: count,
        completedCourses: count,
        totalCredits: count.nullable(),
        completedCredits: count,
        percentage: z.null(),
      })
      .strict(),
    scope: z
      .object({
        userId: uuid,
        curriculumId: uuid,
        usage: z.literal('REFERENCE_ONLY'),
        degreeProgressAvailable: z.literal(false),
        gpaPath: z.enum(['THESIS', 'ALTERNATIVE']).nullable(),
        ratingPrior: z
          .object({
            mean: z.number().finite().min(1).max(5),
            source: z.enum(['CURRICULUM_RATINGS', 'CURRICULUM_SEED']),
          })
          .strict()
          .nullable(),
      })
      .strict(),
  })
  .strict()
  .superRefine((data, ctx) => {
    const invalid = (message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, message });
    const unique = (ids: string[]) =>
      new Set(ids.map((id) => id.toLowerCase())).size === ids.length;
    const records = [...data.completed, ...data.inProgress, ...data.planned];
    const allRecords = [...records, ...data.historicalRecords];
    const currentCourses = [...records.map((record) => record.course), ...data.available];
    const memberIds = new Set(currentCourses.map((course) => course.id.toLowerCase()));
    if (
      !unique(allRecords.map((record) => record.id)) ||
      !unique(allRecords.map((record) => record.courseId)) ||
      !unique(data.available.map((course) => course.id))
    )
      invalid('Duplicate progress records');
    if (
      allRecords.some(
        (record) =>
          record.userId.toLowerCase() !== data.scope.userId.toLowerCase() ||
          record.courseId.toLowerCase() !== record.course.id.toLowerCase(),
      )
    )
      invalid('Invalid progress owner/course identity');
    if (
      data.completed.some((record) => record.status !== 'COMPLETED') ||
      data.inProgress.some((record) => record.status !== 'IN_PROGRESS') ||
      data.planned.some((record) => record.status !== 'PLANNED')
    )
      invalid('Invalid progress status bucket');
    if (data.historicalRecords.some((record) => memberIds.has(record.courseId.toLowerCase())))
      invalid('Historical records overlap current members');
    if (
      data.progress.totalCourses < memberIds.size ||
      data.progress.completedCourses !== data.completed.length ||
      data.progress.completedCredits !==
        data.completed.reduce(
          (sum, record) =>
            sum + (['PT001IU', 'PT002IU'].includes(record.course.code) ? 0 : record.course.credits),
          0,
        )
    )
      invalid('Inconsistent progress counts/credits');
    const prior = data.scope.ratingPrior;
    if (data.progress.totalCourses === 0 && prior !== null)
      invalid('Empty context has a rating prior');
    for (const course of currentCourses) {
      if (
        !prior ||
        course.ratingPriorMean !== prior.mean ||
        course.ratingPriorSource !== prior.source ||
        (course.ratingCount === 0) !== (course.avgRating === null)
      )
        invalid('Inconsistent contextual difficulty');
    }
  }) satisfies z.ZodType<ContextStudentProgressDTO>;
