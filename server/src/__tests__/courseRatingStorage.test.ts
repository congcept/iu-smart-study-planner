import { randomUUID } from 'crypto';
import { prisma } from '../db';

describe('course-rating storage and cache (PostgreSQL)', () => {
  const prefix = `rating-storage-${randomUUID()}`;
  const users = Array.from({ length: 8 }, () => randomUUID());
  const courses = [randomUUID(), randomUUID()];
  const vote = (rating: number, userId = users[0], courseId = courses[0]) =>
    prisma.courseRating.create({ data: { userId, courseId, rating } });
  const cache = (id = courses[0]) =>
    prisma.course.findUniqueOrThrow({
      where: { id },
      select: { avgRating: true, ratingCount: true, difficultyLevel: true },
    });
  const upsert = (rating: number, userId = users[0]) =>
    prisma.courseRating.upsert({
      where: { userId_courseId: { userId, courseId: courses[0] } },
      create: { userId, courseId: courses[0], rating },
      update: { rating },
    });
  beforeAll(async () => {
    await prisma.user.createMany({
      data: users.map((id) => ({
        id,
        studentId: `${prefix}-${id}`,
        email: `${id}@example.test`,
        name: 'Rating storage test',
      })),
    });
    await prisma.course.createMany({
      data: courses.map((id) => ({
        id,
        code: `${prefix}-${id}`,
        name: 'Rating test course',
        credits: 3,
        difficultyLevel: 2,
      })),
    });
  });
  beforeEach(async () => {
    await prisma.courseRating.deleteMany({ where: { courseId: { in: courses } } });
  });
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { studentId: { startsWith: prefix } } });
    await prisma.course.deleteMany({ where: { id: { in: courses } } });
    await prisma.$disconnect();
  });
  it('starts with no votes while preserving the existing seed difficulty', async () => {
    expect(await cache()).toEqual({ avgRating: null, ratingCount: 0, difficultyLevel: 2 });
  });
  it.each([1, 5])('accepts boundary rating%s and updates both cache values', async (rating) => {
    const row = await vote(rating);
    expect(row.rating).toBe(rating);
    expect(await cache()).toEqual({ avgRating: rating, ratingCount: 1, difficultyLevel: 2 });
  });
  it.each([0, 6, -1])('rejects out-of-range rating%s at the database boundary', async (rating) => {
    await expect(vote(rating)).rejects.toThrow('course_ratings_rating_check');
    expect(await cache()).toMatchObject({ avgRating: null, ratingCount: 0 });
  });
  it('enforces one vote per account and course', async () => {
    await vote(2);
    await expect(vote(5)).rejects.toMatchObject({ code: 'P2002' });
    expect(await cache()).toMatchObject({ avgRating: 2, ratingCount: 1 });
  });
  it('allows the same account to rate different courses independently', async () => {
    await vote(2);
    await vote(5, users[0], courses[1]);
    expect(await cache()).toMatchObject({ avgRating: 2, ratingCount: 1 });
    expect(await cache(courses[1])).toMatchObject({ avgRating: 5, ratingCount: 1 });
  });
  it('replaces a vote without increasing the count or losing its creation date', async () => {
    const first = await upsert(2);
    const updated = await upsert(5);
    expect(updated.id).toBe(first.id);
    expect(updated.createdAt).toEqual(first.createdAt);
    expect(await cache()).toMatchObject({ avgRating: 5, ratingCount: 1 });
  });
  it('keeps averages unrounded for mixed votes', async () => {
    await vote(1);
    await vote(4, users[1]);
    await vote(5, users[2]);
    expect((await cache()).avgRating).toBeCloseTo(10 / 3, 14);
    expect((await cache()).ratingCount).toBe(3);
  });
  it('recomputes the cache when a vote is deleted, including the last vote', async () => {
    const first = await vote(1);
    const second = await vote(5, users[1]);
    await prisma.courseRating.delete({ where: { id: first.id } });
    expect(await cache()).toMatchObject({ avgRating: 5, ratingCount: 1 });
    await prisma.courseRating.delete({ where: { id: second.id } });
    expect(await cache()).toMatchObject({ avgRating: null, ratingCount: 0 });
  });
  it('rolls vote and cache changes back together', async () => {
    await vote(2);
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.courseRating.update({
          where: { userId_courseId: { userId: users[0], courseId: courses[0] } },
          data: { rating: 5 },
        });
        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');
    expect(await cache()).toMatchObject({ avgRating: 2, ratingCount: 1 });
  });
  it('keeps concurrent votes and the cached aggregate consistent', async () => {
    const ratings = [1, 2, 3, 4, 5, 1, 2, 5];
    const writes = await Promise.allSettled(
      users.map((userId, index) => vote(ratings[index], userId)),
    );
    expect(writes.every((result) => result.status === 'fulfilled')).toBe(true);
    expect(await cache()).toMatchObject({ avgRating: 23 / 8, ratingCount: 8 });
    const aggregate = await prisma.courseRating.aggregate({
      where: { courseId: courses[0] },
      _avg: { rating: true },
      _count: true,
    });
    expect((await cache()).avgRating).toBe(aggregate._avg.rating);
  });
  it('serializes competing updates while retaining one row', async () => {
    await upsert(1);
    await Promise.all([upsert(2), upsert(4), upsert(5)]);
    const row = await prisma.courseRating.findUniqueOrThrow({
      where: { userId_courseId: { userId: users[0], courseId: courses[0] } },
    });
    expect(await cache()).toMatchObject({ avgRating: row.rating, ratingCount: 1 });
  });
  it('refreshes both course caches when a vote is moved at the database boundary', async () => {
    const row = await vote(4);
    await prisma.courseRating.update({ where: { id: row.id }, data: { courseId: courses[1] } });
    expect(await cache()).toMatchObject({ avgRating: null, ratingCount: 0 });
    expect(await cache(courses[1])).toMatchObject({ avgRating: 4, ratingCount: 1 });
  });
  it('preserves progress and legacy grades when a vote is added', async () => {
    const record = await prisma.studentRecord.create({
      data: {
        userId: users[0],
        courseId: courses[0],
        status: 'COMPLETED',
        grade: 'B+',
        gradePoints: 3.5,
        electiveGroup: 'Original claim',
      },
    });
    try {
      await vote(3);
      expect(await prisma.studentRecord.findUniqueOrThrow({ where: { id: record.id } })).toEqual(
        record,
      );
    } finally {
      await prisma.studentRecord.delete({ where: { id: record.id } });
    }
  });
  it('keeps a historical vote if completion is subsequently removed', async () => {
    const record = await prisma.studentRecord.create({
      data: { userId: users[0], courseId: courses[0], status: 'COMPLETED' },
    });
    await vote(3);
    await prisma.studentRecord.delete({ where: { id: record.id } });
    expect(await cache()).toMatchObject({ avgRating: 3, ratingCount: 1 });
  });
  it('removes votes and refreshes the surviving course cache when an account is deleted', async () => {
    const id = randomUUID();
    await prisma.user.create({
      data: {
        id,
        studentId: `${prefix}-${id}`,
        name: 'Disposable test',
        email: `${id}@example.test`,
      },
    });
    try {
      await vote(1);
      await vote(5, id);
      await prisma.user.delete({ where: { id } });
      expect(await cache()).toMatchObject({ avgRating: 1, ratingCount: 1 });
    } finally {
      await prisma.user.deleteMany({ where: { id } });
    }
  });
  it('removes votes when their course is deleted', async () => {
    const id = randomUUID();
    await prisma.course.create({
      data: {
        id,
        code: `${prefix}-${id}`,
        name: 'Disposable course',
        credits: 3,
        difficultyLevel: 2,
      },
    });
    try {
      await vote(5, users[0], id);
      await prisma.course.delete({ where: { id } });
      expect(await prisma.courseRating.count({ where: { courseId: id } })).toBe(0);
    } finally {
      await prisma.course.deleteMany({ where: { id } });
    }
  });
  it('rejects dangling account and course references', async () => {
    await expect(vote(3, randomUUID())).rejects.toMatchObject({ code: 'P2003' });
    await expect(vote(3, users[0], randomUUID())).rejects.toMatchObject({ code: 'P2003' });
  });
});
