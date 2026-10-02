import { randomUUID } from 'crypto';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import app, { prisma } from '../index';
import config from '../config';
import { AUTH_COOKIE_NAME, AUTH_TOKEN_OPTIONS, issueToken } from '../services/authService';

describe('legacy student read access (PostgreSQL)', () => {
  const prefix = `read-access-${randomUUID()}`;
  const ownerId = randomUUID();
  const otherId = randomUUID();
  const adminId = randomUUID();
  const aliasId = randomUUID();
  const courseId = randomUUID();
  const planId = randomUUID();
  const semesterId = randomUUID();
  const ownerStudentId = `${prefix}-owner`;
  const cookie = (id: string) => `${AUTH_COOKIE_NAME}=${issueToken(id)}`;
  const read = (path: string, userId = ownerId) =>
    request(app).get(path).set('Cookie', cookie(userId));
  const userEndpoints = ['', '/records', '/progress'] as const;
  const privatePaths = [
    '/api/users',
    `/api/users/${ownerId}`,
    `/api/users/${ownerId}/records`,
    `/api/users/${ownerId}/progress`,
    `/api/study-plans/user/${ownerId}`,
    `/api/study-plans/${planId}`,
    `/api/recommendations/user/${ownerId}`,
  ];

  beforeAll(async () => {
    await prisma.user.createMany({
      data: [
        { id: ownerId, studentId: ownerStudentId, role: 'STUDENT' },
        { id: otherId, studentId: `${prefix}-other`, role: 'STUDENT' },
        { id: adminId, studentId: `${prefix}-admin`, role: 'ADMIN' },
        // A chosen student ID must never override resolution of a real database UUID.
        { id: aliasId, studentId: ownerId, role: 'STUDENT' },
      ].map(({ id, studentId, role }) => ({
        id,
        studentId,
        role: role as 'STUDENT' | 'ADMIN',
        name: 'Read access test',
        email: `${prefix}-${id}@example.test`,
        password: 'legacy-secret',
        passwordHash: 'hash-must-stay-private',
      })),
    });
    await prisma.course.create({
      data: {
        id: courseId,
        code: `${prefix}-course`,
        name: 'Read test',
        credits: 3,
        difficultyLevel: 2,
      },
    });
    await prisma.studentRecord.create({
      data: { userId: ownerId, courseId, status: 'COMPLETED', grade: 'A', gradePoints: 4 },
    });
    await prisma.studyPlan.create({
      data: {
        id: planId,
        userId: ownerId,
        name: 'Private plan',
        semesters: {
          create: {
            id: semesterId,
            semester: 'FALL',
            year: 2026,
            courses: [{ courseId, position: 0 }],
          },
        },
      },
    });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: [ownerId, otherId, adminId, aliasId] } } });
    await prisma.course.deleteMany({ where: { id: courseId } });
    await prisma.$disconnect();
  });

  it.each(privatePaths)('requires a valid cookie session for GET %s', async (path) => {
    const expired = jwt.sign({}, config.jwtSecret, {
      ...AUTH_TOKEN_OPTIONS,
      subject: ownerId,
      expiresIn: -1,
    });
    for (const session of [undefined, 'malformed', expired]) {
      const pending = request(app).get(path);
      if (session) pending.set('Cookie', `${AUTH_COOKIE_NAME}=${session}`);
      const response = await pending;
      expect(response.status).toBe(401);
      expect(response.body).toEqual({ success: false, error: 'Authentication required' });
    }
  });

  it('restricts the student directory to the current admin role without exposing passwords', async () => {
    expect((await read('/api/users')).status).toBe(403);
    const allowed = await read('/api/users', adminId);
    expect(allowed.status).toBe(200);
    expect(allowed.body.data).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: ownerId })]),
    );
    for (const user of allowed.body.data) {
      expect(user).not.toHaveProperty('password');
      expect(user).not.toHaveProperty('passwordHash');
    }
    await prisma.user.update({ where: { id: adminId }, data: { role: 'STUDENT' } });
    expect((await read('/api/users', adminId)).status).toBe(403);
    await prisma.user.update({ where: { id: adminId }, data: { role: 'ADMIN' } });
  });

  it.each(userEndpoints)(
    'allows owner/admin but rejects another student for GET /users/:id%s',
    async (suffix) => {
      for (const identifier of [ownerId, ownerStudentId]) {
        const path = `/api/users/${identifier}${suffix}`;
        const own = await read(path);
        expect(own.status).toBe(200);
        expect((await read(path, adminId)).status).toBe(200);
        const denied = await read(path, otherId);
        expect(denied.status).toBe(403);
        expect(denied.body).toEqual({ success: false, error: 'Access forbidden' });
        if (suffix === '') {
          expect(own.body.data).toMatchObject({ id: ownerId, studentId: ownerStudentId });
          expect(own.body.data).not.toHaveProperty('password');
          expect(own.body.data).not.toHaveProperty('passwordHash');
          expect(own.body.data.studentRecords).toEqual([
            expect.objectContaining({ courseId, grade: 'A' }),
          ]);
        } else if (suffix === '/records') {
          expect(own.body.data).toEqual([
            expect.objectContaining({ userId: ownerId, courseId, grade: 'A' }),
          ]);
        } else {
          expect(own.body.data.completed).toEqual([
            expect.objectContaining({ userId: ownerId, courseId }),
          ]);
        }
      }
    },
  );

  it.each(userEndpoints)(
    'does not alias a UUID-shaped student ID for GET /users/:id%s',
    async (suffix) => {
      const denied = await read(`/api/users/${ownerId}${suffix}`, aliasId);
      expect(denied.status).toBe(403);
      expect(denied.body).not.toHaveProperty('data');
      const own = await read(`/api/users/${aliasId}${suffix}`, aliasId);
      expect(own.status).toBe(200);
      if (suffix === '') expect(own.body.data.id).toBe(aliasId);
      else if (suffix === '/records') expect(own.body.data).toEqual([]);
      else expect(own.body.data.completed).toEqual([]);
    },
  );

  it('limits plan collections to owner UUID or admin access and keeps semesters intact', async () => {
    const path = `/api/study-plans/user/${ownerId}`;
    for (const userId of [ownerId, adminId]) {
      const allowed = await read(path, userId);
      expect(allowed.status).toBe(200);
      expect(allowed.body.data).toEqual([
        expect.objectContaining({
          id: planId,
          userId: ownerId,
          semesters: [expect.objectContaining({ id: semesterId })],
        }),
      ]);
    }
    for (const userId of [otherId, aliasId]) {
      const denied = await read(path, userId);
      expect(denied.status).toBe(403);
      expect(denied.body).not.toHaveProperty('data');
    }
    expect((await read(`/api/study-plans/user/${ownerStudentId}`)).status).toBe(403);
    expect((await read(`/api/study-plans/user/${aliasId}`, aliasId)).body.data).toEqual([]);
  });

  it('protects individual plans and preserves authenticated missing-plan behavior', async () => {
    const path = `/api/study-plans/${planId}`;
    for (const userId of [ownerId, adminId]) {
      const allowed = await read(path, userId);
      expect(allowed.status).toBe(200);
      expect(allowed.body.data).toMatchObject({
        id: planId,
        userId: ownerId,
        user: { id: ownerId },
      });
    }
    expect((await read(path, otherId)).status).toBe(403);
    expect((await read(path, aliasId)).status).toBe(403);
    const missingPath = `/api/study-plans/${randomUUID()}`;
    expect((await read(missingPath)).status).toBe(404);
    expect((await request(app).get(missingPath)).status).toBe(401);
  });

  it('protects personalized recommendations using owner UUID or admin access', async () => {
    const path = `/api/recommendations/user/${ownerId}`;
    for (const userId of [ownerId, adminId]) {
      const allowed = await read(path, userId);
      expect(allowed.status).toBe(200);
      expect(allowed.body.success).toBe(true);
      expect(allowed.body.data).toHaveProperty('courses');
      expect(allowed.body.data).toHaveProperty('stats');
    }
    for (const userId of [otherId, aliasId]) {
      const denied = await read(path, userId);
      expect(denied.status).toBe(403);
      expect(denied.body).not.toHaveProperty('data');
    }
    expect((await read(`/api/recommendations/user/${ownerStudentId}`)).status).toBe(403);
  });
});
