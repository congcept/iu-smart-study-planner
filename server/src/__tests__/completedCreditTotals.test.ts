import { randomUUID } from 'crypto';
import request from 'supertest';
import app, { prisma } from '../index';
import { AUTH_COOKIE_NAME, issueToken } from '../services/authService';

describe('degree credit totals (PostgreSQL)', () => {
  const runId = randomUUID();
  const ownerId = randomUUID();
  const adminId = randomUUID();
  const studentId = `credit-totals-${runId}`;
  const academicCourseId = randomUUID();
  const incompleteCourseId = randomUUID();
  const createdPhysicalIds: string[] = [];
  const physicalCourses: { id: string; code: string; credits: number }[] = [];
  const cookie = (id: string = ownerId) => `${AUTH_COOKIE_NAME}=${issueToken(id)}`;
  const profile = (identifier: string = ownerId, viewer: string = ownerId) =>
    request(app).get(`/api/users/${identifier}`).set('Cookie', cookie(viewer));
  const progress = () => request(app).get(`/api/users/${ownerId}/progress`).set('Cookie', cookie());

  beforeAll(async () => {
    await prisma.user.createMany({
      data: [ownerId, adminId].map((id) => ({
        id,
        studentId: id === ownerId ? studentId : `credit-admin-${runId}`,
        name: 'Credit totals test',
        email: `${id}@example.test`,
        role: id === adminId ? 'ADMIN' : 'STUDENT',
      })),
    });
    await prisma.course.createMany({
      data: [
        {
          id: academicCourseId,
          code: `credit-academic-${runId}`,
          name: 'Academic course',
          credits: 4,
          difficultyLevel: 2,
        },
        {
          id: incompleteCourseId,
          code: `credit-incomplete-${runId}`,
          name: 'Incomplete course',
          credits: 7,
          difficultyLevel: 2,
        },
      ],
    });
    // Reuse seeded PT courses without changing their metadata or existing student records.
    for (const code of ['PT001IU', 'PT002IU']) {
      let course = await prisma.course.findUnique({
        where: { code },
        select: { id: true, code: true, credits: true },
      });
      if (!course) {
        course = await prisma.course.create({
          data: { code, name: code, credits: 3, difficultyLevel: 2 },
          select: { id: true, code: true, credits: true },
        });
        createdPhysicalIds.push(course.id);
      }
      physicalCourses.push(course);
    }
  });
  beforeEach(async () => {
    await prisma.studentRecord.deleteMany({ where: { userId: ownerId } });
    await prisma.studyPlan.deleteMany({ where: { userId: ownerId } });
  });
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: [ownerId, adminId] } } });
    await prisma.course.deleteMany({
      where: { id: { in: [academicCourseId, incompleteCourseId, ...createdPhysicalIds] } },
    });
    await prisma.$disconnect();
  });

  it.each(['UUID', 'student ID', 'administrator'] as const)(
    'excludes both physical-training courses from completed profile credits through %s lookup',
    async (lookup) => {
      await prisma.studentRecord.createMany({
        data: [academicCourseId, ...physicalCourses.map((course) => course.id)].map((courseId) => ({
          userId: ownerId,
          courseId,
          status: 'COMPLETED',
        })),
      });
      await prisma.studentRecord.create({
        data: { userId: ownerId, courseId: incompleteCourseId, status: 'PLANNED' },
      });
      const response = await profile(
        lookup === 'student ID' ? studentId : ownerId,
        lookup === 'administrator' ? adminId : ownerId,
      );
      expect(response.status).toBe(200);
      expect(response.body.data.stats).toMatchObject({
        totalCourses: 4,
        completedCourses: 3,
        totalCredits: 4,
      });
      expect(
        response.body.data.studentRecords.filter(
          (record: { status: string }) => record.status === 'COMPLETED',
        ),
      ).toHaveLength(3);
      expect(
        response.body.data.studentRecords.map((record: { courseId: string }) => record.courseId),
      ).toEqual(expect.arrayContaining(physicalCourses.map((course) => course.id)));
    },
  );

  it('keeps required physical-training completions visible while profile and progress credit totals agree', async () => {
    await prisma.studentRecord.createMany({
      data: physicalCourses.map((course) => ({
        userId: ownerId,
        courseId: course.id,
        status: 'COMPLETED',
      })),
    });
    const user = await profile();
    const summary = await progress();
    expect(user.status).toBe(200);
    expect(summary.status).toBe(200);
    expect(user.body.data.stats).toMatchObject({ completedCourses: 2, totalCredits: 0 });
    expect(summary.body.data.progress).toMatchObject({
      completedCourses: 2,
      completedCredits: 0,
      percentage: 0,
    });
    expect(summary.body.data.completed).toHaveLength(2);
    const courses = await prisma.course.findMany({ select: { code: true, credits: true } });
    const expectedCredits = courses
      .filter((course) => !['PT001IU', 'PT002IU'].includes(course.code))
      .reduce((sum, course) => sum + course.credits, 0);
    expect(summary.body.data.progress.totalCredits).toBe(expectedCredits);
    const ownProgress = await request(app).get('/api/users/me/progress').set('Cookie', cookie());
    expect(Object.keys(ownProgress.body.data.completedIds).sort()).toEqual(
      physicalCourses.map((course) => course.id).sort(),
    );
  });

  it('continues counting physical-training credits in semester plans without adding planned courses to earned credits', async () => {
    await prisma.studentRecord.createMany({
      data: physicalCourses.map((course) => ({
        userId: ownerId,
        courseId: course.id,
        status: 'PLANNED',
      })),
    });
    const plan = await prisma.studyPlan.create({
      data: { userId: ownerId, name: 'PT semester test' },
    });
    const response = await request(app)
      .post(`/api/study-plans/${plan.id}/semesters`)
      .set('Cookie', cookie())
      .send({
        semester: 'FALL',
        year: 2026,
        courses: physicalCourses.map((course, position) => ({ courseId: course.id, position })),
      });
    expect(response.status).toBe(201);
    expect(response.body.data.totalCredits).toBe(
      physicalCourses.reduce((sum, course) => sum + course.credits, 0),
    );
    expect(response.body.data.courses).toHaveLength(2);
    const summary = await progress();
    expect(summary.body.data.planned).toHaveLength(2);
    expect(summary.body.data.progress.completedCredits).toBe(0);
    expect((await profile()).body.data.stats).toMatchObject({
      completedCourses: 0,
      totalCredits: 0,
    });
  });
});
