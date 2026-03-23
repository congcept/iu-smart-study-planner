import request from 'supertest';
import app, { prisma } from '../index';

describe('POST /api/recommendations/analyze-workload', () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('should return 400 when missing courseIds array', async () => {
    const res = await request(app).post('/api/recommendations/analyze-workload').send({});

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('should return 400 when courseIds is empty', async () => {
    const res = await request(app)
      .post('/api/recommendations/analyze-workload')
      .send({ courseIds: [] });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });
});
