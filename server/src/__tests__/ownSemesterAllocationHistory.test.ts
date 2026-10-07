import { randomUUID } from 'node:crypto';
import request from 'supertest';
import {
  OwnSemesterAllocationHistorySchema,
  type SimulationSemesterAllocationResultDTO,
} from '@iu-study-planner/shared';
import app, { prisma } from '../index';
import { AUTH_COOKIE_NAME, issueToken } from '../services/authService';
import { allocateSimulationSemester } from '../services/simulationSemesterAllocation';
import { listOwnSemesterAllocationRuns } from '../services/ownSemesterAllocationHistory';
import {
  readOwnSemesterAllocationRun,
  storeSemesterAllocationRun,
} from '../services/semesterAllocationStorage';

describe('own semester simulation discovery (PostgreSQL)', () => {
  const prefix = `own-semester-history-${randomUUID()}`;
  const administrators = [randomUUID(), randomUUID()];
  const students = [randomUUID(), randomUUID(), randomUUID()];
  const users = [...administrators, ...students];
  const contexts = [randomUUID(), randomUUID()];
  const courses = [randomUUID(), randomUUID()];
  const scope = () => ({ curriculumId: contexts[0], semester: 'FALL' as const, year: 2026 });
  const cookie = (actorId = students[0]) => `${AUTH_COOKIE_NAME}=${issueToken(actorId)}`;
  const get = (query: object = {}, actorId = students[0]) =>
    request(app)
      .get('/api/users/me/semester-allocation-runs')
      .set('Cookie', cookie(actorId))
      .query(query);
  let afterActorRead: (() => Promise<void>) | undefined;
  let tracing = false;
  const reads: { model: string | undefined; action: string; take: unknown; include: unknown }[] =
    [];
  const fixture = (): SimulationSemesterAllocationResultDTO =>
    allocateSimulationSemester(
      {
        kind: 'SIMULATION',
        usage: 'REFERENCE_ONLY',
        scopeBasis: 'SCENARIO_ONLY',
        scope: scope(),
        curriculum: {
          id: contexts[0],
          code: `${prefix}-context-0`,
          name: 'Stored reference',
          school: 'CSE',
        },
        resourceRevision: 1,
        policy: {
          model: 'SHARED_CLASSROOM_SECTION_ENVELOPE_V1',
          classroomTimeBlocks: 1,
          sectionsPerProfessor: 1,
          roomBasis: 'ONE_CLASSROOM_SECTION_PER_ROOM_PER_BLOCK',
          teachingBasis: 'ONE_PROFESSOR_PER_SECTION_PER_BLOCK',
          sectionDurationBasis: 'ONE_SIMULATED_BLOCK',
          professorAssignmentBasis: 'INTERCHANGEABLE_FOR_ENVELOPE_ONLY',
        },
        resources: { professors: 2, classrooms: 2, labRooms: 7, maxStudentsPerSection: 2 },
        envelope: {
          classroomSectionCeiling: 2,
          professorSectionCeiling: 2,
          sharedSectionCeiling: 2,
          sharedSeatCeiling: 4,
        },
        labSectionsModeled: false,
        courseOverridesApplied: false,
        teachingLoadValidated: false,
        professorAvailabilityValidated: false,
        professorQualificationsValidated: false,
        crossCurriculumResourcesReconciled: false,
        timetableValidated: false,
        offeringValidationAvailable: false,
        demandValidated: false,
        allocationValidated: false,
      },
      {
        courses: courses.map((courseId) => ({ courseId, credits: 3 })),
        students: students.slice(0, 2).map((studentId, index) => ({
          studentId,
          targetCredits: index === 0 ? 6 : 3,
          candidates: courses.map((courseId, courseIndex) => ({
            courseId,
            studentUtility: courseIndex === 0 ? 1 : 0.9,
          })),
        })),
      },
      {
        studentUtilityWeight: 0.6,
        resourceFitWeight: 0.25,
        fairnessWeight: 0.15,
        congestionThreshold: 0.85,
      },
    );
  const clean = async () => {
    await prisma.simulationSemesterParticipant.deleteMany({
      where: { run: { curriculumId: { in: contexts } } },
    });
    await prisma.simulationSemesterRun.deleteMany({ where: { curriculumId: { in: contexts } } });
    await prisma.user.deleteMany({ where: { id: { in: users } } });
    await prisma.curriculum.deleteMany({ where: { id: { in: contexts } } });
    await prisma.course.deleteMany({ where: { id: { in: courses } } });
  };
  const insert = async (
    index = 0,
    changes: {
      formatVersion?: number;
      missingOther?: boolean;
      mismatchOther?: boolean;
      invalidResult?: boolean;
      semester?: 'FALL' | 'SPRING';
    } = {},
  ) => {
    const result = fixture();
    if (changes.semester) result.envelope.scope.semester = changes.semester;
    const time = new Date(Date.UTC(2026, 9, 6, 0, 0, index));
    const row = await prisma.simulationSemesterRun.create({
      data: {
        ...scope(),
        semester: result.envelope.scope.semester,
        requestId: randomUUID(),
        createdById: administrators[0],
        capturedAt: time,
        createdAt: time,
        formatVersion: changes.formatVersion ?? 1,
        result: changes.invalidResult ? { ...result, assignedCourseCount: 999 } : result,
      },
    });
    await prisma.simulationSemesterParticipant.createMany({
      data: result.students
        .filter((student) => !(changes.missingOther && student.studentId === students[1]))
        .map((student) => ({
          runId: row.id,
          capturedStudentId: student.studentId,
          userId: student.studentId,
          result:
            changes.mismatchOther && student.studentId === students[1]
              ? { ...student, assignedCredits: 0 }
              : student,
        })),
    });
    return row;
  };
  const page = async (query: object = {}, actorId = students[0]) => {
    const response = await get(query, actorId);
    expect(response.status).toBe(200);
    return OwnSemesterAllocationHistorySchema.parse(response.body.data);
  };
  beforeAll(() => {
    prisma.$use(async (params, next) => {
      const result: unknown = await next(params);
      if (tracing)
        reads.push({
          model: params.model,
          action: params.action,
          take: params.args?.take,
          include: params.args?.include,
        });
      if (
        params.runInTransaction &&
        params.model === 'User' &&
        params.action === 'findUnique' &&
        params.args?.where?.id === students[0] &&
        afterActorRead
      ) {
        const hook = afterActorRead;
        afterActorRead = undefined;
        await hook();
      }
      return result;
    });
  });
  beforeEach(async () => {
    afterActorRead = undefined;
    tracing = false;
    reads.length = 0;
    await clean();
    await prisma.curriculum.createMany({
      data: contexts.map((id, index) => ({
        id,
        code: `${prefix}-context-${index}`,
        name: 'Stored reference',
        school: 'CSE',
        degree: 'Bachelor',
        programUrl: 'https://example.test/own-semester-history',
      })),
    });
    await prisma.user.createMany({
      data: users.map((id, index) => ({
        id,
        studentId: `${prefix}-user-${index}`,
        email: `${id}@example.test`,
        name: `Private owner ${index}`,
        role: index < 2 ? 'ADMIN' : 'STUDENT',
        curriculumId: contexts[0],
      })),
    });
    await prisma.course.createMany({
      data: courses.map((id, index) => ({
        id,
        code: `${prefix}-course-${index}`,
        name: `Private course ${index}`,
        credits: 3,
        difficultyLevel: 2,
        semesterOffered: [],
      })),
    });
    await prisma.studentRecord.create({
      data: { userId: students[0], courseId: courses[0], status: 'PLANNED' },
    });
  });
  afterEach(async () => {
    afterActorRead = undefined;
    tracing = false;
    await clean();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('requires a live cookie account and returns an honest empty own history', async () => {
    expect((await request(app).get('/api/users/me/semester-allocation-runs')).status).toBe(401);
    expect((await get({}, randomUUID())).status).toBe(401);
    expect(await page()).toMatchObject({
      visibility: 'CURRENT_ACCOUNT_ONLY',
      pageSize: 5,
      after: null,
      runs: [],
      nextAfter: null,
    });
    await expect(listOwnSemesterAllocationRuns(randomUUID())).rejects.toMatchObject({
      status: 401,
    });
  });
  it('discovers trusted persisted own outcomes without requiring a run ID and exposes no cohort data', async () => {
    const saved = await storeSemesterAllocationRun(
      administrators[0],
      { ...scope(), requestId: randomUUID(), expectedActorId: administrators[0] },
      fixture(),
      new Date(),
    );
    const first = await page();
    expect(first.runs).toHaveLength(1);
    expect(first.runs[0]).toEqual(await readOwnSemesterAllocationRun(students[0], saved.run.id));
    expect(first.runs[0].result).toMatchObject({
      targetCredits: 6,
      assignedCredits: 6,
      remainingCredits: 0,
      reason: 'TARGET_REACHED',
    });
    const other = await page({}, students[1]);
    expect(other.runs[0].result).toMatchObject({ targetCredits: 3, assignedCredits: 3 });
    expect((await page({}, students[2])).runs).toEqual([]);
    expect((await page({}, administrators[0])).runs).toEqual([]);
    const serialized = JSON.stringify(first);
    for (const id of users) expect(serialized).not.toContain(id);
    for (const field of [
      'studentId',
      'students',
      'candidates',
      'assignments',
      'input',
      'studentUtility',
      'requestId',
      'createdById',
      'capturedStudentId',
      'email',
      'passwordHash',
      'Private owner',
      'Private course',
      'envelope',
      'policy',
      'studentCount',
    ])
      expect(serialized).not.toContain(field);
  });
  it.each([
    { userId: students[1] },
    { curriculumId: contexts[1] },
    { semester: 'SPRING' },
    { year: '2027' },
    { limit: '100' },
    { after: 'bad' },
    { after: [randomUUID(), randomUUID()] },
  ])('rejects unsupported query %j', async (query) => {
    expect((await get(query)).status).toBe(400);
  });
  it('rejects a GET body rather than accepting alternate identity or scope', async () => {
    const response = await request(app)
      .get('/api/users/me/semester-allocation-runs')
      .set('Cookie', cookie())
      .send({ userId: students[1] });
    expect(response.status).toBe(400);
  });
  it('normalizes UUID continuation and paginates five rows without repeated or missing older captures', async () => {
    const saved = [];
    for (let index = 0; index < 12; index++) saved.push(await insert(index));
    const first = await page();
    expect(first.runs.map((run) => run.id)).toEqual(
      saved
        .slice(7)
        .reverse()
        .map((run) => run.id),
    );
    expect(first.nextAfter).toBe(first.runs.at(-1)?.id);
    const second = await page({ after: first.nextAfter?.toUpperCase() });
    expect(second.after).toBe(first.nextAfter);
    expect(second.runs.map((run) => run.id)).toEqual(
      saved
        .slice(2, 7)
        .reverse()
        .map((run) => run.id),
    );
    const third = await page({ after: second.nextAfter });
    expect(third.runs.map((run) => run.id)).toEqual(
      saved
        .slice(0, 2)
        .reverse()
        .map((run) => run.id),
    );
    expect(third.nextAfter).toBeNull();
  });
  it('uses immutable identifier descending to break tied storage timestamps', async () => {
    const rows = [];
    for (let index = 0; index < 7; index++) rows.push(await insert());
    const sorted = rows
      .map((row) => row.id)
      .sort()
      .reverse();
    const first = await page();
    const next = await page({ after: first.nextAfter });
    expect([...first.runs, ...next.runs].map((run) => run.id)).toEqual(sorted);
  });
  it('continues the original boundary after a newer capture is inserted', async () => {
    const rows = [];
    for (let index = 0; index < 7; index++) rows.push(await insert(index));
    const first = await page();
    await insert(60);
    const next = await page({ after: first.nextAfter });
    expect(next.runs.map((run) => run.id)).toEqual(
      rows
        .slice(0, 2)
        .reverse()
        .map((run) => run.id),
    );
  });
  it('reads both ownership and bounded histories from one RepeatableRead snapshot during capture', async () => {
    const older = await insert();
    let newId = '';
    afterActorRead = async () => {
      newId = (await insert(60)).id;
    };
    const coherent = await page();
    expect(coherent.runs.map((run) => run.id)).toEqual([older.id]);
    expect((await page()).runs.map((run) => run.id)).toEqual([newId, older.id]);
  });
  it('keeps historical own discovery when current role and curriculum change', async () => {
    const first = await insert();
    await prisma.user.update({
      where: { id: students[0] },
      data: { role: 'ADMIN', curriculumId: contexts[1] },
    });
    expect((await page()).runs.map((run) => run.id)).toEqual([first.id]);
    await prisma.user.update({ where: { id: students[0] }, data: { curriculumId: null } });
    expect((await page()).runs.map((run) => run.id)).toEqual([first.id]);
  });
  it('returns historical scopes across semesters rather than silently filtering by current context', async () => {
    await insert(0);
    await insert(1, { semester: 'SPRING' });
    expect((await page()).runs.map((run) => run.scope.semester)).toEqual(['SPRING', 'FALL']);
  });
  it('revokes access on account deletion and does not reattach historical UUIDs on recreation', async () => {
    const first = await insert();
    await prisma.user.delete({ where: { id: students[0] } });
    expect((await get()).status).toBe(401);
    await prisma.user.create({
      data: {
        id: students[0],
        email: `${students[0]}@example.test`,
        studentId: `${prefix}-recreated`,
        name: 'Recreated',
        curriculumId: contexts[0],
      },
    });
    expect((await page()).runs).toEqual([]);
    expect((await get({ after: first.id })).status).toBe(409);
    expect(
      (
        await prisma.simulationSemesterParticipant.findMany({
          where: { runId: first.id, capturedStudentId: students[0] },
        })
      )[0].userId,
    ).toBeNull();
  });
  it('treats missing and nonowned cursor IDs uniformly without revealing another account history', async () => {
    const own = await insert();
    const absent = await get({ after: randomUUID() });
    const denied = await get({ after: own.id }, students[2]);
    expect(absent.status).toBe(409);
    expect(denied.status).toBe(409);
    expect(denied.body).toEqual(absent.body);
  });
  it('requires reloading when a previously valid cursor has been deleted', async () => {
    const own = await insert();
    await prisma.simulationSemesterParticipant.deleteMany({ where: { runId: own.id } });
    await prisma.simulationSemesterRun.delete({ where: { id: own.id } });
    expect((await get({ after: own.id })).status).toBe(409);
  });
  it.each(['unsupported', 'missingOther', 'mismatchOther', 'invalidResult'] as const)(
    'fails closed without a partial page on %s private history',
    async (damage) => {
      await insert();
      await insert(1, damage === 'unsupported' ? { formatVersion: 2 } : { [damage]: true });
      const response = await get();
      expect(response.status).toBe(500);
      expect(response.body.data).toBeUndefined();
      expect(response.body.error).toBe('Could not load own semester simulations');
    },
  );
  it('verifies the bounded lookahead before exposing a continuation', async () => {
    const damaged = await insert(0, { formatVersion: 2 });
    for (let index = 1; index < 6; index++) await insert(index);
    expect((await get()).status).toBe(500);
    expect((await get({ after: damaged.id })).status).toBe(500);
  });
  it('bounds row and child reads and leaves current academic source records untouched', async () => {
    await insert();
    const before = await prisma.studentRecord.findMany({ where: { userId: students[0] } });
    tracing = true;
    const result = await page();
    tracing = false;
    const read = reads.find(
      (item) => item.model === 'SimulationSemesterRun' && item.action === 'findMany',
    );
    expect(read).toMatchObject({
      take: 6,
      include: { participants: { take: 501, orderBy: { capturedStudentId: 'asc' } } },
    });
    expect(
      reads.every((item) => ['User', 'SimulationSemesterRun'].includes(item.model ?? '')),
    ).toBe(true);
    expect(result.runs[0].academicPlansChanged).toBe(false);
    expect(await prisma.studentRecord.findMany({ where: { userId: students[0] } })).toEqual(before);
  });
});
