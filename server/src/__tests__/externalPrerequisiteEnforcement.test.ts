import { randomUUID } from 'node:crypto';
import { CourseStatus } from '@prisma/client';
import { prisma } from '../index';
import { verifyCurriculumManifest } from '../services/curriculumManifest';
import { unmetPrerequisites } from '../services/prerequisiteSatisfaction';
import { updateStudentRecord } from '../services/studentRecords';

describe('external prerequisite enforcement (PostgreSQL)', () => {
  const prefix = `ext-${randomUUID()}`;
  const curriculumId = randomUUID();
  const ownerId = randomUUID();
  const memberId = randomUUID();
  const externalId = randomUUID();
  // The manifest schema requires published IU course codes, so the fixtures use that shape.
  const memberCode = 'EX900IU';
  const externalCode = 'EX901IU';

  beforeAll(async () => {
    await prisma.curriculum.create({
      data: {
        id: curriculumId,
        code: `${prefix}-CUR`,
        name: 'External prerequisite programme',
        school: 'CSE',
        degree: 'Bachelor',
        programUrl: 'https://example.test/ext',
      },
    });
    await prisma.course.createMany({
      data: [
        { id: memberId, code: memberCode, name: 'Member course', credits: 3, difficultyLevel: 2 },
        {
          id: externalId,
          code: externalCode,
          name: 'External course',
          credits: 3,
          difficultyLevel: 2,
        },
      ],
    });
    await prisma.curriculumCourse.create({ data: { curriculumId, courseId: memberId } });
    await prisma.curriculumPlacement.create({
      data: {
        curriculumCourseId: (
          await prisma.curriculumCourse.findFirstOrThrow({
            where: { curriculumId, courseId: memberId },
          })
        ).id,
        academicYear: 1,
        academicSemester: 1,
        sourceOrder: 0,
      },
    });
    await prisma.curriculumPrerequisite.create({
      data: {
        curriculumId,
        courseId: memberId,
        prerequisiteId: null,
        externalPrerequisite: externalCode,
      },
    });
    await prisma.user.create({
      data: {
        id: ownerId,
        studentId: `${prefix}-STUDENT`,
        name: 'External prerequisite student',
        email: `${prefix}@example.test`,
        role: 'STUDENT',
        curriculumId,
      },
    });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: ownerId } });
    await prisma.curriculum.deleteMany({ where: { id: curriculumId } });
    await prisma.course.deleteMany({ where: { id: { in: [memberId, externalId] } } });
    await prisma.$disconnect();
  });

  it('blocks completion until the external course is recorded as completed', async () => {
    await expect(
      updateStudentRecord(ownerId, { courseId: memberId, status: CourseStatus.COMPLETED } as never),
    ).rejects.toMatchObject({
      status: 409,
      details: [{ code: externalCode }],
    });
    expect(
      await prisma.studentRecord.count({ where: { userId: ownerId, courseId: memberId } }),
    ).toBe(0);
  });

  it('accepts the completion once the external course has a record', async () => {
    await prisma.studentRecord.create({
      data: { userId: ownerId, courseId: externalId, status: CourseStatus.COMPLETED },
    });
    await updateStudentRecord(ownerId, {
      courseId: memberId,
      status: CourseStatus.COMPLETED,
    } as never);
    expect(
      await prisma.studentRecord.count({
        where: { userId: ownerId, courseId: memberId, status: CourseStatus.COMPLETED },
      }),
    ).toBe(1);
  });

  it('treats an unknown external code as never satisfied', () => {
    const unmet = unmetPrerequisites(
      [{ prerequisiteId: null, externalPrerequisite: 'ZZ999IU', prerequisite: null }],
      new Set([memberId]),
      new Map(),
    );
    expect(unmet).toEqual([{ id: 'ZZ999IU', code: 'ZZ999IU', name: 'ZZ999IU' }]);
  });

  it('resolves a member edge against the same record set', () => {
    const edges = [{ prerequisiteId: memberId, externalPrerequisite: null, prerequisite: null }];
    expect(unmetPrerequisites(edges, new Set([memberId]), new Map())).toEqual([]);
    expect(unmetPrerequisites(edges, new Set(), new Map())).toHaveLength(1);
  });

  it('refuses a manifest that marks a member course as external', () => {
    const report = verifyCurriculumManifest({
      program: {
        code: 'EXT',
        name: 'External',
        school: 'CSE',
        degree: 'Bachelor',
        programUrl: 'https://example.test/ext',
        cohort: 'K2025',
      },
      source: {
        label: 'Simulated',
        url: 'https://example.test/doc.pdf',
        sha256: 'c'.repeat(64),
        pages: '1',
        retrievedOn: '2026-11-08',
      },
      totalCredits: 6,
      excluded: [],
      blocks: [
        {
          code: 'I',
          name: 'Only block',
          requiredCredits: 6,
          electiveCredits: 0,
          requiredCourses: [memberCode, externalCode],
        },
      ],
      courses: [
        { code: memberCode, name: 'Member course', credits: 3, lecture: 3, lab: 0 },
        { code: externalCode, name: 'Also a member', credits: 3, lecture: 3, lab: 0 },
      ],
      placements: [memberCode, externalCode].map((code, order) => ({
        code,
        year: 1,
        semester: 1,
        group: null,
        selectCount: null,
        selectCredits: null,
        sourceOrder: order,
      })),
      requirements: [],
      // Both endpoints are members, so marking the prerequisite external contradicts the manifest.
      prerequisites: [
        { course: memberCode, prerequisite: externalCode, kind: 'HT', external: true },
      ],
    });
    expect(report.readiness).toBe(false);
    expect(report.issues.map(({ message }) => message)).toEqual(
      expect.arrayContaining([expect.stringMatching(/cannot be marked external/)]),
    );
  });
});
