import request from 'supertest';
import app, { prisma } from '../index';
import config from '../config';
import { DEMO_ACCOUNTS } from '../services/demoAuthService';

describe('development demo cookie sessions (PostgreSQL)', () => {
  const originalEnv = config.nodeEnv;
  const originalEnabled = config.demoLoginEnabled;
  const demoIds = Object.values(DEMO_ACCOUNTS).map((profile) => profile.id);
  let createdIds: string[] = [];

  beforeAll(async () => {
    const existing = await prisma.user.findMany({
      where: { id: { in: demoIds } },
      select: { id: true },
    });
    createdIds = demoIds.filter((id) => !existing.some((user) => user.id === id));
  });
  beforeEach(() => {
    config.nodeEnv = 'development';
    config.demoLoginEnabled = true;
  });
  afterEach(() => {
    config.nodeEnv = originalEnv;
    config.demoLoginEnabled = originalEnabled;
  });
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: createdIds } } });
    await prisma.$disconnect();
  });

  it.each(['STUDENT', 'ADMIN'] as const)(
    'issues a real %s session with the correct role guard',
    async (role) => {
      const agent = request.agent(app);
      const login = await agent.post('/api/auth/demo').send({ role });
      expect(login.status).toBe(200);
      const stored = await prisma.user.findUniqueOrThrow({
        where: { id: DEMO_ACCOUNTS[role].id },
        select: { curriculumId: true },
      });
      expect(login.body.data.user).toEqual({
        ...DEMO_ACCOUNTS[role],
        curriculumId: stored.curriculumId,
      });
      expect(login.body.data).not.toHaveProperty('token');
      expect(login.headers['set-cookie'][0]).toContain('HttpOnly');
      expect(login.headers['set-cookie'][0]).toContain('SameSite=Lax');
      const me = await agent.get('/api/auth/me');
      expect(me.body.data.user.role).toBe(role);
      // Invalid input reaches validation only for administrators.
      expect((await agent.post('/api/users').send({})).status).toBe(role === 'ADMIN' ? 400 : 403);
      expect((await agent.post('/api/auth/logout')).status).toBe(204);
      expect((await agent.get('/api/auth/me')).status).toBe(401);
    },
  );

  it('reuses dedicated identities without duplicating accounts or overwriting progress', async () => {
    const first = await request(app).post('/api/auth/demo').send({ role: 'STUDENT' });
    const recordsBefore = await prisma.studentRecord.count({
      where: { userId: first.body.data.user.id },
    });
    const second = await request(app).post('/api/auth/demo').send({ role: 'STUDENT' });
    expect(second.body.data.user.id).toBe(first.body.data.user.id);
    expect(await prisma.user.count({ where: { id: DEMO_ACCOUNTS.STUDENT.id } })).toBe(1);
    expect(await prisma.studentRecord.count({ where: { userId: first.body.data.user.id } })).toBe(
      recordsBefore,
    );
  });

  it.each(['disabled', 'production', 'test'])(
    'does not issue demo sessions when %s',
    async (mode) => {
      config.demoLoginEnabled = mode !== 'disabled';
      config.nodeEnv = mode === 'disabled' ? 'development' : mode;
      const countBefore = await prisma.user.count({ where: { id: { in: demoIds } } });
      expect((await request(app).get('/api/auth/demo')).body.data.enabled).toBe(false);
      const response = await request(app).post('/api/auth/demo').send({ role: 'ADMIN' });
      expect(response.status).toBe(404);
      expect(response.headers['set-cookie']).toBeUndefined();
      expect(await prisma.user.count({ where: { id: { in: demoIds } } })).toBe(countBefore);
    },
  );

  it.each([{ role: 'SUPERADMIN' }, { role: 'ADMIN', userId: 'another-student' }])(
    'rejects invalid demo identities',
    async (body) => {
      const response = await request(app).post('/api/auth/demo').send(body);
      expect(response.status).toBe(400);
      expect(response.headers['set-cookie']).toBeUndefined();
    },
  );

  it('advertises enabled access and rejects a foreign browser origin', async () => {
    expect((await request(app).get('/api/auth/demo')).body.data.enabled).toBe(true);
    const response = await request(app)
      .post('/api/auth/demo')
      .set('Origin', 'https://other.example')
      .send({ role: 'ADMIN' });
    expect(response.status).toBe(403);
    expect(response.headers['set-cookie']).toBeUndefined();
  });
});
