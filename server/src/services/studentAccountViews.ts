import { Prisma, type Course, type StudentRecord } from '@prisma/client';
import type {
  ContextStudentProfileDTO,
  ContextStudentProgressDTO,
  ContextStudentRecordDTO,
  ContextStudentRecordsDTO,
  CurriculumDetailDTO,
} from '@iu-study-planner/shared';
import { prisma } from '../db';
import { PUBLIC_USER_SELECT } from './authService';
import { readCurriculumSnapshot } from './curriculumContexts';
import { calculateGradeSummary } from './gradeSummary';
import { StudentRecordError } from './studentRecordError';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ownerSelect = { ...PUBLIC_USER_SELECT, curriculumId: true } as const;
const basicCourseSelect = { id: true, code: true, name: true, credits: true } as const;

type BasicCourse = Pick<Course, 'id' | 'code' | 'name' | 'credits'>;
type HistoricalRecord = ContextStudentProgressDTO['historicalRecords'][number];
type RecordWithCourse = StudentRecord & { course: BasicCourse };

async function readOwner(tx: Prisma.TransactionClient, identifier: string) {
  const owner = await tx.user.findUnique({
    where: uuidPattern.test(identifier)
      ? { id: identifier.toLowerCase() }
      : { studentId: identifier },
    select: ownerSelect,
  });
  if (!owner) throw new StudentRecordError('User not found', 404);
  return owner;
}

async function readAssignedContext(tx: Prisma.TransactionClient, curriculumId: string) {
  const context = await readCurriculumSnapshot(tx, curriculumId);
  if (!context) throw new StudentRecordError('Curriculum not found', 404);
  return context;
}

function projectRecords(records: RecordWithCourse[], context: CurriculumDetailDTO) {
  const members = new Map(context.courses.map((course) => [course.id, course]));
  const currentRecords: ContextStudentRecordDTO[] = [];
  const historicalRecords: HistoricalRecord[] = [];
  for (const { course, ...record } of records) {
    const stored = {
      ...record,
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
    };
    const member = members.get(record.courseId);
    if (member) currentRecords.push({ ...stored, course: member });
    else {
      historicalRecords.push({
        ...stored,
        course: { id: course.id, code: course.code, name: course.name, credits: course.credits },
      });
    }
  }
  return { records: currentRecords, historicalRecords };
}

function contextScope(context: CurriculumDetailDTO) {
  return {
    curriculumId: context.id,
    usage: context.usage,
    ratingPrior: context.ratingPrior,
  };
}

const degreeCredits = (course: BasicCourse) =>
  ['PT001IU', 'PT002IU'].includes(course.code) ? 0 : course.credits;

/** Owner, curriculum, records, attempts and cached plans share one consistent snapshot. */
export function readStudentProfileView(identifier: string) {
  return prisma.$transaction(
    async (tx) => {
      const owner = await readOwner(tx, identifier);
      const { curriculumId, ...publicOwner } = owner;
      const studyPlans = await tx.studyPlan.findMany({
        where: { userId: owner.id, isActive: true },
        include: { semesters: true },
      });
      if (curriculumId) {
        const context = await readAssignedContext(tx, curriculumId);
        const storedRecords = await tx.studentRecord.findMany({
          where: { userId: owner.id },
          include: { course: { select: basicCourseSelect } },
          orderBy: { createdAt: 'desc' },
        });
        const { records, historicalRecords } = projectRecords(storedRecords, context);
        const attempts = await tx.gradeAttempt.findMany({
          where: { userId: owner.id, courseId: { in: context.courses.map(({ id }) => id) } },
          select: { courseId: true, score: true },
        });
        const summary = calculateGradeSummary(context.courses, attempts);
        if (!context.isGpaPath) summary.gpaPath = null;
        const completed = records.filter(({ status }) => status === 'COMPLETED');
        const profile: ContextStudentProfileDTO = {
          ...publicOwner,
          createdAt: publicOwner.createdAt.toISOString(),
          updatedAt: publicOwner.updatedAt.toISOString(),
          studentRecords: records,
          historicalRecords,
          studyPlans: studyPlans.map((plan) => ({
            ...plan,
            createdAt: plan.createdAt.toISOString(),
            updatedAt: plan.updatedAt.toISOString(),
            semesters: plan.semesters.map((semester) => ({
              ...semester,
              createdAt: semester.createdAt.toISOString(),
              updatedAt: semester.updatedAt.toISOString(),
            })),
          })),
          stats: {
            totalCourses: records.length,
            completedCourses: completed.length,
            totalCredits: completed.reduce((sum, record) => sum + degreeCredits(record.course), 0),
            ...summary,
          },
          scope: { ...contextScope(context), studyPlansValidated: false },
        };
        return profile;
      }
      const records = await tx.studentRecord.findMany({
        where: { userId: owner.id },
        include: { course: true },
        orderBy: { createdAt: 'desc' },
      });
      const completed = records.filter(({ status }) => status === 'COMPLETED');
      const legacyGpa = completed.length
        ? completed.reduce((sum, record) => sum + (record.gradePoints ?? 0), 0) / completed.length
        : 0;
      return {
        ...publicOwner,
        studentRecords: records,
        studyPlans,
        stats: {
          totalCourses: records.length,
          completedCourses: completed.length,
          totalCredits: completed.reduce((sum, record) => sum + degreeCredits(record.course), 0),
          gpa: Math.round(legacyGpa * 100) / 100,
        },
      };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
}

/** Assigned records expose only contextual course metadata; nonmember history stays separate. */
export function readStudentRecordsView(identifier: string) {
  return prisma.$transaction(
    async (tx) => {
      const owner = await readOwner(tx, identifier);
      if (owner.curriculumId) {
        const context = await readAssignedContext(tx, owner.curriculumId);
        const storedRecords = await tx.studentRecord.findMany({
          where: { userId: owner.id },
          include: { course: { select: basicCourseSelect } },
          orderBy: { createdAt: 'desc' },
        });
        const records: ContextStudentRecordsDTO = {
          ...projectRecords(storedRecords, context),
          scope: contextScope(context),
        };
        return records;
      }
      return tx.studentRecord.findMany({
        where: { userId: owner.id },
        include: {
          course: {
            include: {
              prerequisites: {
                include: { prerequisite: { select: { id: true, code: true, name: true } } },
              },
              isPrerequisiteFor: {
                include: { course: { select: { id: true, code: true, name: true } } },
              },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      });
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
}
