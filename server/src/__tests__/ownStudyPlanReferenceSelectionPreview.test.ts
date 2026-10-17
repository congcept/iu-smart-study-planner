import { randomUUID } from 'node:crypto';
import request from 'supertest';
import {
  OwnStudyPlanReferenceSelectionPreviewBodySchema,
  OwnStudyPlanReferenceSelectionPreviewSchema,
  type OwnStudyPlanReferenceSelectionPreviewBodyDTO,
  type OwnStudyPlanReferenceSelectionPreviewDTO,
} from '@iu-study-planner/shared';
import app, { prisma } from '../index';
import { AUTH_COOKIE_NAME, issueToken } from '../services/authService';
import { previewOwnStudyPlanReferenceSelection } from '../services/ownStudyPlanReferenceSelection';

describe('proposed saved reference course checks (real PostgreSQL)', () => {
  const owner = randomUUID();
  const admin = randomUUID();
  const curriculum = randomUUID();
  const child = randomUUID();
  const parent = randomUUID();
  const peer = randomUUID();
  const bare = randomUUID();
  const foreign = randomUUID();
  const created: string[] = [child, parent, peer, bare, foreign];
  let thesis: string;
  let physical: string;
  let plan: string;
  let semester: string;
  let hook: (() => Promise<void>) | undefined;
  const cookie = (id = owner) => `${AUTH_COOKIE_NAME}=${issueToken(id)}`;
  const url = (p = plan, s = semester) =>
    `/api/users/me/study-plans/${p}/semesters/${s}/reference-selection`;
  const body = (courseIds: string[] = [child]): OwnStudyPlanReferenceSelectionPreviewBodyDTO => ({
    expectedScope: { userId: owner, curriculumId: curriculum },
    expectedRevision: 0,
    academicYear: 2,
    academicSemester: 1,
    courseIds,
  });
  const post = (input: object = body(), actor = owner, p = plan, s = semester) =>
    request(app)
      .post(`${url(p, s)}/preview`)
      .set('Cookie', cookie(actor))
      .send(input);
  const check = async (input = body()) => {
    const response = await post(input);
    expect(response.status).toBe(200);
    return OwnStudyPlanReferenceSelectionPreviewSchema.parse(response.body.data);
  };
  const member = (courseId: string, year = 2, academicSemester = 1) =>
    prisma.curriculumCourse.create({
      data: {
        curriculumId: curriculum,
        courseId,
        placements: { create: { sourceOrder: 0, academicYear: year, academicSemester } },
      },
    });
  const edge = (isStrict = true, isCorequisite = false) =>
    prisma.curriculumPrerequisite.create({
      data: {
        curriculumId: curriculum,
        courseId: child,
        prerequisiteId: parent,
        isStrict,
        isCorequisite,
      },
    });
  const complete = () =>
    prisma.studentRecord.create({
      data: {
        userId: owner,
        courseId: parent,
        status: 'COMPLETED',
      },
    });
  const grade = (courseId: string, score: number) =>
    prisma.gradeAttempt.create({
      data: {
        userId: owner,
        courseId,
        score,
        requestId: randomUUID(),
      },
    });
  const state = async () => ({
    semester: await prisma.plannedSemester.findUniqueOrThrow({ where: { id: semester } }),
    plan: await prisma.studyPlan.findUniqueOrThrow({ where: { id: plan } }),
    records: await prisma.studentRecord.findMany({ where: { userId: owner } }),
    grades: await prisma.gradeAttempt.findMany({ where: { userId: owner } }),
    receipts: await prisma.referenceSelectionReceipt.findMany({ where: { userId: owner } }),
  });
  beforeAll(async () => {
    prisma.$use(async (params, next) => {
      const result: unknown = await next(params);
      if (
        hook &&
        params.runInTransaction &&
        params.model === 'PlannedSemester' &&
        params.action === 'findFirst' &&
        params.args?.select?.revision
      ) {
        const action = hook;
        hook = undefined;
        await action();
      }
      return result;
    });
    await prisma.curriculum.create({
      data: {
        id: curriculum,
        code: `preview-${curriculum}`,
        name: 'Unverified reference',
        school: 'CSE',
        degree: 'Bachelor',
        programUrl: 'https://example.test/unverified',
      },
    });
    await prisma.user.createMany({
      data: [owner, admin].map((id, index) => ({
        id,
        studentId: id,
        email: `${id}@example.test`,
        name: 'Private',
        role: index ? 'ADMIN' : 'STUDENT',
      })),
    });
    await prisma.course.createMany({
      data: created.map((id) => ({
        id,
        code: `preview-${id}`,
        name: 'Private label',
        credits: 3,
        difficultyLevel: 3,
      })),
    });
    for (const code of ['IT058IU', 'PT001IU']) {
      const existing = await prisma.course.findUnique({ where: { code }, select: { id: true } });
      const id =
        existing?.id ??
        (
          await prisma.course.create({
            data: {
              code,
              name: 'Fixture',
              credits: 3,
              difficultyLevel: 3,
            },
          })
        ).id;
      if (!existing) created.push(id);
      if (code === 'IT058IU') thesis = id;
      else physical = id;
    }
  });
  beforeEach(async () => {
    hook = undefined;
    await prisma.studyPlan.deleteMany({ where: { userId: { in: [owner, admin] } } });
    await prisma.studentRecord.deleteMany({ where: { userId: owner } });
    await prisma.gradeAttempt.deleteMany({ where: { userId: owner } });
    await prisma.curriculumCourse.deleteMany({ where: { curriculumId: curriculum } });
    await prisma.curriculum.update({ where: { id: curriculum }, data: { isGpaPath: false } });
    await prisma.user.update({ where: { id: owner }, data: { curriculumId: curriculum } });
    await member(child);
    await member(parent, 1, 1);
    await member(peer);
    await prisma.curriculumCourse.create({ data: { curriculumId: curriculum, courseId: bare } });
    const result = await prisma.studyPlan.create({
      data: {
        userId: owner,
        name: 'Saved reference',
        isActive: false,
        semesters: {
          create: {
            semester: 'FALL',
            year: 2026,
            totalCredits: 91,
            difficultyScore: 4.9,
            courses: [{ courseId: child, position: -3 }],
          },
        },
      },
      include: { semesters: true },
    });
    plan = result.id;
    semester = result.semesters[0].id;
  });
  afterAll(async () => {
    hook = undefined;
    await prisma.user.deleteMany({ where: { id: { in: [owner, admin] } } });
    await prisma.curriculum.delete({ where: { id: curriculum } });
    await prisma.course.deleteMany({ where: { id: { in: created } } });
    await prisma.$disconnect();
  });

  it('requires a live cookie and hides foreign, missing and mismatched targets even from ADMIN', async () => {
    expect((await request(app).post(`${url()}/preview`).send(body())).status).toBe(401);
    expect((await post(body(), randomUUID())).status).toBe(401);
    await expect(
      previewOwnStudyPlanReferenceSelection(randomUUID(), plan, semester, body()),
    ).rejects.toMatchObject({ status: 401 });
    for (const response of [
      await post(body(), admin),
      await post(body(), owner, randomUUID(), semester),
      await post(body(), owner, plan, randomUUID()),
    ]) {
      expect(response.status).toBe(404);
      expect(response.body.data).toBeUndefined();
    }
  });

  it('rejects request keys, caller totals, query fields, duplicate IDs and invalid bounds without writes', async () => {
    const before = await state();
    for (const input of [
      {},
      { ...body(), requestId: randomUUID() },
      { ...body(), totalCredits: 5 },
      { ...body(), courseIds: [child, child.toUpperCase()] },
      { ...body(), courseIds: Array.from({ length: 101 }, () => randomUUID()) },
      { ...body(), expectedRevision: -1 },
      { ...body(), expectedRevision: 2147483648 },
      { ...body(), academicYear: 0 },
      { ...body(), academicYear: 2.5 },
      { ...body(), academicYear: '2' },
      { ...body(), academicSemester: 4 },
      { ...body(), expectedScope: { userId: owner, curriculumId: null } },
      { ...body(), expectedScope: { ...body().expectedScope, force: true } },
    ])
      expect((await post(input)).status).toBe(400);
    expect(
      (
        await request(app)
          .post(`${url()}/preview`)
          .set('Cookie', cookie())
          .query({ force: true })
          .send(body())
      ).status,
    ).toBe(400);
    expect(await state()).toEqual(before);
  });

  it('binds normalized scope, explicit slot, revision and proposed order with no saved snapshot or writes', async () => {
    const before = await state();
    const input = body([peer, child]);
    input.courseIds = input.courseIds.map((id) => id.toUpperCase());
    input.expectedScope.userId = owner.toUpperCase();
    input.expectedScope.curriculumId = curriculum.toUpperCase();
    const value = await check(input);
    expect(value).toMatchObject({
      scope: body().expectedScope,
      planId: plan,
      semesterId: semester,
      revision: 0,
      referenceSlot: { academicYear: 2, academicSemester: 1 },
      courseIds: [peer, child],
      validation: { readOnly: true, calendarValidated: false, degreeValidated: false },
      assessment: { basis: 'CURRENT_COMPLETIONS_ONLY', gpaPath: null },
    });
    expect(value.assessment.entries.map(({ courseId }) => courseId)).toEqual([peer, child]);
    expect(value).not.toHaveProperty('snapshot');
    expect(value).not.toHaveProperty('receipt');
    expect(await state()).toEqual(before);
  });

  it('assesses unknown, foreign and unplaced IDs without disclosing global catalog labels', async () => {
    const unknown = randomUUID();
    const value = await check(body([unknown, foreign, bare, child]));
    expect(value.assessment.entries.slice(0, 3)).toEqual(
      [unknown, foreign, bare].map((courseId) => ({
        courseId,
        blockers: ['NO_CURRENT_PLACEMENT'],
        missingPrerequisiteCount: null,
      })),
    );
    expect(JSON.stringify(value)).not.toContain('Private label');
    expect(value.assessment.entries[3].blockers).toEqual([]);
  });

  it('requires the current scope, exact revision and safely recognized stored list before assessment', async () => {
    for (const input of [
      { ...body(), expectedRevision: 1 },
      { ...body(), expectedScope: { userId: admin, curriculumId: curriculum } },
      { ...body(), expectedScope: { userId: owner, curriculumId: randomUUID() } },
    ])
      expect((await post(input)).status).toBe(409);
    await prisma.user.update({ where: { id: owner }, data: { curriculumId: null } });
    expect((await post()).status).toBe(409);
    await prisma.user.update({ where: { id: owner }, data: { curriculumId: curriculum } });
    for (const courses of [
      'old-format',
      Array.from({ length: 101 }, (_, position) => ({ courseId: randomUUID(), position })),
    ]) {
      await prisma.plannedSemester.update({ where: { id: semester }, data: { courses } });
      const response = await post();
      expect(response.status).toBe(409);
      expect(response.body.data).toBeUndefined();
    }
  });

  it.each([
    [true, false],
    [false, false],
    [false, true],
    [true, true],
  ])(
    'treats prerequisites as mandatory for strict=%s corequisite=%s',
    async (strict, corequisite) => {
      await edge(strict, corequisite);
      const value = await check();
      expect(value.assessment.entries[0]).toEqual({
        courseId: child,
        blockers: ['UNMET_PREREQUISITE'],
        missingPrerequisiteCount: 1,
      });
      await complete();
      expect((await check()).assessment.entries[0].blockers).toEqual([]);
    },
  );

  it('does not allow selected peers, planned records, other saved semesters or numeric grades to unlock prerequisites', async () => {
    await edge();
    await grade(parent, 100);
    await prisma.studentRecord.create({
      data: { userId: owner, courseId: parent, status: 'PLANNED' },
    });
    await prisma.plannedSemester.create({
      data: {
        studyPlanId: plan,
        semester: 'SPRING',
        year: 2026,
        totalCredits: 3,
        difficultyScore: 3,
        courses: [{ courseId: parent, position: 0 }],
      },
    });
    const result = await check(body([parent, child]));
    expect(result.assessment.entries[1].blockers).toContain('UNMET_PREREQUISITE');
  });

  it('reports wrong explicit placement, supports an empty selection and never infers from calendar labels', async () => {
    expect((await check({ ...body(), academicYear: 2026 })).assessment.entries[0].blockers).toEqual(
      ['NO_MATCHING_REFERENCE_SLOT'],
    );
    const empty = await check(body([]));
    expect(empty.courseIds).toEqual([]);
    expect(empty.assessment.entries).toEqual([]);
  });

  it('uses exact highest-retake member GPA and excludes physical training and foreign history', async () => {
    await prisma.curriculum.update({ where: { id: curriculum }, data: { isGpaPath: true } });
    await member(thesis, 4, 2);
    await member(physical, 1, 1);
    const input = { ...body([thesis]), academicYear: 4, academicSemester: 2 };
    expect((await check(input)).assessment.entries[0].blockers).toEqual(['GPA_UNDETERMINED']);
    await grade(parent, 70);
    await grade(parent, 10);
    await grade(physical, 100);
    await grade(foreign, 100);
    const boundary = await check(input);
    expect(boundary.assessment.gpaPath).toBe('ALTERNATIVE');
    expect(boundary.assessment.entries[0].blockers).toEqual(['GPA_EXCLUDED']);
    await grade(parent, 70.01);
    const above = await check(input);
    expect(above.assessment.gpaPath).toBe('THESIS');
    expect(above.assessment.entries[0].blockers).toEqual([]);
  });

  it('keeps a coherent snapshot when progress changes after its version read', async () => {
    await edge();
    await complete();
    hook = async () => {
      await prisma.studentRecord.deleteMany({ where: { userId: owner } });
    };
    expect((await check()).assessment.entries[0].blockers).toEqual([]);
    expect((await check()).assessment.entries[0].blockers).toEqual(['UNMET_PREREQUISITE']);
  });

  it('keeps coherent GPA evidence and independently rechecks changed grades during saving', async () => {
    await prisma.curriculum.update({ where: { id: curriculum }, data: { isGpaPath: true } });
    await member(thesis, 4, 2);
    await grade(parent, 70);
    const input = { ...body([thesis]), academicYear: 4, academicSemester: 2 };
    hook = async () => {
      await grade(parent, 100);
    };
    const boundary = await check(input);
    expect(boundary.assessment.gpaPath).toBe('ALTERNATIVE');
    expect(boundary.assessment.entries[0].blockers).toEqual(['GPA_EXCLUDED']);
    const clear = await check(input);
    expect(clear.assessment.gpaPath).toBe('THESIS');
    expect(clear.assessment.entries[0].blockers).toEqual([]);
    await prisma.gradeAttempt.deleteMany({ where: { userId: owner } });
    await grade(parent, 70);
    const before = await state();
    const response = await request(app)
      .put(url())
      .set('Cookie', cookie())
      .send({ ...input, requestId: randomUUID() });
    expect(response.status).toBe(409);
    expect(await state()).toEqual(before);
  });

  it('does not authorize a subsequent save when completed prerequisites change after a clear check', async () => {
    await edge();
    await complete();
    expect((await check()).assessment.entries[0].blockers).toEqual([]);
    await prisma.studentRecord.deleteMany({ where: { userId: owner } });
    const before = await state();
    const response = await request(app)
      .put(url())
      .set('Cookie', cookie())
      .send({ ...body(), requestId: randomUUID() });
    expect(response.status).toBe(409);
    expect(await state()).toEqual(before);
  });
});

