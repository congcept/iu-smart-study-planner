import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import {
  SemesterAllocationRunV1Schema,
  OwnSemesterAllocationRunV1Schema,
  type CreateSemesterAllocationRunDTO,
  type SimulationSemesterAllocationResultDTO,
} from '@iu-study-planner/shared';
import config from '../config';
import { prisma } from '../db';
import { allocateSimulationSemester } from '../services/simulationSemesterAllocation';
import {
  readOwnSemesterAllocationRun,
  readSemesterAllocationRun,
  storeSemesterAllocationRun,
  storeSemesterAllocationRunInTransaction,
  verifyStoredSemesterAllocationRun,
} from '../services/semesterAllocationStorage';

describe('private immutable semester simulation storage (PostgreSQL)', () => {
  const prefix = `semester-storage-${randomUUID()}`;
  const administrators = [randomUUID(), randomUUID()];
  const students = [randomUUID(), randomUUID(), randomUUID()];
  const users = [...administrators, ...students];
  const contexts = [randomUUID(), randomUUID()];
  const courses = [randomUUID(), randomUUID()];
  const originalPolicy = config.simulationAllocationPolicy;
  let afterRunCreate: (() => Promise<void>) | undefined;
  let afterParticipantsCreate: (() => Promise<void>) | undefined;
  const scope = () => ({ curriculumId: contexts[0], semester: 'FALL' as const, year: 2026 });
  const request = (
    requestId = randomUUID(),
    actorId = administrators[0],
  ): CreateSemesterAllocationRunDTO => ({
    ...scope(),
    requestId,
    expectedActorId: actorId,
  });
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
  const save = (input = request(), result: unknown = fixture(), capturedAt = new Date()) =>
    storeSemesterAllocationRun(administrators[0], input, result, capturedAt);
  const counts = async () => ({
    runs: await prisma.simulationSemesterRun.count({ where: { curriculumId: { in: contexts } } }),
    participants: await prisma.simulationSemesterParticipant.count({
      where: { run: { curriculumId: { in: contexts } } },
    }),
  });
  const source = async () => ({
    users: await prisma.user.findMany({ where: { id: { in: users } }, orderBy: { id: 'asc' } }),
    curricula: await prisma.curriculum.findMany({
      where: { id: { in: contexts } },
      orderBy: { id: 'asc' },
    }),
    courses: await prisma.course.findMany({
      where: { id: { in: courses } },
      orderBy: { id: 'asc' },
    }),
    members: await prisma.curriculumCourse.findMany({
      where: { curriculumId: { in: contexts } },
      orderBy: { id: 'asc' },
    }),
    records: await prisma.studentRecord.findMany({
      where: { userId: { in: users } },
      orderBy: { id: 'asc' },
    }),
    grades: await prisma.gradeAttempt.findMany({
      where: { userId: { in: users } },
      orderBy: { id: 'asc' },
    }),
    plans: await prisma.studyPlan.findMany({
      where: { userId: { in: users } },
      include: { semesters: true },
      orderBy: { id: 'asc' },
    }),
    resources: await prisma.schoolResource.findMany({
      where: { curriculumId: { in: contexts } },
      orderBy: { id: 'asc' },
    }),
    oldRuns: await prisma.simulationAllocationRun.findMany({
      where: { curriculumId: { in: contexts } },
    }),
    oldJobs: await prisma.simulationAllocationJob.findMany({
      where: { curriculumId: { in: contexts } },
    }),
  });
  const clean = async () => {
    await prisma.simulationSemesterParticipant.deleteMany({
      where: { run: { curriculumId: { in: contexts } } },
    });
    await prisma.simulationSemesterRun.deleteMany({ where: { curriculumId: { in: contexts } } });
    await prisma.user.deleteMany({ where: { id: { in: users } } });
    await prisma.curriculum.deleteMany({ where: { id: { in: contexts } } });
    await prisma.course.deleteMany({ where: { id: { in: courses } } });
  };

  beforeAll(() => {
    // Hooks observe completed real PostgreSQL writes; no query or result is replaced.
    prisma.$use(async (params, next) => {
      const result: unknown = await next(params);
      if (
        params.model === 'SimulationSemesterRun' &&
        params.action === 'create' &&
        params.args?.data?.curriculumId === contexts[0] &&
        afterRunCreate
      ) {
        const hook = afterRunCreate;
        afterRunCreate = undefined;
        await hook();
      }
      if (
        params.model === 'SimulationSemesterParticipant' &&
        params.action === 'createMany' &&
        afterParticipantsCreate
      ) {
        const hook = afterParticipantsCreate;
        afterParticipantsCreate = undefined;
        await hook();
      }
      return result;
    });
  });
  beforeEach(async () => {
    afterRunCreate = undefined;
    afterParticipantsCreate = undefined;
    config.simulationAllocationPolicy = originalPolicy;
    await clean();
    await prisma.curriculum.createMany({
      data: contexts.map((id, index) => ({
        id,
        code: `${prefix}-context-${index}`,
        name: 'Stored reference',
        school: 'CSE',
        degree: 'Bachelor',
        programUrl: 'https://example.test/semester-storage',
      })),
    });
    await prisma.user.createMany({
      data: users.map((id, index) => ({
        id,
        studentId: `${prefix}-user-${index}`,
        email: `${id}@example.test`,
        name: `Private participant ${index}`,
        role: index < 2 ? 'ADMIN' : 'STUDENT',
        curriculumId: contexts[0],
      })),
    });
    await prisma.course.createMany({
      data: courses.map((id, index) => ({
        id,
        code: `${prefix}-course-${index}`,
        name: `Stored course ${index}`,
        credits: 3,
        difficultyLevel: 2,
        semesterOffered: [],
      })),
    });
    await prisma.curriculumCourse.createMany({
      data: courses.map((courseId) => ({ curriculumId: contexts[0], courseId })),
    });
    await prisma.studentRecord.create({
      data: { userId: students[0], courseId: courses[0], status: 'PLANNED' },
    });
    await prisma.schoolResource.create({
      data: {
        ...scope(),
        professors: 2,
        classrooms: 2,
        labRooms: 7,
        maxStudentsPerSection: 2,
        updatedBy: administrators[0],
      },
    });
  });
  afterEach(async () => {
    afterRunCreate = undefined;
    afterParticipantsCreate = undefined;
    config.simulationAllocationPolicy = originalPolicy;
    await clean();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('stores a private snapshot and exact participant rows while exposing only aggregate results', async () => {
    const result = fixture();
    const before = await source();
    const saved = await save(request(), result);
    expect(saved.created).toBe(true);
    expect(SemesterAllocationRunV1Schema.parse(saved.run)).toEqual(saved.run);
    expect(saved.run.result).toMatchObject({
      studentCount: 2,
      assignedStudentCount: 2,
      assignedCourseCount: 3,
      totalTargetCredits: 9,
      totalAssignedCredits: 9,
      totalRemainingCredits: 0,
      stopReasonCounts: { TARGET_REACHED: 2 },
      academicPlansChanged: false,
    });
    expect(await counts()).toEqual({ runs: 1, participants: 2 });
    const stored = await prisma.simulationSemesterRun.findUniqueOrThrow({
      where: { id: saved.run.id },
      include: { participants: true },
    });
    expect(stored.result).toEqual(result);
    for (const student of result.students) {
      expect(
        stored.participants.find((row) => row.capturedStudentId === student.studentId),
      ).toMatchObject({ userId: student.studentId, result: student });
    }
    const serialized = JSON.stringify(saved.run);
    for (const user of users) expect(serialized).not.toContain(user);
    for (const field of [
      '"students"',
      '"studentId"',
      '"assignments"',
      '"candidates"',
      '"input"',
      '"createdById"',
      '"requestId"',
    ])
      expect(serialized).not.toContain(field);
    expect(await readSemesterAllocationRun(administrators[1], saved.run.id)).toEqual(saved.run);
    expect(await source()).toEqual(before);
  });

  it('returns exactly the current owner outcome without another participant or candidate roster', async () => {
    const result = fixture();
    const saved = await save(request(), result);
    for (const studentId of students.slice(0, 2)) {
      const own = await readOwnSemesterAllocationRun(studentId, saved.run.id);
      expect(OwnSemesterAllocationRunV1Schema.parse(own)).toEqual(own);
      const student = result.students.find((row) => row.studentId === studentId)!;
      const { studentId: omittedStudentId, ...outcome } = student;
      expect(omittedStudentId).toBe(studentId);
      expect(own.result).toEqual(outcome);
      expect(own.courses).toEqual(student.courseIds.map((courseId) => ({ courseId, credits: 3 })));
      const serialized = JSON.stringify(own);
      for (const user of users) expect(serialized).not.toContain(user);
      expect(serialized).not.toContain('candidates');
      expect(serialized).not.toContain('studentUtility');
      expect(serialized).not.toContain('assignments');
    }
    await expect(readOwnSemesterAllocationRun(students[2], saved.run.id)).rejects.toMatchObject({
      status: 404,
    });
    await expect(
      readOwnSemesterAllocationRun(administrators[0], saved.run.id),
    ).rejects.toMatchObject({ status: 404 });
  });

  it.each(['save', 'aggregate', 'own'] as const)(
    'requires an existing account for %s',
    async (operation) => {
      const saved = await save();
      const unknownActor = randomUUID();
      const action =
        operation === 'save'
          ? storeSemesterAllocationRun(
              unknownActor,
              request(randomUUID(), unknownActor),
              fixture(),
              new Date(),
            )
          : operation === 'aggregate'
            ? readSemesterAllocationRun(unknownActor, saved.run.id)
            : readOwnSemesterAllocationRun(unknownActor, saved.run.id);
      await expect(action).rejects.toMatchObject({ status: 401 });
      expect(await counts()).toEqual({ runs: 1, participants: 2 });
    },
  );

  it.each(['save', 'aggregate'] as const)(
    'rejects student access to admin %s',
    async (operation) => {
      const saved = await save();
      const action =
        operation === 'save'
          ? storeSemesterAllocationRun(
              students[0],
              request(randomUUID(), students[0]),
              fixture(),
              new Date(),
            )
          : readSemesterAllocationRun(students[0], saved.run.id);
      await expect(action).rejects.toMatchObject({ status: 403 });
    },
  );

  it('checks expected account before recovering an existing retry key', async () => {
    const input = request();
    await save(input);
    await expect(
      save({ ...input, expectedActorId: administrators[1] }, null),
    ).rejects.toMatchObject({ status: 409 });
    expect(await counts()).toEqual({ runs: 1, participants: 2 });
  });

  it('recovers exact stored history before validating changed producer inputs, time or live policy', async () => {
    const input = request();
    const saved = await save(input);
    config.simulationAllocationPolicy = Object.freeze({
      studentUtilityWeight: 0,
      resourceFitWeight: 0,
      fairnessWeight: 0,
      congestionThreshold: 0.85,
    });
    await prisma.schoolResource.update({
      where: { curriculumId_semester_year: scope() },
      data: { professors: 0, classrooms: 0, revision: 2 },
    });
    await prisma.studentRecord.updateMany({
      where: { userId: students[0] },
      data: { status: 'COMPLETED' },
    });
    await prisma.user.update({ where: { id: students[1] }, data: { curriculumId: contexts[1] } });
    expect(
      await save(input, { untrusted: 'invalid changed producer result' }, new Date('invalid')),
    ).toEqual({ created: false, run: saved.run });
    expect(await readSemesterAllocationRun(administrators[1], saved.run.id)).toEqual(saved.run);
    expect(await readOwnSemesterAllocationRun(students[1], saved.run.id)).toMatchObject({
      scope: scope(),
      result: { assignedCredits: 3 },
    });
    expect(await counts()).toEqual({ runs: 1, participants: 2 });
  });

  it.each(['curriculum', 'semester', 'year'] as const)(
    'rejects retry key reuse for another %s',
    async (field) => {
      const input = request();
      await save(input);
      const changed = {
        ...input,
        ...(field === 'curriculum'
          ? { curriculumId: contexts[1] }
          : field === 'semester'
            ? { semester: 'SPRING' as const }
            : { year: 2027 }),
      };
      await expect(save(changed, null)).rejects.toMatchObject({ status: 409 });
      expect(await counts()).toEqual({ runs: 1, participants: 2 });
    },
  );

  it('keeps retry keys account scoped', async () => {
    const input = request();
    const first = await save(input);
    const second = await storeSemesterAllocationRun(
      administrators[1],
      { ...input, expectedActorId: administrators[1] },
      fixture(),
      new Date(),
    );
    expect(second.created).toBe(true);
    expect(second.run.id).not.toBe(first.run.id);
    expect(await counts()).toEqual({ runs: 2, participants: 4 });
  });

  it('concurrent identical saves commit one verified run and participant set', async () => {
    const input = request();
    const result = fixture();
    const saved = await Promise.all([
      save(input, result),
      save(input, result),
      save(input, result),
    ]);
    expect(saved.filter((run) => run.created)).toHaveLength(1);
    expect(new Set(saved.map((run) => run.run.id)).size).toBe(1);
    expect(await counts()).toEqual({ runs: 1, participants: 2 });
  });

  it.each(['run', 'participants'] as const)(
    'rolls back a failure after the real %s insertion, then safely retries',
    async (stage) => {
      const input = request();
      const before = await source();
      const fail = async () => {
        throw new Error(`Injected after ${stage}`);
      };
      if (stage === 'run') afterRunCreate = fail;
      else afterParticipantsCreate = fail;
      await expect(save(input)).rejects.toThrow(`Injected after ${stage}`);
      expect(await counts()).toEqual({ runs: 0, participants: 0 });
      expect(await source()).toEqual(before);
      expect((await save(input)).created).toBe(true);
    },
  );

  it('the transaction helper joins caller rollback rather than committing independently', async () => {
    await expect(
      prisma.$transaction(
        async (tx) => {
          await storeSemesterAllocationRunInTransaction(
            tx,
            administrators[0],
            request(),
            fixture(),
            new Date(),
          );
          throw new Error('Caller rollback');
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      ),
    ).rejects.toThrow('Caller rollback');
    expect(await counts()).toEqual({ runs: 0, participants: 0 });
  });

  it.each(['missing', 'admin', 'foreign', 'unassigned'] as const)(
    'rejects an unavailable %s participant before persisting',
    async (caseName) => {
      if (caseName === 'missing') await prisma.user.delete({ where: { id: students[1] } });
      else
        await prisma.user.update({
          where: { id: students[1] },
          data:
            caseName === 'admin'
              ? { role: 'ADMIN' }
              : { curriculumId: caseName === 'foreign' ? contexts[1] : null },
        });
      await expect(save()).rejects.toMatchObject({ status: 409 });
      expect(await counts()).toEqual({ runs: 0, participants: 0 });
    },
  );

  it('rejects captured scope mismatch and malformed producer results without partial writes', async () => {
    const result = fixture();
    await expect(save({ ...request(), semester: 'SPRING' })).rejects.toMatchObject({ status: 409 });
    await expect(save(request(), { ...result, assignedCourseCount: 999 })).rejects.toThrow();
    await expect(save(request(), result, new Date('invalid'))).rejects.toThrow();
    expect(await counts()).toEqual({ runs: 0, participants: 0 });
  });

  it('author deletion nulls live linkage while another administrator still reads exact history', async () => {
    const saved = await save();
    await prisma.user.delete({ where: { id: administrators[0] } });
    expect(
      (await prisma.simulationSemesterRun.findUniqueOrThrow({ where: { id: saved.run.id } }))
        .createdById,
    ).toBeNull();
    expect(await readSemesterAllocationRun(administrators[1], saved.run.id)).toEqual(saved.run);
    await expect(prisma.curriculum.delete({ where: { id: contexts[0] } })).rejects.toMatchObject({
      code: 'P2003',
    });
  });

  it('deleted participants lose live access without changing replay or another owner result', async () => {
    const saved = await save();
    const survivor = await readOwnSemesterAllocationRun(students[0], saved.run.id);
    await prisma.user.delete({ where: { id: students[1] } });
    const participant = await prisma.simulationSemesterParticipant.findFirstOrThrow({
      where: { runId: saved.run.id, capturedStudentId: students[1] },
    });
    expect(participant.userId).toBeNull();
    expect(participant.capturedStudentId).toBe(students[1]);
    expect(await readSemesterAllocationRun(administrators[1], saved.run.id)).toEqual(saved.run);
    expect(await readOwnSemesterAllocationRun(students[0], saved.run.id)).toEqual(survivor);
    await expect(readOwnSemesterAllocationRun(students[1], saved.run.id)).rejects.toMatchObject({
      status: 401,
    });
    await prisma.user.create({
      data: {
        id: students[1],
        studentId: `${prefix}-recreated`,
        email: `${students[1]}@example.test`,
        name: 'Recreated identity',
        role: 'STUDENT',
        curriculumId: contexts[0],
      },
    });
    await expect(readOwnSemesterAllocationRun(students[1], saved.run.id)).rejects.toMatchObject({
      status: 404,
    });
    await expect(
      prisma.simulationSemesterParticipant.update({
        where: { id: participant.id },
        data: { userId: students[1] },
      }),
    ).rejects.toThrow(/immutable/i);
  });

  it.each([
    'runResult',
    'runScope',
    'runVersion',
    'runRequest',
    'participantResult',
    'participantIdentity',
    'participantOwner',
  ] as const)('blocks direct immutable %s updates', async (field) => {
    const saved = await save();
    const participant = await prisma.simulationSemesterParticipant.findFirstOrThrow({
      where: { runId: saved.run.id },
    });
    const action = {
      runResult: () =>
        prisma.$executeRaw`UPDATE simulation_semester_runs SET result = jsonb_set(result, '{assignedCourseCount}', '999'::jsonb) WHERE id = ${saved.run.id}`,
      runScope: () =>
        prisma.$executeRaw`UPDATE simulation_semester_runs SET year = 2027 WHERE id = ${saved.run.id}`,
      runVersion: () =>
        prisma.$executeRaw`UPDATE simulation_semester_runs SET format_version = 2 WHERE id = ${saved.run.id}`,
      runRequest: () =>
        prisma.$executeRaw`UPDATE simulation_semester_runs SET request_id = ${randomUUID()} WHERE id = ${saved.run.id}`,
      participantResult: () =>
        prisma.$executeRaw`UPDATE simulation_semester_participants SET result = jsonb_set(result, '{assignedCredits}', '0'::jsonb) WHERE id = ${participant.id}`,
      participantIdentity: () =>
        prisma.$executeRaw`UPDATE simulation_semester_participants SET captured_student_id = ${students[2]} WHERE id = ${participant.id}`,
      participantOwner: () =>
        prisma.$executeRaw`UPDATE simulation_semester_participants SET user_id = ${students[2]} WHERE id = ${participant.id}`,
    }[field];
    await expect(action()).rejects.toThrow(/immutable/i);
    expect(await readSemesterAllocationRun(administrators[1], saved.run.id)).toEqual(saved.run);
  });

  it.each([
    'result',
    'scope',
    'version',
    'missingParticipant',
    'extraParticipant',
    'participantResult',
  ] as const)('fails closed on initially inserted corrupt %s history', async (field) => {
    const result = fixture();
    const runId = randomUUID();
    const input = request();
    const now = new Date();
    await prisma.simulationSemesterRun.create({
      data: {
        id: runId,
        ...scope(),
        year: field === 'scope' ? 2027 : 2026,
        requestId: input.requestId,
        createdById: administrators[0],
        formatVersion: field === 'version' ? 2 : 1,
        capturedAt: now,
        createdAt: now,
        result: field === 'result' ? { ...result, assignedCourseCount: 999 } : result,
      },
    });
    const rows = result.students
      .slice(field === 'missingParticipant' ? 1 : 0)
      .map((student) => ({
        runId,
        capturedStudentId: student.studentId,
        userId: student.studentId,
        result: field === 'participantResult' ? { ...student, assignedCredits: 0 } : student,
      }));
    if (field === 'extraParticipant')
      rows.push({
        runId,
        capturedStudentId: students[2],
        userId: students[2],
        result: { ...result.students[0], studentId: students[2] },
      });
    await prisma.simulationSemesterParticipant.createMany({ data: rows });
    const stored = await prisma.simulationSemesterRun.findUniqueOrThrow({
      where: { id: runId },
      include: { participants: true },
    });
    expect(() => verifyStoredSemesterAllocationRun(stored)).toThrow(/verif/i);
    await expect(readSemesterAllocationRun(administrators[1], runId)).rejects.toThrow(/verif/i);
    const retainedOwner = rows[0].userId;
    await expect(readOwnSemesterAllocationRun(retainedOwner, runId)).rejects.toThrow(/verif/i);
    if (field === 'missingParticipant')
      await expect(
        readOwnSemesterAllocationRun(result.students[0].studentId, runId),
      ).rejects.toMatchObject({ status: 404 });
    await expect(save(input, null)).rejects.toThrow(/verif/i);
  });

  it.each(['actor', 'participant'] as const)(
    'holds the live %s role/scope lock until the save commits',
    async (identity) => {
      let writer: Promise<void> | undefined;
      let committed = false;
      const userId = identity === 'actor' ? administrators[0] : students[0];
      afterRunCreate = async () => {
        let signalPid: (pid: number) => void = () => undefined;
        const pidReady = new Promise<number>((resolve) => {
          signalPid = resolve;
        });
        writer = prisma
          .$transaction(async (tx) => {
            const [connection] = await tx.$queryRaw<
              { pid: number }[]
            >`SELECT pg_backend_pid() AS pid`;
            signalPid(connection.pid);
            await tx.user.update({
              where: { id: userId },
              data: identity === 'actor' ? { role: 'STUDENT' } : { curriculumId: contexts[1] },
            });
          })
          .then(() => {
            committed = true;
          });
        const pid = await pidReady;
        let blocked = false;
        for (let attempt = 0; attempt < 20 && !blocked; attempt++) {
          const [activity] = await prisma.$queryRaw<
            { wait: string | null; blockers: number[] }[]
          >`SELECT wait_event_type AS wait, pg_blocking_pids(pid) AS blockers FROM pg_stat_activity WHERE pid = ${pid}`;
          blocked = activity?.wait === 'Lock' && activity.blockers.length > 0;
          if (!blocked) await new Promise<void>((resolve) => setTimeout(resolve, 50));
        }
        expect(blocked).toBe(true);
        expect(committed).toBe(false);
      };
      let saved: Awaited<ReturnType<typeof save>> | undefined;
      try {
        saved = await save();
      } finally {
        if (writer) await writer;
      }
      expect(saved?.created).toBe(true);
      expect(committed).toBe(true);
      if (identity === 'actor') await expect(save()).rejects.toMatchObject({ status: 403 });
      else await expect(save()).rejects.toMatchObject({ status: 409 });
      expect(await readSemesterAllocationRun(administrators[1], saved!.run.id)).toEqual(saved!.run);
    },
  );
});
