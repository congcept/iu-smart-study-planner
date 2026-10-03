import { randomUUID } from 'crypto';
import { prisma } from '../db';

describe('additive curriculum foundation (PostgreSQL)', () => {
  const prefix = `curriculum-foundation-${randomUUID()}`;
  const ownerId = randomUUID();
  const courseA = randomUUID();
  const courseB = randomUUID();
  const courseC = randomUUID();
  const courseIds = [courseA, courseB, courseC];
  let firstId: string;
  let secondId: string;
  let membershipA: string;
  let membershipB: string;
  const curriculumData = (code: string) => ({
    code: `${prefix}-${code}`,
    name: 'Simulated curriculum',
    school: 'School of Computer Science and Engineering',
    degree: 'Bachelor',
    programUrl: 'https://example.test/simulated-curriculum',
  });

  beforeAll(async () => {
    await prisma.user.create({
      data: {
        id: ownerId,
        studentId: prefix,
        name: 'Curriculum storage test',
        email: `${prefix}@example.test`,
      },
    });
    await prisma.course.createMany({
      data: courseIds.map((id) => ({
        id,
        code: `${prefix}-${id}`,
        name: 'Global curriculum test course',
        credits: 3,
        difficultyLevel: 2,
      })),
    });
  });

  beforeEach(async () => {
    await prisma.curriculum.deleteMany({ where: { code: { startsWith: prefix } } });
    await prisma.courseRating.deleteMany({ where: { userId: ownerId } });
    await prisma.studentRecord.deleteMany({ where: { userId: ownerId } });
    await prisma.gradeAttempt.deleteMany({ where: { userId: ownerId } });
    firstId = (await prisma.curriculum.create({ data: curriculumData('first') })).id;
    secondId = (await prisma.curriculum.create({ data: curriculumData('second') })).id;
    for (const curriculumId of [firstId, secondId]) {
      await prisma.curriculumCourse.createMany({
        data: courseIds.map((courseId) => ({ curriculumId, courseId })),
      });
    }
    membershipA = (
      await prisma.curriculumCourse.findUniqueOrThrow({
        where: { curriculumId_courseId: { curriculumId: firstId, courseId: courseA } },
      })
    ).id;
    membershipB = (
      await prisma.curriculumCourse.findUniqueOrThrow({
        where: { curriculumId_courseId: { curriculumId: firstId, courseId: courseB } },
      })
    ).id;
  });

  afterAll(async () => {
    await prisma.curriculum.deleteMany({ where: { code: { startsWith: prefix } } });
    await prisma.user.deleteMany({ where: { id: ownerId } });
    await prisma.course.deleteMany({ where: { id: { in: courseIds } } });
    await prisma.$disconnect();
  });

  it('keeps unknown totals and source provenance nullable without assigning a GPA path', async () => {
    expect(await prisma.curriculum.findUniqueOrThrow({ where: { id: firstId } })).toMatchObject({
      totalCredits: null,
      sourceLabel: null,
      sourceUrl: null,
      isGpaPath: false,
    });
    const placement = await prisma.curriculumPlacement.create({
      data: { curriculumCourseId: membershipA, sourceOrder: 0 },
    });
    expect(placement).toMatchObject({
      academicYear: null,
      academicSemester: null,
      electiveGroup: null,
      electiveSelectCount: null,
      sourceLabel: null,
    });
  });

  it('rejects duplicate curriculum codes without changing the existing curriculum', async () => {
    const original = await prisma.curriculum.findUniqueOrThrow({ where: { id: firstId } });
    await expect(prisma.curriculum.create({ data: curriculumData('first') })).rejects.toMatchObject(
      { code: 'P2002' },
    );
    expect(await prisma.curriculum.findUniqueOrThrow({ where: { id: firstId } })).toEqual(original);
  });

  it('allows one global course in two curricula but rejects duplicate membership within one', async () => {
    await expect(
      prisma.curriculumCourse.create({ data: { curriculumId: firstId, courseId: courseA } }),
    ).rejects.toMatchObject({ code: 'P2002' });
    const memberships = await prisma.curriculumCourse.findMany({ where: { courseId: courseA } });
    expect(memberships).toHaveLength(2);
    expect(memberships.map(({ curriculumId }) => curriculumId).sort()).toEqual(
      [firstId, secondId].sort(),
    );
    expect(await prisma.course.count({ where: { id: courseA } })).toBe(1);
  });

  it('preserves repeated elective appearances and their explicit source order', async () => {
    await prisma.curriculumPlacement.createMany({
      data: [
        {
          curriculumCourseId: membershipA,
          sourceOrder: 20,
          academicYear: 4,
          academicSemester: 2,
          electiveGroup: 'Elective Group 3',
          electiveSelectCount: 2,
          sourceLabel: 'Signed source row 20',
        },
        {
          curriculumCourseId: membershipA,
          sourceOrder: 10,
          academicYear: 3,
          academicSemester: 2,
          electiveGroup: 'Elective Group 2',
          electiveSelectCount: 1,
          sourceLabel: 'Signed source row 10',
        },
      ],
    });
    const placements = await prisma.curriculumPlacement.findMany({
      where: { curriculumCourseId: membershipA },
      orderBy: { sourceOrder: 'asc' },
    });
    expect(placements).toMatchObject([
      {
        sourceOrder: 10,
        academicYear: 3,
        academicSemester: 2,
        electiveGroup: 'Elective Group 2',
        electiveSelectCount: 1,
        sourceLabel: 'Signed source row 10',
      },
      {
        sourceOrder: 20,
        academicYear: 4,
        academicSemester: 2,
        electiveGroup: 'Elective Group 3',
        electiveSelectCount: 2,
        sourceLabel: 'Signed source row 20',
      },
    ]);
    expect(await prisma.curriculumCourse.count({ where: { id: membershipA } })).toBe(1);
  });

  it('rejects duplicate source order for one membership while allowing it for another', async () => {
    await prisma.curriculumPlacement.create({
      data: { curriculumCourseId: membershipA, sourceOrder: 0, electiveGroup: 'Group 2' },
    });
    await expect(
      prisma.curriculumPlacement.create({
        data: { curriculumCourseId: membershipA, sourceOrder: 0, electiveGroup: 'Group 3' },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
    await prisma.curriculumPlacement.create({
      data: { curriculumCourseId: membershipB, sourceOrder: 0 },
    });
    expect(
      await prisma.curriculumPlacement.count({
        where: { curriculumCourseId: { in: [membershipA, membershipB] } },
      }),
    ).toBe(2);
  });

  it('requires both prerequisite endpoints to belong to the specified curriculum', async () => {
    await prisma.curriculumCourse.delete({ where: { id: membershipA } });
    await expect(
      prisma.curriculumPrerequisite.create({
        data: { curriculumId: firstId, courseId: courseA, prerequisiteId: courseB },
      }),
    ).rejects.toMatchObject({ code: 'P2003' });
    await expect(
      prisma.curriculumPrerequisite.create({
        data: { curriculumId: firstId, courseId: courseB, prerequisiteId: courseA },
      }),
    ).rejects.toMatchObject({ code: 'P2003' });
    expect(
      await prisma.curriculumCourse.count({
        where: { curriculumId: secondId, courseId: courseA },
      }),
    ).toBe(1);
    expect(await prisma.curriculumPrerequisite.count({ where: { curriculumId: firstId } })).toBe(0);
  });

  it('keeps prerequisite sets and provenance flags separate for shared global courses', async () => {
    const first = await prisma.curriculumPrerequisite.create({
      data: { curriculumId: firstId, courseId: courseA, prerequisiteId: courseB },
    });
    const second = await prisma.curriculumPrerequisite.create({
      data: {
        curriculumId: secondId,
        courseId: courseA,
        prerequisiteId: courseB,
        isCorequisite: true,
        isStrict: false,
      },
    });
    const additional = await prisma.curriculumPrerequisite.create({
      data: { curriculumId: secondId, courseId: courseA, prerequisiteId: courseC },
    });
    await expect(
      prisma.curriculumPrerequisite.create({
        data: { curriculumId: firstId, courseId: courseA, prerequisiteId: courseB },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
    expect(first).toMatchObject({ isStrict: true, isCorequisite: false });
    expect(second).toMatchObject({ isStrict: false, isCorequisite: true });
    expect(
      await prisma.curriculumPrerequisite.findMany({ where: { curriculumId: firstId } }),
    ).toEqual([first]);
    expect(
      await prisma.curriculumPrerequisite.findMany({ where: { curriculumId: secondId } }),
    ).toEqual(expect.arrayContaining([second, additional]));
    expect(await prisma.prerequisite.count({ where: { courseId: courseA } })).toBe(0);
  });

  it('leaves users unassigned by default and clears assignment when its curriculum is deleted', async () => {
    expect(await prisma.user.findUniqueOrThrow({ where: { id: ownerId } })).toMatchObject({
      curriculumId: null,
    });
    await prisma.user.update({ where: { id: ownerId }, data: { curriculumId: firstId } });
    await prisma.curriculum.delete({ where: { id: firstId } });
    expect(await prisma.user.findUniqueOrThrow({ where: { id: ownerId } })).toMatchObject({
      curriculumId: null,
      studentId: prefix,
    });
  });

  it('cascades curriculum rows while preserving global courses, votes, progress and grades', async () => {
    await prisma.curriculumPlacement.createMany({
      data: [membershipA, membershipB].map((curriculumCourseId) => ({
        curriculumCourseId,
        sourceOrder: 0,
      })),
    });
    await prisma.curriculumPrerequisite.create({
      data: { curriculumId: firstId, courseId: courseA, prerequisiteId: courseB },
    });
    const otherEdge = await prisma.curriculumPrerequisite.create({
      data: { curriculumId: secondId, courseId: courseA, prerequisiteId: courseC },
    });
    const progress = await prisma.studentRecord.create({
      data: {
        userId: ownerId,
        courseId: courseA,
        electiveGroup: 'Elective Group 2',
        grade: 'B+',
        gradePoints: 3.5,
      },
    });
    const attempt = await prisma.gradeAttempt.create({
      data: { userId: ownerId, courseId: courseA, requestId: randomUUID(), score: 85 },
    });
    const rating = await prisma.courseRating.create({
      data: { userId: ownerId, courseId: courseA, rating: 4 },
    });
    const course = await prisma.course.findUniqueOrThrow({ where: { id: courseA } });
    await prisma.curriculum.delete({ where: { id: firstId } });
    expect(await prisma.curriculumCourse.count({ where: { curriculumId: firstId } })).toBe(0);
    expect(await prisma.curriculumPrerequisite.count({ where: { curriculumId: firstId } })).toBe(0);
    expect(
      await prisma.curriculumPlacement.count({
        where: { curriculumCourseId: { in: [membershipA, membershipB] } },
      }),
    ).toBe(0);
    expect(await prisma.course.findUniqueOrThrow({ where: { id: courseA } })).toEqual(course);
    expect(await prisma.studentRecord.findUniqueOrThrow({ where: { id: progress.id } })).toEqual(
      progress,
    );
    expect(await prisma.gradeAttempt.findUniqueOrThrow({ where: { id: attempt.id } })).toEqual(
      attempt,
    );
    expect(await prisma.courseRating.findUniqueOrThrow({ where: { id: rating.id } })).toEqual(
      rating,
    );
    expect(
      await prisma.curriculumPrerequisite.findUniqueOrThrow({ where: { id: otherEdge.id } }),
    ).toEqual(otherEdge);
  });

  it('enforces integer domains in PostgreSQL while allowing nullable and boundary values', async () => {
    await prisma.curriculum.update({ where: { id: firstId }, data: { totalCredits: 0 } });
    await expect(prisma.$executeRaw`
      UPDATE "curriculums" SET "total_credits" = -1 WHERE "id" = ${firstId}
    `).rejects.toMatchObject({ code: 'P2010', meta: { code: '23514' } });
    await prisma.curriculumPlacement.create({
      data: {
        curriculumCourseId: membershipA,
        academicYear: 1,
        academicSemester: 3,
        electiveSelectCount: 1,
        sourceOrder: 0,
      },
    });
    const invalid = [
      { year: 0, semester: null, selectCount: null, sourceOrder: 1 },
      { year: -1, semester: null, selectCount: null, sourceOrder: 1 },
      { year: null, semester: 0, selectCount: null, sourceOrder: 1 },
      { year: null, semester: 4, selectCount: null, sourceOrder: 1 },
      { year: null, semester: null, selectCount: 0, sourceOrder: 1 },
      { year: null, semester: null, selectCount: -1, sourceOrder: 1 },
      { year: null, semester: null, selectCount: null, sourceOrder: -1 },
    ];
    for (const { year, semester, selectCount, sourceOrder } of invalid) {
      await expect(prisma.$executeRaw`
        INSERT INTO "curriculum_placements"
          ("id", "curriculum_course_id", "academic_year", "academic_semester", "elective_select_count", "source_order")
        VALUES (${randomUUID()}, ${membershipA}, ${year}, ${semester}, ${selectCount}, ${sourceOrder})
      `).rejects.toMatchObject({ code: 'P2010', meta: { code: '23514' } });
    }
    expect(
      await prisma.curriculumPlacement.count({ where: { curriculumCourseId: membershipA } }),
    ).toBe(1);
    expect(await prisma.curriculum.findUniqueOrThrow({ where: { id: firstId } })).toMatchObject({
      totalCredits: 0,
    });
  });
});
