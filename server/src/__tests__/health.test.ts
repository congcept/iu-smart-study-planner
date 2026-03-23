import request from 'supertest';
import app, { prisma } from '../index';

describe('GET /api/health', () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('should return 200 OK with health status', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body).toHaveProperty('timestamp');
    expect(res.body).toHaveProperty('environment');
    expect(res.body).toHaveProperty('version');
  });
});
