import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import request from 'supertest';
import {
  OwnStudyPlanReferenceReviewBodySchema,
  OwnStudyPlanReferenceReviewSchema,
  type OwnStudyPlanReferenceReviewDTO,
} from '@iu-study-planner/shared';
import app, { prisma } from '../index';
import { AUTH_COOKIE_NAME, issueToken } from '../services/authService';
import { reviewOwnStudyPlanReferenceSlot } from '../services/ownStudyPlanReferenceReview';
import { readStudentGrades } from '../services/studentGradeContext';

describe('cookie-owned explicit saved reference-slot review (PostgreSQL)', () => {
  const prefix = `reference-review-${randomUUID()}`;
  const owner = randomUUID();
  const admin = randomUUID();
  const curriculum = randomUUID();
  const otherCurriculum = randomUUID();
  const child = randomUUID();
  const parent = randomUUID();
  const peer = randomUUID();
  const bare = randomUUID();
  const foreign = randomUUID();
  const missing = randomUUID();
  const createdIds: string[] = [child, parent, peer, bare, foreign];
  let thesis: string;
  let physical: string;
  let plan: string;
  let semester: string;
  let foreignPlan: string;
  let afterOwnerRead: (() => Promise<void>) | undefined;
  const cookie = (id = owner) => `${AUTH_COOKIE_NAME}=${issueToken(id)}`;
  const body = (
    academicYear = 2,
    academicSemester = 1,
    curriculumId: string | null = curriculum,
  ) => ({
    expectedScope: { userId: owner, curriculumId },
    academicYear,
    academicSemester,
  });
  const post = (input: object = body(), id = owner, planId = plan, semesterId = semester) =>
    request(app)
      .post(`/api/users/me/study-plans/${planId}/semesters/${semesterId}/reference-review`)
      .set('Cookie', cookie(id))
      .send(input);
  const save = (courses: Prisma.InputJsonValue) =>
    prisma.plannedSemester.update({ where: { id: semester }, data: { courses } });
  const assigned = (id = curriculum) =>
    prisma.user.update({ where: { id: owner }, data: { curriculumId: id } });
  const member = (
    courseId: string,
    year: number | null = 2,
    academicSemester: number | null = 1,
    id = curriculum,
  ) =>
    prisma.curriculumCourse.create({
      data: {
        curriculumId: id,
        courseId,
        placements: { create: { sourceOrder: 0, academicYear: year, academicSemester } },
      },
    });
  const grade = (courseId: string, score: number) =>
    prisma.gradeAttempt.create({
      data: { userId: owner, requestId: randomUUID(), courseId, score },
    });
  const complete = (courseId: string) =>
    prisma.studentRecord.create({ data: { userId: owner, courseId, status: 'COMPLETED' } });
  const assess = async (input = body()) => {
    const response = await post(input);
    expect(response.status).toBe(200);
    return OwnStudyPlanReferenceReviewSchema.parse(response.body.data);
  };
  const entries = (reply: OwnStudyPlanReferenceReviewDTO) => {
    if (reply.review.status !== 'ASSESSED') throw new Error('Expected an assessment');
    return reply.review.entries;
  };
  beforeAll(async () => {
    prisma.$use(async (params, next) => {
      const result: unknown = await next(params);
      if (
        afterOwnerRead &&
        params.runInTransaction &&
        params.model === 'User' &&
        params.action === 'findUnique' &&
        params.args?.where?.id === owner
      ) {
        const hook = afterOwnerRead;
        afterOwnerRead = undefined;
        await hook();
      }
      return result;
    });
    await prisma.curriculum.createMany({
      data: [curriculum, otherCurriculum].map((id, index) => ({
        id,
        code: `${prefix}-${index}`,
        name: 'Unverified reference',
        school: 'CSE',
        degree: 'Bachelor',
        programUrl: 'https://example.test/reference',
        isGpaPath: false,
      })),
    });
    await prisma.user.createMany({
      data: [owner, admin].map((id, index) => ({
        id,
        studentId: `${prefix}-${index}`,
        email: `${id}@example.test`,
        name: 'Private',
        role: index ? 'ADMIN' : 'STUDENT',
      })),
    });
    await prisma.course.createMany({
      data: createdIds.map((id, index) => ({
        id,
        code: `${prefix}-${index}`,
        name: 'Current label',
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
            data: { code, name: 'Fixture', credits: 3, difficultyLevel: 3 },
          })
        ).id;
      if (!existing) createdIds.push(id);
      if (code === 'IT058IU') thesis = id;
      else physical = id;
    }
  });
  beforeEach(async () => {
    afterOwnerRead = undefined;
    await prisma.studyPlan.deleteMany({ where: { userId: { in: [owner, admin] } } });
    await prisma.studentRecord.deleteMany({ where: { userId: owner } });
    await prisma.gradeAttempt.deleteMany({ where: { userId: owner } });
    await prisma.curriculumCourse.deleteMany({
      where: { curriculumId: { in: [curriculum, otherCurriculum] } },
    });
    await prisma.curriculum.update({ where: { id: curriculum }, data: { isGpaPath: false } });
    await assigned();
    await member(child);
    await member(parent, 1, 1);
    await member(peer);
    await prisma.curriculumCourse.create({ data: { curriculumId: curriculum, courseId: bare } });
    await member(foreign, 2, 1, otherCurriculum);
    const row = await prisma.studyPlan.create({
      data: {
        userId: owner,
        name: 'Historical reference',
        semesters: {
          create: {
            semester: 'FALL',
            year: 2026,
            totalCredits: -77,
            courses: [{ courseId: child, position: -3 }],
          },
        },
      },
      include: { semesters: true },
    });
    plan = row.id;
    semester = row.semesters[0].id;
    foreignPlan = (await prisma.studyPlan.create({ data: { userId: admin, name: 'Foreign' } })).id;
  });
  afterAll(async () => {
    afterOwnerRead = undefined;
    await prisma.user.deleteMany({ where: { id: { in: [owner, admin] } } });
    await prisma.curriculum.deleteMany({ where: { id: { in: [curriculum, otherCurriculum] } } });
    await prisma.course.deleteMany({ where: { id: { in: createdIds } } });
    await prisma.$disconnect();
  });
  it('requires live cookie ownership, including direct service calls', async () => {
    const url = `/api/users/me/study-plans/${plan}/semesters/${semester}/reference-review`;
    expect((await request(app).post(url).send(body())).status).toBe(401);
    expect((await post(body(), randomUUID())).status).toBe(401);
    await expect(
      reviewOwnStudyPlanReferenceSlot(randomUUID(), plan, semester, body()),
    ).rejects.toMatchObject({ status: 401 });
  });
  it('hides foreign and missing plans/semesters uniformly, even from admins', async () => {
    const responses = await Promise.all([
      post(body(), admin),
      post(body(), owner, foreignPlan),
      post(body(), owner, randomUUID()),
      post(body(), owner, plan, randomUUID()),
    ]);
    for (const response of responses) {
      expect(response.status).toBe(404);
      expect(response.body).toEqual(responses[0].body);
    }
  });
  it('rejects scope changes and strict malformed input instead of choosing defaults', async () => {
    expect(
      (await post({ ...body(), expectedScope: { userId: admin, curriculumId: curriculum } }))
        .status,
    ).toBe(409);
    expect((await post(body(2, 1, null))).status).toBe(409);
    for (const input of [
      {},
      { ...body(), academicYear: 0 },
      { ...body(), academicYear: 1.5 },
      { ...body(), academicYear: Number.MAX_SAFE_INTEGER + 1 },
      { ...body(), academicSemester: 4 },
      { ...body(), userId: admin },
      { ...body(), expectedScope: { ...body().expectedScope, force: true } },
    ])
      expect((await post(input)).status).toBe(400);
    expect((await post().query({ curriculumId: curriculum })).status).toBe(400);
    expect((await post(body(), owner, 'bad')).status).toBe(400);
    expect((await post(body(), owner, plan, 'bad')).status).toBe(400);
  });
  it('normalizes IDs and leaves the saved calendar, credit references and all academic records unchanged', async () => {
    const before = await prisma.studyPlan.findUnique({
      where: { id: plan },
      include: { semesters: true },
    });
    const response = await post(
      {
        ...body(),
        expectedScope: { userId: owner.toUpperCase(), curriculumId: curriculum.toUpperCase() },
      },
      owner,
      plan.toUpperCase(),
      semester.toUpperCase(),
    );
    expect(response.status).toBe(200);
    const value = OwnStudyPlanReferenceReviewSchema.parse(response.body.data);
    expect(value.referenceSlot).toEqual({ academicYear: 2, academicSemester: 1 });
    expect(value.snapshot.semester).toMatchObject({
      year: 2026,
      semester: 'FALL',
      storedTotalCredits: -77,
    });
    expect(value.validation).toEqual({
      calendarValidated: false,
      originalCurriculumKnown: false,
      savingEnabled: false,
    });
    expect(entries(value)).toEqual([
      { courseId: child, blockers: [], missingPrerequisiteCount: 0 },
    ]);
    expect(
      await prisma.studyPlan.findUnique({ where: { id: plan }, include: { semesters: true } }),
    ).toEqual(before);
    expect(await prisma.studentRecord.count({ where: { userId: owner } })).toBe(0);
    expect(await prisma.gradeAttempt.count({ where: { userId: owner } })).toBe(0);
  });
  it('does not assess an unassigned account or unsupported/overlimit saved content', async () => {
    await prisma.user.update({ where: { id: owner }, data: { curriculumId: null } });
    expect((await assess(body(2, 1, null))).review).toEqual({
      status: 'UNAVAILABLE',
      reason: 'NO_ASSIGNED_CURRICULUM',
    });
    await save('private historical JSON');
    expect((await assess(body(2, 1, null))).review).toEqual({
      status: 'UNAVAILABLE',
      reason: 'NO_ASSIGNED_CURRICULUM',
    });
    await assigned();
    for (const courses of [
      'private historical JSON',
      Array.from({ length: 101 }, (_, position) => ({ courseId: randomUUID(), position })),
    ]) {
      await save(courses);
      expect((await assess()).review).toEqual({
        status: 'UNAVAILABLE',
        reason: 'COURSE_REFERENCES_UNAVAILABLE',
      });
    }
    const exactJson = `[{"courseId":"${child}","position":1.00000000000000000001}]`;
    await prisma.$executeRaw`UPDATE planned_semesters SET courses = ${exactJson}::jsonb WHERE id = ${semester}`;
    expect((await assess()).review).toEqual({
      status: 'UNAVAILABLE',
      reason: 'COURSE_REFERENCES_UNAVAILABLE',
    });
  });
  it('recognizes an empty saved selection without inventing a schedule', async () => {
    await save([]);
    expect(entries(await assess())).toEqual([]);
  });
  it('preserves order and assesses only current placed members; bare/foreign/missing identities stay unassessed', async () => {
    const ids = [missing, bare, child, foreign, parent];
    await save(ids.map((courseId) => ({ courseId, position: -8 })));
    const value = await assess();
    expect(entries(value)).toEqual([
      ...[missing, bare].map((courseId) => ({
        courseId,
        blockers: ['NO_CURRENT_PLACEMENT'],
        missingPrerequisiteCount: null,
      })),
      { courseId: child, blockers: [], missingPrerequisiteCount: 0 },
      { courseId: foreign, blockers: ['NO_CURRENT_PLACEMENT'], missingPrerequisiteCount: null },
      { courseId: parent, blockers: ['NO_MATCHING_REFERENCE_SLOT'], missingPrerequisiteCount: 0 },
    ]);
  });
  it('requires every contextual edge regardless corequisite/recommended flags; saved peers/other semesters never unlock it', async () => {
    await prisma.curriculumPrerequisite.createMany({
      data: [parent, peer, bare].map((prerequisiteId) => ({
        curriculumId: curriculum,
        courseId: child,
        prerequisiteId,
        isCorequisite: true,
        isStrict: false,
      })),
    });
    await save([
      { courseId: child, position: 0 },
      { courseId: peer, position: 1 },
    ]);
    await prisma.plannedSemester.create({
      data: {
        studyPlanId: plan,
        semester: 'SPRING',
        year: 2025,
        totalCredits: 3,
        courses: [{ courseId: parent, position: 0 }],
      },
    });
    await complete(bare); // Current membership satisfies a recorded parent even without a placement.
    await grade(parent, 100); // A score alone is not a completion.
    expect(entries(await assess())[0]).toEqual({
      courseId: child,
      blockers: ['UNMET_PREREQUISITE'],
      missingPrerequisiteCount: 2,
    });
    await complete(parent);
    await prisma.studentRecord.create({
      data: { userId: owner, courseId: peer, status: 'IN_PROGRESS' },
    });
    expect(entries(await assess())[0].missingPrerequisiteCount).toBe(1);
    await prisma.studentRecord.update({
      where: { userId_courseId: { userId: owner, courseId: peer } },
      data: { status: 'COMPLETED' },
    });
    expect(entries(await assess())[0].blockers).toEqual([]);
  });
  it('uses context edges only and blocks incomplete cyclic parents naturally', async () => {
    await prisma.curriculumPrerequisite.createMany({
      data: [
        { curriculumId: curriculum, courseId: child, prerequisiteId: peer },
        { curriculumId: curriculum, courseId: peer, prerequisiteId: child },
      ],
    });
    await member(child, 2, 1, otherCurriculum);
    await prisma.curriculumPrerequisite.create({
      data: { curriculumId: otherCurriculum, courseId: child, prerequisiteId: foreign },
    });
    await save([
      { courseId: child, position: 0 },
      { courseId: peer, position: 1 },
    ]);
    expect(
      entries(await assess()).map(({ missingPrerequisiteCount }) => missingPrerequisiteCount),
    ).toEqual([1, 1]);
    await complete(peer);
    expect(entries(await assess())[0].blockers).toEqual([]);
  });
  it('uses any matching duplicate placement and never borrows the stored calendar as a reference slot', async () => {
    const row = await prisma.curriculumCourse.findUniqueOrThrow({
      where: { curriculumId_courseId: { curriculumId: curriculum, courseId: parent } },
    });
    await prisma.curriculumPlacement.createMany({
      data: [1, 2].map((sourceOrder) => ({
        curriculumCourseId: row.id,
        sourceOrder,
        academicYear: 2,
        academicSemester: 1,
      })),
    });
    await save([{ courseId: parent, position: 0 }]);
    expect(entries(await assess())[0].blockers).toEqual([]);
    expect(entries(await assess(body(2026, 1)))[0].blockers).toEqual([
      'NO_MATCHING_REFERENCE_SLOT',
    ]);
  });
  it('does not apply a GPA fork to a nonfork curriculum', async () => {
    await member(thesis, 4, 2);
    await save([{ courseId: thesis, position: 0 }]);
    const value = await assess(body(4, 2));
    expect(value.review).toMatchObject({ gpaPath: null });
    expect(entries(value)[0].blockers).toEqual([]);
  });
  it('marks matching fork courses undetermined without eligible numeric grades and ignores physical/foreign scores', async () => {
    await prisma.curriculum.update({ where: { id: curriculum }, data: { isGpaPath: true } });
    await member(thesis, 4, 2);
    await member(physical, 1, 1);
    const childMember = await prisma.curriculumCourse.findUniqueOrThrow({
      where: { curriculumId_courseId: { curriculumId: curriculum, courseId: child } },
    });
    await prisma.curriculumPlacement.updateMany({
      where: { curriculumCourseId: childMember.id },
      data: { academicYear: 4, academicSemester: 2 },
    });
    await grade(physical, 100);
    await grade(foreign, 100);
    await save([
      { courseId: thesis, position: 0 },
      { courseId: child, position: 1 },
    ]);
    expect(entries(await assess(body(4, 2))).map(({ blockers }) => blockers)).toEqual([
      ['GPA_UNDETERMINED'],
      ['GPA_UNDETERMINED'],
    ]);
    expect(entries(await assess(body(3, 2))).map(({ blockers }) => blockers)).toEqual([
      ['NO_MATCHING_REFERENCE_SLOT'],
      ['NO_MATCHING_REFERENCE_SLOT'],
    ]);
  });
  it.each([
    { score: 70, path: 'ALTERNATIVE', thesisBlockers: ['GPA_EXCLUDED'], alternativeBlockers: [] },
    { score: 70.00001, path: 'THESIS', thesisBlockers: [], alternativeBlockers: ['GPA_EXCLUDED'] },
  ])(
    'uses exact highest-retake GPA path at $score without rounding eligibility',
    async ({ score, path, thesisBlockers, alternativeBlockers }) => {
      await prisma.curriculum.update({ where: { id: curriculum }, data: { isGpaPath: true } });
      await member(thesis, 4, 2);
      const row = await prisma.curriculumCourse.findUniqueOrThrow({
        where: { curriculumId_courseId: { curriculumId: curriculum, courseId: child } },
      });
      await prisma.curriculumPlacement.updateMany({
        where: { curriculumCourseId: row.id },
        data: { academicYear: 4, academicSemester: 2 },
      });
      await save([
        { courseId: thesis, position: 0 },
        { courseId: child, position: 1 },
      ]);
      await grade(parent, 10);
      await grade(parent, score);
      await grade(parent, 20);
      const value = await assess(body(4, 2));
      expect(value.review).toMatchObject({ gpaPath: path });
      expect(entries(value).map(({ blockers }) => blockers)).toEqual([
        thesisBlockers,
        alternativeBlockers,
      ]);
    },
  );
  it('uses decimal-exact credit weighting at 70, excluding letter history and foreign scores', async () => {
    await prisma.curriculum.update({ where: { id: curriculum }, data: { isGpaPath: true } });
    await member(thesis, 4, 2);
    await prisma.course.update({ where: { id: child }, data: { credits: 1 } });
    try {
      await grade(child, 0.16);
      await grade(parent, 93.28); // (0.16 + 93.28 * 3) / 4 = 70 exactly.
      await grade(foreign, 100);
      await prisma.studentRecord.create({
        data: { userId: owner, courseId: peer, status: 'COMPLETED', grade: 'A+', gradePoints: 4 },
      });
      await save([{ courseId: thesis, position: 0 }]);
      const value = await assess(body(4, 2));
      expect(value.review).toMatchObject({ gpaPath: 'ALTERNATIVE' });
      expect(entries(value)[0].blockers).toEqual(['GPA_EXCLUDED']);
    } finally {
      await prisma.course.update({ where: { id: child }, data: { credits: 3 } });
    }
  });
  it('matches the grade dashboard GPA path for a numeric bare member and counts its completion as a prerequisite', async () => {
    await prisma.curriculum.update({ where: { id: curriculum }, data: { isGpaPath: true } });
    await member(thesis, 4, 2);
    await save([{ courseId: thesis, position: 0 }]);
    await grade(bare, 90);
    await complete(bare);
    await prisma.curriculumPrerequisite.create({
      data: {
        curriculumId: curriculum,
        courseId: thesis,
        prerequisiteId: bare,
      },
    });
    const grades = await readStudentGrades(owner);
    const value = await assess(body(4, 2));
    expect(grades.summary.gpaPath).toBe('THESIS');
    expect(value.review).toMatchObject({ gpaPath: grades.summary.gpaPath });
    expect(entries(value)).toEqual([
      { courseId: thesis, blockers: [], missingPrerequisiteCount: 0 },
    ]);
  });
  it('keeps all review evidence in one snapshot while committed writers change scope, JSON, membership, edges, records and grades', async () => {
    await prisma.curriculum.update({ where: { id: curriculum }, data: { isGpaPath: true } });
    await member(thesis, 4, 2);
    await save([{ courseId: thesis, position: 0 }]);
    await grade(parent, 90);
    await prisma.curriculumPrerequisite.create({
      data: { curriculumId: curriculum, courseId: thesis, prerequisiteId: parent },
    });
    await complete(parent);
    afterOwnerRead = async () => {
      await prisma.$transaction([
        prisma.user.update({ where: { id: owner }, data: { curriculumId: otherCurriculum } }),
        prisma.studyPlan.update({ where: { id: plan }, data: { name: 'Changed' } }),
        prisma.plannedSemester.update({ where: { id: semester }, data: { courses: [] } }),
        prisma.studentRecord.deleteMany({ where: { userId: owner } }),
        prisma.gradeAttempt.deleteMany({ where: { userId: owner } }),
        prisma.curriculumCourse.deleteMany({
          where: { curriculumId: curriculum, courseId: thesis },
        }),
      ]);
    };
    const previous = await assess(body(4, 2));
    expect(previous.snapshot.scope.curriculumId).toBe(curriculum);
    expect(previous.snapshot.plan.name).toBe('Historical reference');
    expect(previous.review).toMatchObject({ gpaPath: 'THESIS' });
    expect(entries(previous)).toEqual([
      { courseId: thesis, blockers: [], missingPrerequisiteCount: 0 },
    ]);
    expect((await post(body(4, 2))).status).toBe(409);
    const fresh = await assess(body(4, 2, otherCurriculum));
    expect(fresh.snapshot.plan.name).toBe('Changed');
    expect(entries(fresh)).toEqual([]);
  });
});

describe('explicit saved reference review contract', () => {
  const owner = randomUUID();
  const curriculum = randomUUID();
  const child = randomUUID();
  const make = (): OwnStudyPlanReferenceReviewDTO => ({
    snapshot: {
      visibility: 'CURRENT_ACCOUNT_ONLY',
      scope: { userId: owner, curriculumId: curriculum, studyPlansValidated: false },
      plan: {
        id: randomUUID(),
        name: 'Historical',
        description: null,
        isActive: false,
        createdAt: '2026-10-16T00:00:00.000Z',
        updatedAt: '2026-10-16T00:00:00.000Z',
        semesterCount: 1,
      },
      semester: {
        id: randomUUID(),
        semester: 'FALL',
        year: 2026,
        storedTotalCredits: -99,
        createdAt: '2026-10-16T00:00:00.000Z',
        updatedAt: '2026-10-16T00:00:00.000Z',
      },
      courseReferences: {
        status: 'RECOGNIZED',
        order: 'STORED_ARRAY_ORDER',
        entries: [
          {
            courseId: child,
            storedPosition: -4,
            currentCurriculumMembership: 'PLACED_MEMBER',
            catalog: { code: 'CURRENT', name: 'Current label' },
          },
        ],
      },
    },
    referenceSlot: { academicYear: 2, academicSemester: 1 },
    review: {
      status: 'ASSESSED',
      basis: 'CURRENT_COMPLETIONS_ONLY',
      gpaPath: null,
      entries: [{ courseId: child, blockers: [], missingPrerequisiteCount: 0 }],
    },
    validation: { calendarValidated: false, originalCurriculumKnown: false, savingEnabled: false },
  });
  const mutateEntry = (
    edit: (
      entry: Extract<
        OwnStudyPlanReferenceReviewDTO['review'],
        { status: 'ASSESSED' }
      >['entries'][number],
    ) => void,
  ) => {
    const value = make();
    if (value.review.status === 'ASSESSED') edit(value.review.entries[0]);
    return OwnStudyPlanReferenceReviewSchema.safeParse(value).success;
  };
  it('accepts the explicit bounded slot and rejects coerced, unsafe, missing and extra input', () => {
    const valid = {
      expectedScope: { userId: owner.toUpperCase(), curriculumId: null },
      academicYear: Number.MAX_SAFE_INTEGER,
      academicSemester: 3,
    };
    expect(OwnStudyPlanReferenceReviewBodySchema.parse(valid).expectedScope.userId).toBe(owner);
    for (const bad of [
      { ...valid, academicYear: '2' },
      { ...valid, academicYear: 0 },
      { ...valid, academicYear: Number.MAX_SAFE_INTEGER + 1 },
      { ...valid, academicSemester: 0 },
      { ...valid, force: true },
      { ...valid, expectedScope: { userId: owner } },
    ])
      expect(OwnStudyPlanReferenceReviewBodySchema.safeParse(bad).success).toBe(false);
  });
  it('accepts zero unmet parents and nonempty blockers only with coherent counts', () => {
    expect(OwnStudyPlanReferenceReviewSchema.safeParse(make()).success).toBe(true);
    expect(
      mutateEntry((entry) => {
        entry.blockers = ['UNMET_PREREQUISITE'];
        entry.missingPrerequisiteCount = 2;
      }),
    ).toBe(true);
    expect(
      mutateEntry((entry) => {
        entry.missingPrerequisiteCount = 1;
      }),
    ).toBe(false);
    expect(
      mutateEntry((entry) => {
        entry.blockers = ['UNMET_PREREQUISITE'];
      }),
    ).toBe(false);
    expect(
      mutateEntry((entry) => {
        entry.missingPrerequisiteCount = null;
      }),
    ).toBe(false);
    expect(
      mutateEntry((entry) => {
        entry.missingPrerequisiteCount = -1;
      }),
    ).toBe(false);
    expect(
      mutateEntry((entry) => {
        entry.blockers = ['UNMET_PREREQUISITE', 'UNMET_PREREQUISITE'];
        entry.missingPrerequisiteCount = 1;
      }),
    ).toBe(false);
  });
  it('rejects entry reordering, missing assessment rows and mismatched placement evidence', () => {
    expect(
      mutateEntry((entry) => {
        entry.courseId = randomUUID();
      }),
    ).toBe(false);
    expect(
      mutateEntry((entry) => {
        entry.blockers = ['NO_CURRENT_PLACEMENT'];
        entry.missingPrerequisiteCount = null;
      }),
    ).toBe(false);
    const value = make();
    if (value.review.status === 'ASSESSED') value.review.entries = [];
    expect(OwnStudyPlanReferenceReviewSchema.safeParse(value).success).toBe(false);
    if (value.snapshot.courseReferences.status === 'RECOGNIZED')
      value.snapshot.courseReferences.entries[0].currentCurriculumMembership =
        'NO_CURRENT_PLACEMENT';
    value.review = {
      status: 'ASSESSED',
      basis: 'CURRENT_COMPLETIONS_ONLY',
      gpaPath: null,
      entries: [
        { courseId: child, blockers: ['NO_CURRENT_PLACEMENT'], missingPrerequisiteCount: null },
      ],
    };
    expect(OwnStudyPlanReferenceReviewSchema.safeParse(value).success).toBe(true);
    if (value.review.status === 'ASSESSED')
      value.review.entries[0].blockers.push('UNMET_PREREQUISITE');
    expect(OwnStudyPlanReferenceReviewSchema.safeParse(value).success).toBe(false);
  });
  it('requires matching unavailable reasons and refuses to assess unavailable or unassigned snapshots', () => {
    const value = make();
    value.review = { status: 'UNAVAILABLE', reason: 'COURSE_REFERENCES_UNAVAILABLE' };
    expect(OwnStudyPlanReferenceReviewSchema.safeParse(value).success).toBe(false);
    value.snapshot.courseReferences = { status: 'UNAVAILABLE', reason: 'READER_LIMIT' };
    expect(OwnStudyPlanReferenceReviewSchema.safeParse(value).success).toBe(true);
    value.snapshot.scope.curriculumId = null;
    expect(OwnStudyPlanReferenceReviewSchema.safeParse(value).success).toBe(false);
    value.review = { status: 'UNAVAILABLE', reason: 'NO_ASSIGNED_CURRICULUM' };
    expect(OwnStudyPlanReferenceReviewSchema.safeParse(value).success).toBe(true);
    value.review = {
      status: 'ASSESSED',
      basis: 'CURRENT_COMPLETIONS_ONLY',
      gpaPath: null,
      entries: [],
    };
    expect(OwnStudyPlanReferenceReviewSchema.safeParse(value).success).toBe(false);
  });
  it('binds GPA blockers to slot 4:2 and mutually exclusive known or undetermined paths', () => {
    const value = make();
    if (value.review.status !== 'ASSESSED') throw new Error('Fixture');
    value.review.entries[0].blockers = ['GPA_UNDETERMINED'];
    expect(OwnStudyPlanReferenceReviewSchema.safeParse(value).success).toBe(false);
    value.referenceSlot = { academicYear: 4, academicSemester: 2 };
    expect(OwnStudyPlanReferenceReviewSchema.safeParse(value).success).toBe(true);
    value.review.gpaPath = 'THESIS';
    expect(OwnStudyPlanReferenceReviewSchema.safeParse(value).success).toBe(false);
    value.review.entries[0].blockers = ['GPA_EXCLUDED'];
    expect(OwnStudyPlanReferenceReviewSchema.safeParse(value).success).toBe(true);
    value.review.entries[0].blockers = ['GPA_EXCLUDED', 'NO_MATCHING_REFERENCE_SLOT'];
    expect(OwnStudyPlanReferenceReviewSchema.safeParse(value).success).toBe(false);
    value.review.entries[0].blockers = ['GPA_EXCLUDED', 'GPA_UNDETERMINED'];
    expect(OwnStudyPlanReferenceReviewSchema.safeParse(value).success).toBe(false);
  });
  it('refuses private fields, unknown blockers and claims that saving/calendar/history are verified', () => {
    const value = make();
    for (const validation of [
      { ...value.validation, savingEnabled: true },
      { ...value.validation, calendarValidated: true },
      { ...value.validation, originalCurriculumKnown: true },
    ])
      expect(OwnStudyPlanReferenceReviewSchema.safeParse({ ...value, validation }).success).toBe(
        false,
      );
    expect(
      OwnStudyPlanReferenceReviewSchema.safeParse({ ...value, privateGrade: 90 }).success,
    ).toBe(false);
    if (value.review.status !== 'ASSESSED') throw new Error('Fixture');
    expect(
      OwnStudyPlanReferenceReviewSchema.safeParse({
        ...value,
        review: {
          ...value.review,
          entries: [{ ...value.review.entries[0], blockers: ['ELIGIBLE'] }],
        },
      }).success,
    ).toBe(false);
  });
});
