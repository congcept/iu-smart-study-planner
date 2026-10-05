import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { AllocationJobOutcomeSchema } from '@iu-study-planner/shared';
import { prisma } from '../db';
import { enqueueAllocationJob } from '../services/allocationJobs';

describe('explicit single-job simulation CLI (PostgreSQL)', () => {
  const prefix = `worker-cli-${randomUUID()}`;
  const actorId = randomUUID();
  const curriculumId = randomUUID();
  const scope = { curriculumId, semester: 'FALL' as const, year: 2026 };
  const queue = () =>
    enqueueAllocationJob(actorId, { ...scope, expectedActorId: actorId, requestId: randomUUID() });
  const run = (args: string[], overrides: Record<string, string> = {}) => {
    const env: NodeJS.ProcessEnv = { ...process.env, ...overrides, NODE_ENV: 'test' };
    delete env.DYLD_INSERT_LIBRARIES;
    return spawnSync(
      process.execPath,
      [
        require.resolve('ts-node/dist/bin.js'),
        resolve(__dirname, '../scripts/runAllocationJob.ts'),
        ...args,
      ],
      {
        cwd: resolve(__dirname, '../..'),
        env,
        encoding: 'utf8',
        timeout: 20_000,
      },
    );
  };
  const clean = async () => {
    await prisma.simulationAllocationExecution.deleteMany({ where: { job: { curriculumId } } });
    await prisma.simulationAllocationRun.deleteMany({ where: { curriculumId } });
    await prisma.simulationAllocationJob.deleteMany({ where: { curriculumId } });
    await prisma.user.deleteMany({ where: { id: actorId } });
    await prisma.curriculum.deleteMany({ where: { id: curriculumId } });
  };
  beforeEach(async () => {
    await clean();
    await prisma.curriculum.create({
      data: {
        id: curriculumId,
        code: prefix,
        name: 'CLI reference',
        school: 'CSE',
        degree: 'Bachelor',
        programUrl: 'https://example.test/cli',
      },
    });
    await prisma.user.create({
      data: {
        id: actorId,
        studentId: prefix,
        email: `${prefix}@example.test`,
        name: 'CLI admin',
        passwordHash: 'unused',
        role: 'ADMIN',
      },
    });
  });
  afterEach(clean);

  it.each([
    { args: [] },
    { args: ['--apply'] },
    { args: [randomUUID()] },
    { args: ['--apply', 'invalid'] },
    { args: ['--apply', randomUUID(), '--loop'] },
  ])(
    'requires an explicit apply flag and one UUID without processing queued work: %j',
    async ({ args }) => {
      await queue();
      const reply = run(args);
      expect(reply.status).toBe(2);
      expect(reply.stderr).toContain('Usage:');
      expect(reply.stdout).toBe('');
      expect(
        await prisma.simulationAllocationExecution.count({ where: { job: { curriculumId } } }),
      ).toBe(0);
      expect(await prisma.simulationAllocationRun.count({ where: { curriculumId } })).toBe(0);
    },
    15_000,
  );
  it('executes only the selected request and reports a private-free terminal result', async () => {
    const first = await queue();
    const retained = await queue();
    const reply = run(['--apply', first.job.id.toUpperCase()]);
    expect(reply.status).toBe(0);
    const result = JSON.parse(reply.stdout);
    expect(result.processed).toBe(true);
    const outcome = AllocationJobOutcomeSchema.parse(result.outcome);
    expect(outcome.status).toBe('SUCCEEDED');
    expect(outcome.scope).toEqual(scope);
    expect(reply.stdout).not.toContain(actorId);
    expect(reply.stdout).not.toContain('passwordHash');
    expect(
      await prisma.simulationAllocationExecution.findUnique({ where: { jobId: retained.job.id } }),
    ).toBeNull();
    expect(await prisma.simulationAllocationRun.count({ where: { curriculumId } })).toBe(1);
    const retry = run(['--apply', first.job.id]);
    expect(retry.status).toBe(0);
    expect(JSON.parse(retry.stdout).processed).toBe(false);
    expect(await prisma.simulationAllocationRun.count({ where: { curriculumId } })).toBe(1);
  }, 15_000);
  it('an unavailable ID does not imply an empty queue or process other requests', async () => {
    await queue();
    const reply = run(['--apply', randomUUID()]);
    expect(reply.status).toBe(0);
    expect(JSON.parse(reply.stdout)).toMatchObject({
      processed: false,
      notice: expect.stringContaining('this ID'),
    });
    expect(
      await prisma.simulationAllocationExecution.count({ where: { job: { curriculumId } } }),
    ).toBe(0);
  }, 15_000);
  it('redacts database/transport errors and exits without claiming success', async () => {
    const saved = await queue();
    const reply = run(['--apply', saved.job.id], {
      DATABASE_URL: 'postgresql://never-log-secret@127.0.0.1:1/unavailable?connect_timeout=1',
    });
    expect(reply.status).toBe(1);
    expect(reply.stderr).toContain('Could not confirm simulation execution');
    expect(`${reply.stderr}${reply.stdout}`).not.toContain('never-log-secret');
    expect(reply.stdout).toBe('');
    expect(
      await prisma.simulationAllocationExecution.count({ where: { job: { curriculumId } } }),
    ).toBe(0);
  }, 15_000);
});
