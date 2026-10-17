import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import request from 'supertest';
import {
  OwnStudyPlanReferenceSelectionBodySchema,
  OwnStudyPlanReferenceSelectionStateSchema,
  OwnStudyPlanReferenceSelectionResultSchema,
  type OwnStudyPlanReferenceSelectionBodyDTO,
} from '@iu-study-planner/shared';
import app, { prisma } from '../index';
import { AUTH_COOKIE_NAME, issueToken } from '../services/authService';
import { decorateCourseDifficulties } from '../services/courseRatings';
import {
  saveOwnStudyPlanReferenceSelection,
  readOwnStudyPlanReferenceSelection,
} from '../services/ownStudyPlanReferenceSelection';
import {
  createPlannedSemester,
  updatePlannedSemester,
  deletePlannedSemester,
} from '../services/plannedSemesters';

describe('atomic cookie-owned saved reference selection (PostgreSQL)', () => {
  const owner = randomUUID();
  const admin = randomUUID();
  const curriculum = randomUUID();
  const otherCurriculum = randomUUID();
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
  let otherPlan: string;
  let otherSemester: string;
  let versionHook: (() => Promise<void>) | undefined;
  let beforeReceipt: (() => Promise<void>) | undefined;
  const cookie = (id = owner) => `${AUTH_COOKIE_NAME}=${issueToken(id)}`;
  const url = (planId = plan, semesterId = semester) =>
    `/api/users/me/study-plans/${planId}/semesters/${semesterId}/reference-selection`;
  const body = (courseIds: string[] = [child]): OwnStudyPlanReferenceSelectionBodyDTO => ({
    requestId: randomUUID(),
    expectedScope: { userId: owner, curriculumId: curriculum },
    expectedRevision: 0,
    academicYear: 2,
    academicSemester: 1,
    courseIds,
  });
  const put = (input: object = body(), actor = owner, planId = plan, semesterId = semester) =>
    request(app).put(url(planId, semesterId)).set('Cookie', cookie(actor)).send(input);
  const get = (actor = owner) => request(app).get(url()).set('Cookie', cookie(actor));
  const save = (courses: Prisma.InputJsonValue) =>
    prisma.plannedSemester.update({ where: { id: semester }, data: { courses } });
  const stored = () => prisma.plannedSemester.findUniqueOrThrow({ where: { id: semester } });
  const member = (courseId: string, year = 2, academicSemester = 1, id = curriculum) =>
    prisma.curriculumCourse.create({
      data: {
        curriculumId: id,
        courseId,
        placements: { create: { sourceOrder: 0, academicYear: year, academicSemester } },
      },
    });
  const complete = (courseId: string) =>
    prisma.studentRecord.create({ data: { userId: owner, courseId, status: 'COMPLETED' } });
  const grade = (courseId: string, score: number) =>
    prisma.gradeAttempt.create({
      data: { userId: owner, requestId: randomUUID(), courseId, score },
    });
  const parsed = async (input = body()) => {
    const response = await put(input);
    expect(response.status).toBe(200);
    return OwnStudyPlanReferenceSelectionResultSchema.parse(response.body.data);
  };
  beforeAll(async () => {
    prisma.$use(async (params, next) => {
      if (
        beforeReceipt &&
        params.runInTransaction &&
        params.model === 'ReferenceSelectionReceipt' &&
        params.action === 'create'
      )
        await beforeReceipt();
      const result: unknown = await next(params);
      if (
        versionHook &&
        params.runInTransaction &&
        params.model === 'PlannedSemester' &&
        params.action === 'findFirst' &&
        params.args?.select?.revision
      )
        await versionHook();
      return result;
    });
    await prisma.curriculum.createMany({
      data: [curriculum, otherCurriculum].map((id) => ({
        id,
        code: `ref-selection-${id}`,
        name: 'Unverified',
        school: 'CSE',
        degree: 'Bachelor',
        programUrl: 'https://example.test/reference',
      })),
    });
    await prisma.user.createMany({
      data: [owner, admin].map((id, i) => ({
        id,
        studentId: id,
        email: `${id}@example.test`,
        name: 'Private',
        role: i ? 'ADMIN' : 'STUDENT',
      })),
    });
    await prisma.course.createMany({
      data: created.map((id) => ({
        id,
        code: `ref-selection-${id}`,
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
      if (!existing) created.push(id);
      if (code === 'IT058IU') thesis = id;
      else physical = id;
    }
  });
  beforeEach(async () => {
    versionHook = undefined;
    beforeReceipt = undefined;
    await prisma.studyPlan.deleteMany({ where: { userId: { in: [owner, admin] } } });
    await prisma.studentRecord.deleteMany({ where: { userId: owner } });
    await prisma.gradeAttempt.deleteMany({ where: { userId: owner } });
    await prisma.curriculumCourse.deleteMany({
      where: { curriculumId: { in: [curriculum, otherCurriculum] } },
    });
    await prisma.curriculum.update({ where: { id: curriculum }, data: { isGpaPath: false } });
    await prisma.user.update({
      where: { id: owner },
      data: { curriculumId: curriculum, role: 'STUDENT' },
    });
    await prisma.user.update({ where: { id: admin }, data: { role: 'ADMIN' } });
    await member(child);
    await member(parent, 1, 1);
    await member(peer);
    await prisma.curriculumCourse.create({ data: { curriculumId: curriculum, courseId: bare } });
    await member(foreign, 2, 1, otherCurriculum);
    const makePlan = async (userId: string) =>
      prisma.studyPlan.create({
        data: {
          userId,
          name: 'Historical reference',
          isActive: false,
          semesters: {
            create: {
              semester: 'FALL',
              year: 2026,
              totalCredits: -7,
              difficultyScore: 88,
              courses: [{ courseId: child, position: -9 }],
            },
          },
        },
        include: { semesters: true },
      });
    const own = await makePlan(owner);
    plan = own.id;
    semester = own.semesters[0].id;
    const other = await makePlan(admin);
    otherPlan = other.id;
    otherSemester = other.semesters[0].id;
  });
  afterAll(async () => {
    versionHook = undefined;
    beforeReceipt = undefined;
    await prisma.user.deleteMany({ where: { id: { in: [owner, admin] } } });
    await prisma.curriculum.deleteMany({ where: { id: { in: [curriculum, otherCurriculum] } } });
    await prisma.course.deleteMany({ where: { id: { in: created } } });
    await prisma.$disconnect();
  });
  it('requires a live cookie actor and hides foreign and incorrectly paired semesters, even from admins', async () => {
    expect((await request(app).get(url())).status).toBe(401);
    expect((await request(app).put(url()).send(body())).status).toBe(401);
    expect((await get(randomUUID())).status).toBe(401);
    await expect(
      readOwnStudyPlanReferenceSelection(randomUUID(), plan, semester),
    ).rejects.toMatchObject({ status: 401 });
    await expect(
      saveOwnStudyPlanReferenceSelection(randomUUID(), plan, semester, body()),
    ).rejects.toMatchObject({ status: 401 });
    const responses = await Promise.all([
      put(body(), admin),
      put(body(), owner, otherPlan, otherSemester),
      put(body(), owner, plan, otherSemester),
      put(body(), owner, randomUUID(), semester),
    ]);
    responses.forEach((response) => {
      expect(response.status).toBe(404);
      expect(response.body).toEqual(responses[0].body);
    });
  });
  it('rejects strict invalid requests without writing or accepting caller-owned totals', async () => {
    const original = await stored();
    for (const input of [
      {},
      { ...body(), courseIds: [child, child.toUpperCase()] },
      { ...body(), courseIds: Array.from({ length: 101 }, () => randomUUID()) },
      { ...body(), expectedRevision: -1 },
      { ...body(), expectedRevision: 2147483648 },
      { ...body(), academicYear: '2' },
      { ...body(), academicYear: Number.MAX_SAFE_INTEGER + 1 },
      { ...body(), academicSemester: 4 },
      { ...body(), expectedScope: { userId: owner, curriculumId: null } },
      { ...body(), totalCredits: 0 },
      { ...body(), expectedScope: { userId: owner, curriculumId: curriculum, force: true } },
    ])
      expect((await put(input)).status).toBe(400);
    expect((await put().query({ force: true })).status).toBe(400);
    expect((await request(app).get(url()).set('Cookie', cookie()).query({ limit: 1 })).status).toBe(
      400,
    );
    expect(await stored()).toEqual(original);
    expect(await prisma.referenceSelectionReceipt.count({ where: { userId: owner } })).toBe(0);
  });
  it('reads coherent current placed options and explicitly gates unassigned and unrecognized saved content', async () => {
    const response = await get();
    expect(response.status).toBe(200);
    const value = OwnStudyPlanReferenceSelectionStateSchema.parse(response.body.data);
    expect(value.revision).toBe(0);
    expect(value.lastReferenceSave).toBeNull();
    if (value.editing.status !== 'AVAILABLE') throw new Error('Expected options');
    expect(new Set(value.editing.courses.map(({ id }) => id))).toEqual(
      new Set([child, parent, peer]),
    );
    await save('unrecognized');
    expect((await get()).body.data.editing).toEqual({
      status: 'UNAVAILABLE',
      reason: 'COURSE_REFERENCES_UNAVAILABLE',
    });
    await prisma.user.update({ where: { id: owner }, data: { curriculumId: null } });
    expect((await get()).body.data.editing).toEqual({
      status: 'UNAVAILABLE',
      reason: 'NO_ASSIGNED_CURRICULUM',
    });
  });
  it('saves canonical order, recomputes credits and Bayesian difficulty, and leaves calendar, activation and academic data untouched', async () => {
    await prisma.course.update({ where: { id: child }, data: { avgRating: 5, ratingCount: 2 } });
    try {
      const before = await stored();
      const input = body([peer, child]);
      const normalized = {
        ...input,
        requestId: input.requestId.toUpperCase(),
        expectedScope: { userId: owner.toUpperCase(), curriculumId: curriculum.toUpperCase() },
        courseIds: input.courseIds.map((id) => id.toUpperCase()),
      };
      const reply = await parsed(normalized);
      expect(reply.replayed).toBe(false);
      expect(reply.receipt).toMatchObject({
        requestId: input.requestId,
        userId: owner,
        curriculumId: curriculum,
        planId: plan,
        semesterId: semester,
        previousRevision: 0,
        savedRevision: 1,
        courseIds: [peer, child],
        storedTotalCredits: 6,
        referenceSlot: { academicYear: 2, academicSemester: 1 },
      });
      const rows = await prisma.course.findMany({
        where: { id: { in: input.courseIds } },
        select: { id: true, credits: true, avgRating: true, ratingCount: true },
      });
      const decorated = await decorateCourseDifficulties(prisma, rows, curriculum);
      expect(reply.receipt.storedDifficultyScore).toBeCloseTo(
        decorated.reduce((sum, row) => sum + row.ratingDifficulty, 0) / 2,
      );
      const after = await stored();
      expect(after.courses).toEqual([
        { courseId: peer, position: 0 },
        { courseId: child, position: 1 },
      ]);
      expect(after).toMatchObject({
        revision: 1,
        semester: before.semester,
        year: before.year,
        totalCredits: 6,
        referenceMetadata: {
          policy: 'CURRENT_COMPLETIONS_ONLY_V1',
          curriculumId: curriculum,
          academicYear: 2,
          academicSemester: 1,
          checkedAt: reply.receipt.savedAt,
          revision: 1,
        },
      });
      expect((await prisma.studyPlan.findUniqueOrThrow({ where: { id: plan } })).isActive).toBe(
        false,
      );
      expect(await prisma.studentRecord.count({ where: { userId: owner } })).toBe(0);
      expect(await prisma.gradeAttempt.count({ where: { userId: owner } })).toBe(0);
      expect((await prisma.user.findUniqueOrThrow({ where: { id: owner } })).curriculumId).toBe(
        curriculum,
      );
    } finally {
      await prisma.course.update({
        where: { id: child },
        data: { avgRating: null, ratingCount: 0 },
      });
    }
  });
  it('allows a recognized empty selection and includes physical training in planned credits', async () => {
    await member(physical);
    const one = await parsed(body([physical]));
    expect(one.receipt.storedTotalCredits).toBe(
      (await prisma.course.findUniqueOrThrow({ where: { id: physical } })).credits,
    );
    const empty = await parsed({ ...body([]), expectedRevision: 1 });
    expect(empty.receipt).toMatchObject({
      storedTotalCredits: 0,
      storedDifficultyScore: 0,
      savedRevision: 2,
    });
    expect((await stored()).courses).toEqual([]);
  });
  it('replays an immutable lost-reply acknowledgement before current scope/version checks without overwriting later saves', async () => {
    const input = body();
    const first = await parsed(input);
    await parsed({ ...body([peer]), expectedRevision: 1 });
    await prisma.user.update({ where: { id: owner }, data: { curriculumId: otherCurriculum } });
    const before = await stored();
    const replay = await parsed(input);
    expect(replay).toEqual({ receipt: first.receipt, replayed: true });
    expect(await stored()).toEqual(before);
    const state = OwnStudyPlanReferenceSelectionStateSchema.parse((await get()).body.data);
    expect(state.snapshot.scope.curriculumId).toBe(otherCurriculum);
    expect(state.lastReferenceSave?.curriculumId).toBe(curriculum);
    expect(state.revision).toBe(2);
    expect(await prisma.referenceSelectionReceipt.count({ where: { userId: owner } })).toBe(2);
  });
  it('rechecks current ownership before replaying a previous actor receipt', async () => {
    const input = body();
    await parsed(input);
    await prisma.studyPlan.update({ where: { id: plan }, data: { userId: admin } });
    expect((await put(input)).status).toBe(404);
    expect((await put(input, admin)).status).toBe(409);
    expect(await prisma.referenceSelectionReceipt.count({ where: { userId: owner } })).toBe(1);
  });
  it('keeps edit-state version, scope and course snapshot coherent during a committed concurrent change', async () => {
    versionHook = async () => {
      versionHook = undefined;
      await prisma.$transaction([
        prisma.user.update({ where: { id: owner }, data: { curriculumId: otherCurriculum } }),
        prisma.plannedSemester.update({
          where: { id: semester },
          data: { courses: [], revision: 1 },
        }),
      ]);
    };
    const previous = OwnStudyPlanReferenceSelectionStateSchema.parse((await get()).body.data);
    expect(previous.revision).toBe(0);
    expect(previous.snapshot.scope.curriculumId).toBe(curriculum);
    if (previous.snapshot.courseReferences.status !== 'RECOGNIZED')
      throw new Error('Expected references');
    expect(previous.snapshot.courseReferences.entries.map(({ courseId }) => courseId)).toEqual([
      child,
    ]);
    const fresh = OwnStudyPlanReferenceSelectionStateSchema.parse((await get()).body.data);
    expect(fresh.revision).toBe(1);
    expect(fresh.snapshot.scope.curriculumId).toBe(otherCurriculum);
    if (fresh.snapshot.courseReferences.status !== 'RECOGNIZED')
      throw new Error('Expected references');
    expect(fresh.snapshot.courseReferences.entries).toEqual([]);
  });
  it('rejects key collisions across payloads and semesters while preserving the original receipt', async () => {
    const input = body();
    const first = await parsed(input);
    expect((await put({ ...input, courseIds: [peer] })).status).toBe(409);
    const extra = await createPlannedSemester(plan, owner, {
      semester: 'SPRING',
      year: 2027,
      courses: [],
    });
    expect((await put(input, owner, plan, extra.id)).status).toBe(409);
    expect((await parsed(input)).receipt).toEqual(first.receipt);
    expect(await prisma.referenceSelectionReceipt.count({ where: { userId: owner } })).toBe(1);
  });
  it('rejects changed context, revision, missing membership and unmatched slots atomically', async () => {
    const before = await stored();
    for (const input of [
      { ...body(), expectedScope: { userId: admin, curriculumId: curriculum } },
      { ...body(), expectedScope: { userId: owner, curriculumId: otherCurriculum } },
      { ...body(), expectedRevision: 1 },
      body([foreign]),
      body([bare]),
      body([randomUUID()]),
      body([parent]),
      { ...body(), academicYear: 2026 },
    ])
      expect((await put(input)).status).toBe(409);
    expect(await stored()).toEqual(before);
    expect(await prisma.referenceSelectionReceipt.count({ where: { userId: owner } })).toBe(0);
  });
  it('never overwrites unsupported, overlimit or decimal-rounded historical references', async () => {
    for (const value of [
      'historical',
      Array.from({ length: 101 }, (_, position) => ({ courseId: randomUUID(), position })),
    ]) {
      await save(value);
      const before = await stored();
      expect((await put()).status).toBe(409);
      expect(await stored()).toEqual(before);
    }
    const exact = `[{"courseId":"${child}","position":1.00000000000000000001}]`;
    await prisma.$executeRaw`UPDATE planned_semesters SET courses = ${exact}::jsonb WHERE id = ${semester}`;
    expect((await put()).status).toBe(409);
    expect(await prisma.referenceSelectionReceipt.count({ where: { userId: owner } })).toBe(0);
  });
  it('requires every prerequisite flag and actual current completions, never selected peers or saved earlier semesters', async () => {
    await prisma.curriculumPrerequisite.createMany({
      data: [parent, peer, bare].map((prerequisiteId) => ({
        curriculumId: curriculum,
        courseId: child,
        prerequisiteId,
        isStrict: false,
        isCorequisite: true,
      })),
    });
    await prisma.plannedSemester.create({
      data: {
        studyPlanId: plan,
        semester: 'SPRING',
        year: 2025,
        courses: [{ courseId: parent, position: 0 }],
      },
    });
    await grade(parent, 100);
    await complete(bare);
    expect((await put(body([child, peer]))).status).toBe(409);
    await complete(parent);
    await prisma.studentRecord.create({
      data: { userId: owner, courseId: peer, status: 'IN_PROGRESS' },
    });
    expect((await put()).status).toBe(409);
    await prisma.studentRecord.update({
      where: { userId_courseId: { userId: owner, courseId: peer } },
      data: { status: 'COMPLETED' },
    });
    expect((await parsed()).receipt.savedRevision).toBe(1);
  });
  it('rechecks changed placement and newly added mandatory edges between read and save', async () => {
    expect((await get()).status).toBe(200);
    await prisma.curriculumPrerequisite.create({
      data: { curriculumId: curriculum, courseId: child, prerequisiteId: parent },
    });
    expect((await put()).status).toBe(409);
    await complete(parent);
    await prisma.curriculumPlacement.updateMany({
      where: { curriculumCourse: { curriculumId: curriculum, courseId: child } },
      data: { academicSemester: 2 },
    });
    expect((await put()).status).toBe(409);
    expect((await put({ ...body(), academicSemester: 2 })).status).toBe(200);
  });
  it('uses exact highest-retake member GPA, excludes physical/foreign scores, and blocks an undetermined fork', async () => {
    await prisma.curriculum.update({ where: { id: curriculum }, data: { isGpaPath: true } });
    await member(thesis, 4, 2);
    await member(physical, 1, 1);
    const input = { ...body([thesis]), academicYear: 4, academicSemester: 2 };
    await grade(physical, 100);
    await grade(foreign, 100);
    expect((await put(input)).status).toBe(409);
    await grade(bare, 70);
    expect((await put(input)).status).toBe(409);
    await grade(bare, 70.00001);
    await grade(bare, 20);
    expect((await put(input)).status).toBe(200);
  });
  it('rolls back the semester and metadata when receipt insertion fails after the save', async () => {
    const before = await stored();
    beforeReceipt = async () => {
      throw new Error('injected receipt failure');
    };
    await expect(saveOwnStudyPlanReferenceSelection(owner, plan, semester, body())).rejects.toThrow(
      'injected receipt failure',
    );
    beforeReceipt = undefined;
    expect(await stored()).toEqual(before);
    expect(await prisma.referenceSelectionReceipt.count({ where: { userId: owner } })).toBe(0);
  });
  const synchronizeFirstTwoReads = () => {
    let count = 0;
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    versionHook = async () => {
      count++;
      if (count === 2) release?.();
      if (count <= 2) await gate;
    };
  };
  it('permits exactly one of two concurrent distinct stale-version writers', async () => {
    synchronizeFirstTwoReads();
    const replies = await Promise.all([put(body([child])), put(body([peer]))]);
    expect(replies.map(({ status }) => status).sort()).toEqual([200, 409]);
    expect((await stored()).revision).toBe(1);
    expect(await prisma.referenceSelectionReceipt.count({ where: { userId: owner } })).toBe(1);
  });
  it('deduplicates concurrent identical retry requests with one saved revision and receipt', async () => {
    synchronizeFirstTwoReads();
    const input = body();
    const replies = await Promise.all([put(input), put(input)]);
    expect(replies.map(({ status }) => status)).toEqual([200, 200]);
    const values = replies.map((reply) =>
      OwnStudyPlanReferenceSelectionResultSchema.parse(reply.body.data),
    );
    expect(values[0].receipt).toEqual(values[1].receipt);
    expect(values.map(({ replayed }) => replayed).sort()).toEqual([false, true]);
    expect((await stored()).revision).toBe(1);
    expect(await prisma.referenceSelectionReceipt.count({ where: { userId: owner } })).toBe(1);
  });
  it('rejects empty legacy patches unchanged and invalidates reference metadata on accepted legacy updates', async () => {
    const first = await parsed();
    const unchanged = await stored();
    await expect(updatePlannedSemester(plan, semester, owner, {})).rejects.toThrow(
      'At least one semester field',
    );
    expect(await stored()).toEqual(unchanged);
    for (const patch of [{ year: 2026 }, { year: 2027 }, { courses: [] }]) {
      const before = await stored();
      await updatePlannedSemester(plan, semester, owner, patch);
      expect(await stored()).toMatchObject({
        revision: before.revision + 1,
        referenceMetadata: null,
      });
    }
    expect((await parsed({ ...body(), expectedRevision: 4 })).receipt.savedRevision).toBe(5);
    expect((await parsed({ ...body(), requestId: first.receipt.requestId })).receipt).toEqual(
      first.receipt,
    );
  });
  it('rejects tampered acknowledgement bindings and corrupted metadata instead of presenting them as trusted saved evidence', async () => {
    const input = body();
    const first = await parsed(input);
    await prisma.referenceSelectionReceipt.update({
      where: { userId_requestId: { userId: owner, requestId: input.requestId } },
      data: { receiptJson: { ...first.receipt, semesterId: otherSemester } },
    });
    const before = await stored();
    expect((await put(input)).status).toBe(409);
    expect(await stored()).toEqual(before);
    await prisma.plannedSemester.update({
      where: { id: semester },
      data: { referenceMetadata: { malformed: true } },
    });
    expect((await get()).status).toBe(409);
    await prisma.plannedSemester.update({
      where: { id: semester },
      data: {
        referenceMetadata: {
          policy: 'CURRENT_COMPLETIONS_ONLY_V1',
          curriculumId: curriculum,
          academicYear: 2,
          academicSemester: 1,
          checkedAt: first.receipt.savedAt,
          revision: 2,
        },
      },
    });
    expect((await get()).status).toBe(409);
  });
  it('normalizes direct-service actor UUIDs consistently with shared route IDs', async () => {
    expect(
      (
        await readOwnStudyPlanReferenceSelection(
          owner.toUpperCase(),
          plan.toUpperCase(),
          semester.toUpperCase(),
        )
      ).snapshot.scope.userId,
    ).toBe(owner);
    expect(
      (
        await saveOwnStudyPlanReferenceSelection(
          owner.toUpperCase(),
          plan.toUpperCase(),
          semester.toUpperCase(),
          body(),
        )
      ).receipt.userId,
    ).toBe(owner);
  });
  it('rejects overlimit editor options rather than silently truncating the current curriculum', async () => {
    const ids = Array.from({ length: 1001 }, () => randomUUID());
    created.push(...ids);
    await prisma.course.createMany({
      data: ids.map((id) => ({
        id,
        code: `ref-selection-${id}`,
        name: 'Limit fixture',
        credits: 3,
        difficultyLevel: 3,
      })),
    });
    const links = ids.map((courseId) => ({ id: randomUUID(), curriculumId: curriculum, courseId }));
    await prisma.curriculumCourse.createMany({ data: links });
    await prisma.curriculumPlacement.createMany({
      data: links.map(({ id }) => ({
        curriculumCourseId: id,
        sourceOrder: 0,
        academicYear: 2,
        academicSemester: 1,
      })),
    });
    expect((await get()).status).toBe(409);
    expect((await stored()).revision).toBe(0);
  });
  it('guards revision overflow in new and legacy writes without changing data', async () => {
    await prisma.plannedSemester.update({
      where: { id: semester },
      data: { revision: 2147483647 },
    });
    const before = await stored();
    expect((await put({ ...body(), expectedRevision: 2147483647 })).status).toBe(409);
    await expect(
      updatePlannedSemester(plan, semester, owner, { year: 2026 }),
    ).rejects.toMatchObject({
      status: 409,
    });
    expect(await stored()).toEqual(before);
  });
  it('deletes only freshly authorized plan/semester pairs and cascades receipts', async () => {
    await parsed();
    await expect(deletePlannedSemester(otherPlan, semester, admin)).rejects.toMatchObject({
      status: 404,
    });
    await expect(deletePlannedSemester(plan, semester, randomUUID())).rejects.toMatchObject({
      status: 401,
    });
    await prisma.user.update({ where: { id: admin }, data: { role: 'STUDENT' } });
    await expect(deletePlannedSemester(plan, semester, admin)).rejects.toMatchObject({
      status: 403,
    });
    expect(await prisma.referenceSelectionReceipt.count({ where: { userId: owner } })).toBe(1);
    await deletePlannedSemester(plan, semester, owner);
    expect(await prisma.referenceSelectionReceipt.count({ where: { userId: owner } })).toBe(0);
    expect(
      await prisma.plannedSemester.findUnique({ where: { id: otherSemester } }),
    ).not.toBeNull();
  });
});

describe('saved reference selection shared contract', () => {
  const userId = randomUUID();
  const curriculumId = randomUUID();
  const courseId = randomUUID();
  const makeBody = () => ({
    requestId: randomUUID(),
    expectedScope: { userId, curriculumId },
    expectedRevision: 0,
    academicYear: 2,
    academicSemester: 1,
    courseIds: [courseId],
  });
  const makeReceipt = () => ({
    requestId: randomUUID(),
    userId,
    curriculumId,
    planId: randomUUID(),
    semesterId: randomUUID(),
    previousRevision: 0,
    savedRevision: 1,
    referenceSlot: { academicYear: 2, academicSemester: 1 },
    courseIds: [courseId],
    storedTotalCredits: 3,
    storedDifficultyScore: 3,
    savedAt: '2026-10-17T00:00:00.000Z',
  });
  const makeState = () => ({
    snapshot: {
      visibility: 'CURRENT_ACCOUNT_ONLY',
      scope: { userId, curriculumId, studyPlansValidated: false },
      plan: {
        id: randomUUID(),
        name: 'Historical',
        description: null,
        isActive: false,
        createdAt: '2026-10-17T00:00:00.000Z',
        updatedAt: '2026-10-17T00:00:00.000Z',
        semesterCount: 1,
      },
      semester: {
        id: randomUUID(),
        semester: 'FALL',
        year: 2026,
        storedTotalCredits: -9,
        createdAt: '2026-10-17T00:00:00.000Z',
        updatedAt: '2026-10-17T00:00:00.000Z',
      },
      courseReferences: { status: 'RECOGNIZED', order: 'STORED_ARRAY_ORDER', entries: [] },
    },
    revision: 0,
    lastReferenceSave: null,
    editing: { status: 'AVAILABLE', courses: [{ id: courseId, code: 'CODE', name: 'Label' }] },
  });
  it('requires explicit nonnull expected context and bounded numeric revision/slot with normalized unique ordered IDs', () => {
    const value = makeBody();
    expect(
      OwnStudyPlanReferenceSelectionBodySchema.parse({
        ...value,
        requestId: value.requestId.toUpperCase(),
        courseIds: [courseId.toUpperCase()],
      }),
    ).toEqual(value);
    expect(
      OwnStudyPlanReferenceSelectionBodySchema.safeParse({ ...value, courseIds: [] }).success,
    ).toBe(true);
    for (const bad of [
      { ...value, expectedRevision: '0' },
      { ...value, expectedRevision: -1 },
      { ...value, expectedRevision: 2147483648 },
      { ...value, academicYear: Number.MAX_SAFE_INTEGER + 1 },
      { ...value, expectedScope: { userId, curriculumId: null } },
      { ...value, courseIds: [courseId, courseId.toUpperCase()] },
      { ...value, courseIds: Array.from({ length: 101 }, () => randomUUID()) },
      { ...value, force: true },
    ])
      expect(OwnStudyPlanReferenceSelectionBodySchema.safeParse(bad).success).toBe(false);
  });
  it('requires one exact receipt revision advance and truthful empty and bounded difficulty totals', () => {
    const receipt = makeReceipt();
    const value = { receipt, replayed: false };
    expect(OwnStudyPlanReferenceSelectionResultSchema.safeParse(value).success).toBe(true);
    for (const patch of [
      { savedRevision: 0 },
      { savedRevision: 2 },
      { previousRevision: 2147483647, savedRevision: 2147483648 },
      { storedDifficultyScore: 0 },
      { storedDifficultyScore: 6 },
      { storedTotalCredits: -1 },
      { courseIds: [] },
      { courseIds: [courseId, courseId] },
      { calendarValidated: true },
    ])
      expect(
        OwnStudyPlanReferenceSelectionResultSchema.safeParse({
          ...value,
          receipt: { ...receipt, ...patch },
        }).success,
      ).toBe(false);
    expect(
      OwnStudyPlanReferenceSelectionResultSchema.safeParse({
        ...value,
        receipt: { ...receipt, courseIds: [], storedTotalCredits: 0, storedDifficultyScore: 0 },
      }).success,
    ).toBe(true);
  });
  it('validates state option identity, unavailable reason and metadata revision without falsely rebinding historical context', () => {
    const state = makeState();
    expect(OwnStudyPlanReferenceSelectionStateSchema.safeParse(state).success).toBe(true);
    expect(
      OwnStudyPlanReferenceSelectionStateSchema.safeParse({
        ...state,
        editing: { status: 'UNAVAILABLE', reason: 'NO_ASSIGNED_CURRICULUM' },
      }).success,
    ).toBe(false);
    expect(
      OwnStudyPlanReferenceSelectionStateSchema.safeParse({
        ...state,
        editing: {
          status: 'AVAILABLE',
          courses: [...state.editing.courses, ...state.editing.courses],
        },
      }).success,
    ).toBe(false);
    const metadata = {
      policy: 'CURRENT_COMPLETIONS_ONLY_V1',
      curriculumId: randomUUID(),
      academicYear: 2,
      academicSemester: 1,
      checkedAt: '2026-10-17T00:00:00.000Z',
      revision: 1,
    };
    expect(
      OwnStudyPlanReferenceSelectionStateSchema.safeParse({
        ...state,
        revision: 1,
        lastReferenceSave: metadata,
      }).success,
    ).toBe(true);
    expect(
      OwnStudyPlanReferenceSelectionStateSchema.safeParse({ ...state, lastReferenceSave: metadata })
        .success,
    ).toBe(false);
    expect(
      OwnStudyPlanReferenceSelectionStateSchema.safeParse({
        ...state,
        lastReferenceSave: { ...metadata, revision: 0 },
      }).success,
    ).toBe(false);
  });
});
