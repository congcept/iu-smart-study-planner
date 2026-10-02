import { randomUUID } from 'crypto';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import app, { prisma } from '../index';
import config from '../config';
import { AUTH_COOKIE_NAME, AUTH_TOKEN_OPTIONS } from '../services/authService';

describe('cookie authentication and access control (PostgreSQL)', () => {
  const prefix = `auth-test-${randomUUID()}`;
  const password = 'local-test-password';
  const registeredIds: string[] = [];
  let sequence = 0;

  function profile() {
    sequence++;
    return {
      studentId: `${prefix}-${sequence}`,
      name: 'Test Student',
      email: `${prefix}-${sequence}@example.test`,
      password,
    };
  }

  async function register(studentId?: string) {
    const body = profile();
    if (studentId) body.studentId = studentId;
    const agent = request.agent(app);
    const response = await agent.post('/api/auth/register').send(body);
    expect(response.status).toBe(201);
    const userId: string = response.body.data.user.id;
    registeredIds.push(userId);
    return { agent, body, userId, response };
  }

  afterAll(async () => {
    await prisma.user.deleteMany({
      where: { OR: [{ studentId: { startsWith: prefix } }, { id: { in: registeredIds } }] },
    });
    await prisma.$disconnect();
  });

  it('registers a student, hashes the password, and sets only an httpOnly session cookie', async () => {
    const { agent, body, userId, response } = await register();
    expect(response.body.data.user.role).toBe('STUDENT');
    expect(response.body.data).not.toHaveProperty('token');
    expect(response.body.data.user).not.toHaveProperty('passwordHash');
    expect(response.body.data.user).not.toHaveProperty('password');
    const rawCookies: unknown = response.headers['set-cookie'];
    if (!Array.isArray(rawCookies)) throw new Error('Expected a session cookie');
    const cookies = rawCookies.map(String);
    expect(cookies).toHaveLength(1);
    expect(cookies[0]).toContain(`${AUTH_COOKIE_NAME}=`);
    expect(cookies[0]).toContain('HttpOnly');
    expect(cookies[0]).toContain('SameSite=Lax');
    expect(cookies[0]).toContain('Path=/');
    expect(cookies[0]).toContain(`Max-Age=${config.jwtExpiresIn}`);

    const stored = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(stored.password).toBeNull();
    expect(stored.passwordHash).not.toBe(body.password);
    expect(await bcrypt.compare(body.password, stored.passwordHash!)).toBe(true);
    expect(bcrypt.getRounds(stored.passwordHash!)).toBe(10);
    const me = await agent.get('/api/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.data.user).toEqual(response.body.data.user);

    const legacy = await agent.get(`/api/users/${userId}`);
    expect(legacy.status).toBe(200);
    expect(legacy.body.data).not.toHaveProperty('passwordHash');
    expect(legacy.body.data).not.toHaveProperty('password');
  });

  it('logs out, clears the cookie, and allows a fresh login with a normalized email', async () => {
    const { agent, body, userId } = await register();
    const logout = await agent.post('/api/auth/logout');
    expect(logout.status).toBe(204);
    expect(logout.headers['set-cookie'][0]).toContain('Expires=Thu, 01 Jan 1970');
    expect((await agent.get('/api/auth/me')).status).toBe(401);
    const login = await agent
      .post('/api/auth/login')
      .send({ email: ` ${body.email.toUpperCase()} `, password });
    expect(login.status).toBe(200);
    expect(login.body.data.user.id).toBe(userId);
    expect(login.body.data.user).not.toHaveProperty('passwordHash');
    expect((await agent.get('/api/auth/me')).status).toBe(200);
  });

  it.each(['email', 'studentId'] as const)('returns 409 for a duplicate %s', async (field) => {
    const { body } = await register();
    const duplicate = profile();
    duplicate[field] = field === 'email' ? body.email.toUpperCase() : body.studentId;
    const response = await request(app).post('/api/auth/register').send(duplicate);
    expect(response.status).toBe(409);
    expect(response.headers['set-cookie']).toBeUndefined();
  });

  it.each(['wrong-password', 'unknown-user'] as const)(
    'rejects %s without revealing which credential failed',
    async (kind) => {
      const { body } = await register();
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: kind === 'unknown-user' ? profile().email : body.email,
          password: 'wrong-password',
        });
      expect(response.status).toBe(401);
      expect(response.body.error).toBe('Invalid email or password');
      expect(response.headers['set-cookie']).toBeUndefined();
    },
  );

  it.each(['short', 'x'.repeat(73), '😀'.repeat(19)])(
    'rejects an invalid password before storing an account',
    async (invalidPassword) => {
      const body = { ...profile(), password: invalidPassword };
      const response = await request(app).post('/api/auth/register').send(body);
      expect(response.status).toBe(400);
      expect(await prisma.user.count({ where: { studentId: body.studentId } })).toBe(0);
    },
  );

  it('rejects attempts to select an admin role during registration', async () => {
    const body = { ...profile(), role: 'ADMIN' };
    expect((await request(app).post('/api/auth/register').send(body)).status).toBe(400);
    expect(await prisma.user.count({ where: { studentId: body.studentId } })).toBe(0);
  });

  it('rejects missing, malformed, expired, wrongly signed, and deleted-user sessions', async () => {
    const { userId } = await register();
    const expired = jwt.sign({}, config.jwtSecret, {
      ...AUTH_TOKEN_OPTIONS,
      subject: userId,
      expiresIn: -1,
    });
    const wrongSignature = jwt.sign({}, 'another-secret', {
      ...AUTH_TOKEN_OPTIONS,
      subject: userId,
      expiresIn: 60,
    });
    expect((await request(app).get('/api/auth/me')).status).toBe(401);
    for (const token of ['invalid', expired, wrongSignature]) {
      const response = await request(app)
        .get('/api/auth/me')
        .set('Cookie', `${AUTH_COOKIE_NAME}=${token}`);
      expect(response.status).toBe(401);
    }
    const { agent, userId: deletedUserId } = await register();
    await prisma.user.delete({ where: { id: deletedUserId } });
    expect((await agent.get('/api/auth/me')).status).toBe(401);
  });

  it('blocks foreign origins for registration, login, and logout while accepting the frontend origin', async () => {
    const { agent, body } = await register();
    for (const path of ['register', 'login', 'logout']) {
      const response = await agent
        .post(`/api/auth/${path}`)
        .set('Origin', 'https://foreign.example')
        .send(body);
      expect(response.status).toBe(403);
      expect(response.headers['set-cookie']).toBeUndefined();
    }
    expect((await agent.get('/api/auth/me')).status).toBe(200);
    const allowed = await request(app)
      .post('/api/auth/register')
      .set('Origin', config.corsOrigin)
      .send(profile());
    expect(allowed.status).toBe(201);
    expect(
      (
        await request(app)
          .post('/api/auth/register')
          .set('Sec-Fetch-Site', 'cross-site')
          .send(profile())
      ).status,
    ).toBe(403);
  });

  it.each(['/api/courses', '/api/users', '/api/study-plans'])(
    'requires authentication for writes to %s',
    async (path) => {
      expect((await request(app).post(path).send({})).status).toBe(401);
    },
  );

  it('uses the current database role for admin access and rejects student catalog edits', async () => {
    const { agent, userId } = await register();
    expect((await agent.post('/api/courses').send({})).status).toBe(403);
    expect((await agent.post('/api/users').send({})).status).toBe(403);
    await prisma.user.update({ where: { id: userId }, data: { role: 'ADMIN' } });
    // Passing authorization reaches the existing input validator.
    expect((await agent.post('/api/courses').send({})).status).toBe(400);
    expect((await agent.get('/api/auth/me')).body.data.user.role).toBe('ADMIN');
    await prisma.user.update({ where: { id: userId }, data: { role: 'STUDENT' } });
    expect((await agent.post('/api/courses').send({})).status).toBe(403);
  });

  it('allows own record access and rejects writes to another student using either identifier', async () => {
    const owner = await register();
    const other = await register();
    const record = { courseId: randomUUID(), status: 'COMPLETED' };
    expect((await owner.agent.post(`/api/users/${owner.userId}/records`).send(record)).status).toBe(
      404,
    );
    for (const identifier of [other.userId, other.body.studentId]) {
      for (const endpoint of ['records', 'records/toggle']) {
        expect(
          (await owner.agent.post(`/api/users/${identifier}/${endpoint}`).send(record)).status,
        ).toBe(403);
      }
    }
    expect(
      (await request(app).post(`/api/users/${owner.userId}/records`).send(record)).status,
    ).toBe(401);
  });

  it('cannot impersonate another UUID by registering it as a student ID', async () => {
    const victim = await register();
    const attacker = await register(victim.userId);
    const response = await attacker.agent.post(`/api/users/${victim.userId}/records`).send({
      courseId: randomUUID(),
      status: 'COMPLETED',
    });
    expect(response.status).toBe(403);
  });

  it('checks plan ownership and rejects semesters belonging to a different plan', async () => {
    const owner = await register();
    const other = await register();
    const own = await owner.agent
      .post('/api/study-plans')
      .send({ userId: owner.userId, name: 'Own plan' });
    const foreign = await other.agent
      .post('/api/study-plans')
      .send({ userId: other.userId, name: 'Other plan' });
    expect(own.status).toBe(201);
    expect(foreign.status).toBe(201);
    const ownId: string = own.body.data.id;
    const foreignId: string = foreign.body.data.id;
    const semester = await prisma.plannedSemester.create({
      data: { studyPlanId: foreignId, semester: 'FALL', year: 2026, courses: [] },
    });
    expect(
      (await owner.agent.post('/api/study-plans').send({ userId: other.userId, name: 'Forbidden' }))
        .status,
    ).toBe(403);
    expect(
      (await owner.agent.post(`/api/study-plans/${foreignId}/semesters`).send({})).status,
    ).toBe(403);
    expect((await owner.agent.delete(`/api/study-plans/${foreignId}`)).status).toBe(403);
    expect(
      (
        await owner.agent
          .put(`/api/study-plans/${ownId}/semesters/${semester.id}`)
          .send({ year: 2027 })
      ).status,
    ).toBe(404);
    expect(
      (await owner.agent.delete(`/api/study-plans/${ownId}/semesters/${semester.id}`)).status,
    ).toBe(404);
    expect(
      (await prisma.plannedSemester.findUniqueOrThrow({ where: { id: semester.id } })).year,
    ).toBe(2026);
    expect((await owner.agent.delete(`/api/study-plans/${ownId}`)).status).toBe(200);
  });
});
