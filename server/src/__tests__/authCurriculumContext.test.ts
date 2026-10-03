import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import app, { prisma } from '../index';
import config from '../config';
import { AUTH_COOKIE_NAME, hashPassword, issueToken } from '../services/authService';
import { DEMO_ACCOUNTS } from '../services/demoAuthService';

describe('stored curriculum metadata in cookie auth replies (PostgreSQL)', () => {
  const prefix = `auth-context-${randomUUID()}`;
  const password = 'simulated-context-password';
  const contexts = [randomUUID(), randomUUID()];
  const users = [randomUUID(), randomUUID()];
  const createdUserIds: string[] = [];
  const createdDemoIds: string[] = [];
  const createdContextIds: string[] = [];
  const originalEnvironment = config.nodeEnv;
  const originalDemoEnabled = config.demoLoginEnabled;
  let registrationSequence = 0;
  const me = (token: string) =>
    request(app).get('/api/auth/me').set('Cookie', `${AUTH_COOKIE_NAME}=${token}`);
  const profile = () => {
    registrationSequence++;
    return {
      studentId: `${prefix}-registration-${registrationSequence}`,
      name: 'Simulated registration student',
      email: `${prefix}-registration-${registrationSequence}@example.test`,
      password,
    };
  };

  beforeAll(async () => {
    await prisma.curriculum.createMany({
      data: contexts.map((id, index) => ({
        id,
        code: `${prefix}-${index}`,
        name: 'Simulated auth reference context',
        school: 'CSE',
        degree: 'Bachelor',
        programUrl: 'https://example.test/auth-context',
      })),
    });
    const passwordHash = await hashPassword(password);
    await prisma.user.createMany({
      data: users.map((id, index) => ({
        id,
        studentId: `${prefix}-fixture-${index}`,
        email: `${id}@example.test`,
        name: 'Simulated auth context student',
        password: 'private-legacy-password',
        passwordHash,
        curriculumId: contexts[index],
      })),
    });
  });

  beforeEach(async () => {
    await prisma.user.update({
      where: { id: users[0] },
      data: { curriculumId: contexts[0], role: 'STUDENT' },
    });
  });

  afterEach(() => {
    config.nodeEnv = originalEnvironment;
    config.demoLoginEnabled = originalDemoEnabled;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({
      where: { id: { in: [...users, ...createdUserIds, ...createdDemoIds] } },
    });
    await prisma.curriculum.deleteMany({
      where: { id: { in: [...contexts, ...createdContextIds] } },
    });
    await prisma.$disconnect();
  });

  it('returns an explicit null context at registration without creating an assignment', async () => {
    const body = profile();
    const agent = request.agent(app);
    const response = await agent.post('/api/auth/register').send(body);
    expect(response.status).toBe(201);
    createdUserIds.push(response.body.data.user.id);
    expect(response.body.data.user).toMatchObject({
      studentId: body.studentId,
      role: 'STUDENT',
      curriculumId: null,
    });
    expect(response.body.data.user).not.toHaveProperty('password');
    expect(response.body.data.user).not.toHaveProperty('passwordHash');
    expect(response.body.data).not.toHaveProperty('token');
    const stored = await prisma.user.findUniqueOrThrow({
      where: { id: response.body.data.user.id },
    });
    expect(stored.curriculumId).toBeNull();
    const session = await agent.get('/api/auth/me');
    expect(session.status).toBe(200);
    expect(session.body.data.user).toEqual(response.body.data.user);
  });

  it('rejects curriculum injection into registration and login inputs', async () => {
    const body = profile();
    const response = await request(app)
      .post('/api/auth/register')
      .send({ ...body, curriculumId: contexts[1] });
    expect(response.status).toBe(400);
    expect(response.headers['set-cookie']).toBeUndefined();
    expect(await prisma.user.count({ where: { studentId: body.studentId } })).toBe(0);
    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: `${users[0]}@example.test`, password, curriculumId: contexts[1] });
    expect(login.status).toBe(400);
    expect(login.headers['set-cookie']).toBeUndefined();
    expect((await prisma.user.findUniqueOrThrow({ where: { id: users[0] } })).curriculumId).toBe(
      contexts[0],
    );
  });

  it('includes only stored context metadata in assigned login and excludes private password fields', async () => {
    const agent = request.agent(app);
    const response = await agent.post('/api/auth/login').send({
      email: ` ${users[0].toUpperCase()}@EXAMPLE.TEST `,
      password,
    });
    expect(response.status).toBe(200);
    expect(response.body.data.user).toMatchObject({ id: users[0], curriculumId: contexts[0] });
    expect(Object.keys(response.body.data.user).sort()).toEqual([
      'curriculumId',
      'email',
      'id',
      'name',
      'role',
      'studentId',
    ]);
    expect(JSON.stringify(response.body)).not.toContain('private-legacy-password');
    expect(JSON.stringify(response.body)).not.toContain(password);
    expect((await agent.get('/api/auth/me')).body.data.user).toEqual(response.body.data.user);
    await prisma.user.update({ where: { id: users[0] }, data: { curriculumId: null } });
    const unassigned = await request(app)
      .post('/api/auth/login')
      .send({
        email: `${users[0]}@example.test`,
        password,
      });
    expect(unassigned.status).toBe(200);
    expect(unassigned.body.data.user.curriculumId).toBeNull();
  });

  it('refreshes assigned and null context from the database using the same subject-only token', async () => {
    const token = issueToken(users[0]);
    const payload = jwt.decode(token);
    expect(payload).toMatchObject({ sub: users[0] });
    expect(payload).not.toHaveProperty('curriculumId');
    expect(payload).not.toHaveProperty('role');
    expect((await me(token)).body.data.user.curriculumId).toBe(contexts[0]);
    await prisma.user.update({ where: { id: users[0] }, data: { curriculumId: contexts[1] } });
    const changed = await me(token);
    expect(changed.status).toBe(200);
    expect(changed.body.data.user.curriculumId).toBe(contexts[1]);
    await prisma.user.update({ where: { id: users[0] }, data: { curriculumId: null } });
    const unassigned = await me(token);
    expect(unassigned.status).toBe(200);
    expect(unassigned.body.data.user).toMatchObject({ id: users[0], curriculumId: null });
  });

  it('reports null metadata after deletion sets a fixture context assignment to null', async () => {
    const curriculumId = randomUUID();
    createdContextIds.push(curriculumId);
    await prisma.curriculum.create({
      data: {
        id: curriculumId,
        code: `${prefix}-deleted`,
        name: 'Disposable auth fixture context',
        school: 'CSE',
        degree: 'Bachelor',
        programUrl: 'https://example.test/deleted-context',
      },
    });
    await prisma.user.update({ where: { id: users[0] }, data: { curriculumId } });
    const token = issueToken(users[0]);
    expect((await me(token)).body.data.user.curriculumId).toBe(curriculumId);
    await prisma.curriculum.delete({ where: { id: curriculumId } });
    const response = await me(token);
    expect(response.status).toBe(200);
    expect(response.body.data.user).toMatchObject({ id: users[0], curriculumId: null });
  });

  it('keeps current role and context attached to the authenticated owner rather than another session', async () => {
    const token = issueToken(users[0]);
    const otherToken = issueToken(users[1]);
    await prisma.user.update({ where: { id: users[0] }, data: { role: 'ADMIN' } });
    expect((await me(token)).body.data.user).toMatchObject({
      id: users[0],
      role: 'ADMIN',
      curriculumId: contexts[0],
    });
    expect((await me(otherToken)).body.data.user).toMatchObject({
      id: users[1],
      role: 'STUDENT',
      curriculumId: contexts[1],
    });
    await prisma.user.update({ where: { id: users[0] }, data: { role: 'STUDENT' } });
    const response = await me(token);
    expect(response.body.data.user.role).toBe('STUDENT');
    expect(JSON.stringify(response.body)).not.toContain(users[1]);
    expect(
      (await request(app).get('/api/users').set('Cookie', `${AUTH_COOKIE_NAME}=${token}`)).status,
    ).toBe(403);
  });

  it('returns no curriculum metadata for invalid, absent or deleted-account cookies', async () => {
    const deletedId = randomUUID();
    createdUserIds.push(deletedId);
    await prisma.user.create({
      data: {
        id: deletedId,
        studentId: `${prefix}-deleted-account`,
        name: 'Disposable session fixture',
        email: `${deletedId}@example.test`,
        curriculumId: contexts[0],
      },
    });
    const deletedToken = issueToken(deletedId);
    await prisma.user.delete({ where: { id: deletedId } });
    for (const token of ['invalid', deletedToken]) {
      const response = await me(token);
      expect(response.status).toBe(401);
      expect(response.body).not.toHaveProperty('data');
    }
    const missing = await request(app).get('/api/auth/me');
    expect(missing.status).toBe(401);
    expect(missing.body).not.toHaveProperty('data');
  });

  it('returns demo context metadata matching stored rows without changing existing identities or assignments', async () => {
    config.nodeEnv = 'development';
    config.demoLoginEnabled = true;
    for (const role of ['STUDENT', 'ADMIN'] as const) {
      const id = DEMO_ACCOUNTS[role].id;
      const before = await prisma.user.findUnique({ where: { id } });
      if (!before) createdDemoIds.push(id);
      const agent = request.agent(app);
      const response = await agent.post('/api/auth/demo').send({ role });
      expect(response.status).toBe(200);
      const stored = await prisma.user.findUniqueOrThrow({ where: { id } });
      expect(response.body.data.user).toEqual({
        ...DEMO_ACCOUNTS[role],
        curriculumId: stored.curriculumId,
      });
      expect((await agent.get('/api/auth/me')).body.data.user).toEqual(response.body.data.user);
      if (before) expect(stored).toEqual(before);
      expect(response.body.data.user).not.toHaveProperty('password');
      expect(response.body.data.user).not.toHaveProperty('passwordHash');
    }
  });
});