describe('strict proposed reference preview contracts', () => {
  const id = () => randomUUID();
  const fixture = (): OwnStudyPlanReferenceSelectionPreviewDTO => {
    const courseId = id();
    return {
      scope: { userId: id(), curriculumId: id() },
      planId: id(),
      semesterId: id(),
      revision: 0,
      referenceSlot: { academicYear: 2, academicSemester: 1 },
      courseIds: [courseId],
      assessment: {
        basis: 'CURRENT_COMPLETIONS_ONLY',
        gpaPath: null,
        entries: [{ courseId, blockers: [], missingPrerequisiteCount: 0 }],
      },
      validation: { readOnly: true, calendarValidated: false, degreeValidated: false },
    };
  };
  it('rejects a request key and unsupported request fields without stripping them', () => {
    const value = fixture();
    const body = {
      expectedScope: value.scope,
      expectedRevision: 0,
      ...value.referenceSlot,
      courseIds: value.courseIds,
    };
    expect(OwnStudyPlanReferenceSelectionPreviewBodySchema.safeParse(body).success).toBe(true);
    expect(
      OwnStudyPlanReferenceSelectionPreviewBodySchema.safeParse({ ...body, requestId: id() })
        .success,
    ).toBe(false);
  });
  it('rejects omitted, reordered, duplicated and invalid count assessments', () => {
    const original = fixture();
    for (const entries of [
      [],
      [{ ...original.assessment.entries[0], courseId: id() }],
      [...original.assessment.entries, ...original.assessment.entries],
      [{ ...original.assessment.entries[0], missingPrerequisiteCount: 1 }],
      [
        {
          ...original.assessment.entries[0],
          blockers: ['NO_CURRENT_PLACEMENT'],
          missingPrerequisiteCount: 0,
        },
      ],
    ])
      expect(
        OwnStudyPlanReferenceSelectionPreviewSchema.safeParse({
          ...original,
          assessment: { ...original.assessment, entries },
        }).success,
      ).toBe(false);
  });
  it('rejects GPA evidence inconsistent with the explicit slot or path and any saving claim', () => {
    for (const kind of [
      'wrong-slot',
      'unknown-excluded',
      'known-undetermined',
      'calendar',
      'write',
      'extra',
    ]) {
      const value = fixture();
      if (kind === 'wrong-slot' || kind === 'unknown-excluded')
        value.assessment.entries[0].blockers = ['GPA_EXCLUDED'];
      if (kind !== 'wrong-slot') value.referenceSlot = { academicYear: 4, academicSemester: 2 };
      if (kind === 'known-undetermined') {
        value.assessment.gpaPath = 'THESIS';
        value.assessment.entries[0].blockers = ['GPA_UNDETERMINED'];
      }
      const input =
        kind === 'calendar'
          ? { ...value, validation: { ...value.validation, calendarValidated: true } }
          : kind === 'write'
            ? { ...value, validation: { ...value.validation, readOnly: false } }
            : kind === 'extra'
              ? { ...value, savingAuthorized: true }
              : value;
      expect(OwnStudyPlanReferenceSelectionPreviewSchema.safeParse(input).success).toBe(false);
    }
  });
});
