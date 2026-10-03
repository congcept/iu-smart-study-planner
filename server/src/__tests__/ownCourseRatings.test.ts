import { randomUUID } from 'crypto';
import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { prisma } from '../db';
import router from '../routes/users';
import { AUTH_COOKIE_NAME, issueToken } from '../services/authService';

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use('/api/users', router);

describe('own course ratings (PostgreSQL)', () => {
  const prefix = `own-ratings-${randomUUID()}`;
  const users = [randomUUID(), randomUUID(), randomUUID()];
  const courses = [randomUUID(), randomUUID()];
  const get = (userId: string, query = '') =>
    request(app)
      .get(`/api/users/me/ratings${query}`)
      .set('Cookie', `${AUTH_COOKIE_NAME}=${issueToken(userId)}`);
  beforeAll(async () => {
    await prisma.user.createMany({
      data: users.map((id, index) => ({
        id,
        studentId: `${prefix}-${index}`,
        email: `${id}@example.test`,
        name: 'Own rating test',
        role: index === 2 ? 'ADMIN' : 'STUDENT',
      })),
    });
    await prisma.course.createMany({
      data: courses.map((id) => ({
        id,
        code: `${prefix}-${id}`,
        name: 'Rating course',
        credits: 3,
        difficultyLevel: 2,
      })),
    });
    await prisma.courseRating.createMany({
      data: [
        { userId: users[0], courseId: courses[0], rating: 2 },
        { userId: users[1], courseId: courses[0], rating: 5 },
        { userId: users[1], courseId: courses[1], rating: 4 },
      ],
    });
  });
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: users } } });
    await prisma.course.deleteMany({ where: { id: { in: courses } } });
    await prisma.$disconnect();
  });
  it('requires a cookie session', async () => {
    expect((await request(app).get('/api/users/me/ratings')).status).toBe(401);
  });
  it('returns only the current account votes without identity metadata', async () => {
    const result = await get(users[0]);
    expect(result.status).toBe(200);
    expect(result.body.data).toEqual([{ courseId: courses[0], rating: 2 }]);
  });
  it('ignores attempts to select another account in query parameters', async () => {
    const result = await get(users[0], `?userId=${users[1]}`);
    expect(result.body.data).toEqual([{ courseId: courses[0], rating: 2 }]);
  });
  it('keeps votes readable after uncompletion, without enabling a new vote', async () => {
    expect(await prisma.studentRecord.count({ where: { userId: users[0] } })).toBe(0);
    expect((await get(users[0])).body.data).toEqual([{ courseId: courses[0], rating: 2 }]);
  });
  it('returns an empty list for an admin without their own votes', async () => {
    expect((await get(users[2])).body.data).toEqual([]);
  });
  it('does not grant a session for an unknown account', async () => {
    expect((await get(randomUUID())).status).toBe(401);
  });
});
