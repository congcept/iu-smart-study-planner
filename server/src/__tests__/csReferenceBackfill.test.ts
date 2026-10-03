import { randomUUID } from 'node:crypto';
import { prisma } from '../db';
import { backfillCsReference } from '../services/csReferenceBackfill';

describe('atomic legacy CS reference backfill (PostgreSQL)', () => {
  const contextCode = `backfill-${randomUUID()}`;
  const firstCode = `ZZ${9000 + Math.floor(Math.random() * 400)}IU`;
  const secondCode = `ZZ${9500 + Math.floor(Math.random() * 400)}IU`;
  let firstId: string;
  let secondId: string;
  let userId: string;
  const row = (code: string, name: string, year = 1, electiveGroup?: string) => ({
    id: code,
    name,
    credits: 3,
    lectureHours: 2,
    labHours: 1,
    year,
    semester: 1,
    isElective: !!electiveGroup,
    selectCount: electiveGroup ? 1 : 0,
    ...(electiveGroup ? { electiveGroup } : {}),
  });
  const input = () => [
    {
      year: 1,
      semester: 1,
      courses: [
        row(firstCode, 'Simulated A'),
        row(secondCode, 'Simulated B'),
        row('', 'Free elective'),
      ],
    },
    {
      year: 2,
      semester: 1,
      courses: [
        row(firstCode, 'Simulated A', 2, 'Group A'),
        row(secondCode, 'Simulated B', 2, 'Group B'),
      ],
    },
  ];
  const bytes = () => Buffer.from(JSON.stringify(input()));
  const legacySnapshot = async () => ({
    courses: await prisma.course.findMany({
      where: { id: { in: [firstId, secondId] } },
      orderBy: { code: 'asc' },
    }),
    edges: await prisma.prerequisite.findMany({
      where: { courseId: secondId },
      orderBy: { id: 'asc' },
    }),
    user: await prisma.user.findUnique({ where: { id: userId } }),
    records: await prisma.studentRecord.findMany({ where: { userId }, orderBy: { id: 'asc' } }),
    grades: await prisma.gradeAttempt.findMany({ where: { userId }, orderBy: { id: 'asc' } }),
    ratings: await prisma.courseRating.findMany({ where: { userId }, orderBy: { id: 'asc' } }),
  });
  const contextSnapshot = () =>
    prisma.curriculum.findUniqueOrThrow({
      where: { code: contextCode },
      include: {
        courses: {
          orderBy: { courseId: 'asc' },
          include: {
            placements: { orderBy: { sourceOrder: 'asc' } },
            prerequisites: { orderBy: { prerequisiteId: 'asc' } },
          },
        },
        requirements: { orderBy: { sourceOrder: 'asc' } },
      },
    });

  beforeEach(async () => {
    firstId = randomUUID();
    secondId = randomUUID();
    userId = randomUUID();
    await prisma.course.createMany({
      data: [
        {
          id: firstId,
          code: firstCode,
          name: 'Simulated A',
          credits: 3,
          difficultyLevel: 2,
          academicYear: 4,
          electiveGroup: 'Lossy legacy group',
        },
        { id: secondId, code: secondCode, name: 'Simulated B', credits: 3, difficultyLevel: 3 },
      ],
    });
    await prisma.prerequisite.create({
      data: { courseId: secondId, prerequisiteId: firstId, isStrict: false, isCorequisite: true },
    });
    await prisma.user.create({
      data: {
        id: userId,
        studentId: `backfill-${userId}`,
        name: 'Simulated student',
        email: `${userId}@example.test`,
      },
    });
    await prisma.studentRecord.createMany({
      data: [
        {
          userId,
          courseId: firstId,
          status: 'COMPLETED',
          grade: 'A',
          gradePoints: 4,
          electiveGroup: 'Old claim',
        },
        { userId, courseId: secondId, status: 'PLANNED' },
      ],
    });
    await prisma.gradeAttempt.create({
      data: { userId, courseId: firstId, requestId: randomUUID(), score: 88 },
    });
    await prisma.courseRating.create({ data: { userId, courseId: firstId, rating: 4 } });
  });

  afterEach(async () => {
    await prisma.curriculum.deleteMany({ where: { code: contextCode } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.course.deleteMany({ where: { id: { in: [firstId, secondId] } } });
  });
  afterAll(() => prisma.$disconnect());

  it('preserves every placement and uncoded requirement without altering global or student data', async () => {
    const before = await legacySnapshot();
    const result = await backfillCsReference(bytes(), contextCode);
    expect(result).toMatchObject({
      code: contextCode,
      provenance: 'LEGACY_HTML_REFERENCE',
      readyForActivation: false,
      counts: { memberships: 2, placements: 4, requirements: 1, prerequisites: 1 },
      created: { context: 1, memberships: 2, placements: 4, requirements: 1, prerequisites: 1 },
    });
    const saved = await contextSnapshot();
    expect(saved.totalCredits).toBeNull();
    expect(saved.sourceLabel).toContain(result.sha256);
    expect(saved.sourceLabel).toContain(result.prerequisiteSha256);
    expect(saved.courses.find(({ courseId }) => courseId === firstId)?.placements).toMatchObject([
      { academicYear: 1, electiveGroup: null, electiveSelectCount: null, sourceOrder: 0 },
      { academicYear: 2, electiveGroup: 'Group A', electiveSelectCount: 1, sourceOrder: 3 },
    ]);
    expect(saved.requirements).toMatchObject([
      { kind: 'FREE_ELECTIVE', credits: 3, sourceOrder: 2 },
    ]);
    expect(
      saved.courses.find(({ courseId }) => courseId === secondId)?.prerequisites,
    ).toMatchObject([{ prerequisiteId: firstId, isStrict: false, isCorequisite: true }]);
    expect(await legacySnapshot()).toEqual(before);
  });

  it('is idempotent with unchanged IDs, timestamps and row counts on repeated runs', async () => {
    await backfillCsReference(bytes(), contextCode);
    const before = await contextSnapshot();
    const result = await backfillCsReference(bytes(), contextCode);
    expect(result.created).toEqual({
      context: 0,
      memberships: 0,
      placements: 0,
      requirements: 0,
      prerequisites: 0,
    });
    expect(await contextSnapshot()).toEqual(before);
  });

  it('repairs missing matching rows atomically without replacing retained IDs', async () => {
    const result = await backfillCsReference(bytes(), contextCode);
    const retained = await prisma.curriculumCourse.findUniqueOrThrow({
      where: { curriculumId_courseId: { curriculumId: result.curriculumId, courseId: secondId } },
    });
    await prisma.curriculumCourse.delete({
      where: { curriculumId_courseId: { curriculumId: result.curriculumId, courseId: firstId } },
    });
    await prisma.curriculumRequirement.deleteMany({ where: { curriculumId: result.curriculumId } });
    expect((await backfillCsReference(bytes(), contextCode)).created).toEqual({
      context: 0,
      memberships: 1,
      placements: 2,
      requirements: 1,
      prerequisites: 1,
    });
    expect(await prisma.curriculumCourse.findUniqueOrThrow({ where: { id: retained.id } })).toEqual(
      retained,
    );
  });

  it('rejects missing global identities before creating any context', async () => {
    await prisma.course.delete({ where: { id: secondId } });
    const before = await legacySnapshot();
    await expect(backfillCsReference(bytes(), contextCode)).rejects.toThrow('MISSING_COURSE');
    expect(await prisma.curriculum.count({ where: { code: contextCode } })).toBe(0);
    expect(await legacySnapshot()).toEqual(before);
  });

  it.each([{ credits: 4 }, { name: 'Conflicting name' }])(
    'rejects global metadata conflict without overwriting it %#',
    async (conflict) => {
      await prisma.course.update({ where: { id: firstId }, data: conflict });
      const before = await legacySnapshot();
      await expect(backfillCsReference(bytes(), contextCode)).rejects.toThrow(
        'CS catalog compatibility failed',
      );
      expect(await legacySnapshot()).toEqual(before);
      expect(await prisma.curriculum.count({ where: { code: contextCode } })).toBe(0);
    },
  );

  it('blocks an external prerequisite without copying another curriculum dependency', async () => {
    // The first course depends on a fixture course excluded from this smaller source.
    const smaller = Buffer.from(
      JSON.stringify([{ year: 1, semester: 1, courses: [row(secondCode, 'Simulated B')] }]),
    );
    await expect(backfillCsReference(smaller, contextCode)).rejects.toThrow(
      'EXTERNAL_PREREQUISITE',
    );
    expect(await prisma.curriculum.count({ where: { code: contextCode } })).toBe(0);
  });

  it('rejects conflicting context metadata and leaves its existing rows untouched', async () => {
    const result = await backfillCsReference(bytes(), contextCode);
    await prisma.curriculum.update({
      where: { id: result.curriculumId },
      data: { totalCredits: 999 },
    });
    const before = await contextSnapshot();
    await expect(backfillCsReference(bytes(), contextCode)).rejects.toThrow('context metadata');
    expect(await contextSnapshot()).toEqual(before);
  });

  it('rejects conflicting placements and rolls back a membership repair', async () => {
    const result = await backfillCsReference(bytes(), contextCode);
    await prisma.curriculumCourse.delete({
      where: { curriculumId_courseId: { curriculumId: result.curriculumId, courseId: firstId } },
    });
    await prisma.curriculumPlacement.updateMany({
      where: { curriculumCourse: { curriculumId: result.curriculumId } },
      data: { electiveGroup: 'Wrong group' },
    });
    const before = await contextSnapshot();
    await expect(backfillCsReference(bytes(), contextCode)).rejects.toThrow('placement');
    expect(await contextSnapshot()).toEqual(before);
  });

  it('rejects an extra context placement rather than deleting or accepting it', async () => {
    await backfillCsReference(bytes(), contextCode);
    const saved = await contextSnapshot();
    await prisma.curriculumPlacement.create({
      data: { curriculumCourseId: saved.courses[0].id, sourceOrder: 99 },
    });
    const before = await contextSnapshot();
    await expect(backfillCsReference(bytes(), contextCode)).rejects.toThrow('placement');
    expect(await contextSnapshot()).toEqual(before);
  });

  it('rejects conflicting requirements without replacing them', async () => {
    const result = await backfillCsReference(bytes(), contextCode);
    await prisma.curriculumRequirement.updateMany({
      where: { curriculumId: result.curriculumId },
      data: { credits: 4 },
    });
    const before = await contextSnapshot();
    await expect(backfillCsReference(bytes(), contextCode)).rejects.toThrow('requirement');
    expect(await contextSnapshot()).toEqual(before);
  });

  it('rejects context prerequisite flag conflicts while preserving the legacy policy evidence', async () => {
    const result = await backfillCsReference(bytes(), contextCode);
    await prisma.curriculumPrerequisite.updateMany({
      where: { curriculumId: result.curriculumId },
      data: { isStrict: true },
    });
    const before = await contextSnapshot();
    await expect(backfillCsReference(bytes(), contextCode)).rejects.toThrow('prerequisite');
    expect(await contextSnapshot()).toEqual(before);
  });

  it('rejects changed legacy prerequisite provenance instead of silently extending the context', async () => {
    await backfillCsReference(bytes(), contextCode);
    const before = await contextSnapshot();
    await prisma.prerequisite.updateMany({
      where: { courseId: secondId },
      data: { isStrict: true },
    });
    await expect(backfillCsReference(bytes(), contextCode)).rejects.toThrow('context metadata');
    expect(await contextSnapshot()).toEqual(before);
  });

  it('rejects changed source bytes even when the parsed curriculum is equivalent', async () => {
    await backfillCsReference(bytes(), contextCode);
    const before = await contextSnapshot();
    await expect(
      backfillCsReference(Buffer.from(JSON.stringify(input(), null, 2)), contextCode),
    ).rejects.toThrow('context metadata');
    expect(await contextSnapshot()).toEqual(before);
  });

  it('concurrent identical runs converge to one complete context without duplicate rows', async () => {
    const results = await Promise.all([
      backfillCsReference(bytes(), contextCode),
      backfillCsReference(bytes(), contextCode),
    ]);
    expect(new Set(results.map(({ curriculumId }) => curriculumId)).size).toBe(1);
    expect(results.reduce((sum, { created }) => sum + created.context, 0)).toBe(1);
    const saved = await contextSnapshot();
    expect(saved.courses).toHaveLength(2);
    expect(saved.courses.flatMap(({ placements }) => placements)).toHaveLength(4);
    expect(saved.requirements).toHaveLength(1);
  });

  it('rejects malformed JSON and source structure without writing context rows', async () => {
    await expect(backfillCsReference(Buffer.from('{'), contextCode)).rejects.toThrow(
      'Invalid JSON',
    );
    await expect(backfillCsReference(Buffer.from('[]'), contextCode)).rejects.toThrow();
    expect(await prisma.curriculum.count({ where: { code: contextCode } })).toBe(0);
  });
});
