import { randomUUID } from 'crypto';
import { prisma } from '../db';

describe('uncoded curriculum requirements (PostgreSQL)', () => {
  const prefix = `requirement-${randomUUID()}`;
  const courseId = randomUUID();
  const userId = randomUUID();
  let curriculumId: string;
  const curriculumData = (suffix: string) => ({
    code: `${prefix}-${suffix}`,
    name: 'Simulated curriculum',
    school: 'CSE',
    degree: 'Bachelor',
    programUrl: 'https://example.test/reference',
  });
  const requirementData = () => ({
    curriculumId,
    name: 'Free elective',
    credits: 3,
    academicYear: 3,
    academicSemester: 2,
    sourceOrder: 51,
    sourceLabel: 'Legacy CS reference',
  });

  beforeAll(async () => {
    await prisma.user.create({
      data: {
        id: userId,
        studentId: prefix,
        name: 'Simulated student',
        email: `${prefix}@example.test`,
      },
    });
    await prisma.course.create({
      data: { id: courseId, code: prefix, name: 'Global course', credits: 3, difficultyLevel: 2 },
    });
    await prisma.studentRecord.create({ data: { userId, courseId, status: 'COMPLETED' } });
  });

  beforeEach(async () => {
    await prisma.curriculum.deleteMany({ where: { code: { startsWith: prefix } } });
    curriculumId = (await prisma.curriculum.create({ data: curriculumData('first') })).id;
  });

  afterAll(async () => {
    await prisma.curriculum.deleteMany({ where: { code: { startsWith: prefix } } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.course.deleteMany({ where: { id: courseId } });
    await prisma.$disconnect();
  });

  it('preserves the free-elective requirement without a global course or membership', async () => {
    const before = await prisma.course.count();
    const saved = await prisma.curriculumRequirement.create({ data: requirementData() });
    expect(saved).toMatchObject({ ...requirementData(), kind: 'FREE_ELECTIVE' });
    expect(await prisma.course.count()).toBe(before);
    expect(await prisma.curriculumCourse.count({ where: { curriculumId } })).toBe(0);
    expect(
      await prisma.curriculum.findUniqueOrThrow({ where: { id: curriculumId } }),
    ).toMatchObject({ totalCredits: null });
  });

  it('keeps source order unique within a curriculum while allowing separate contexts and rows', async () => {
    const first = await prisma.curriculumRequirement.create({ data: requirementData() });
    await expect(
      prisma.curriculumRequirement.create({ data: requirementData() }),
    ).rejects.toMatchObject({ code: 'P2002' });
    await prisma.curriculumRequirement.create({
      data: { ...requirementData(), sourceOrder: 52, academicSemester: 3 },
    });
    const other = await prisma.curriculum.create({ data: curriculumData('second') });
    await prisma.curriculumRequirement.create({
      data: { ...requirementData(), curriculumId: other.id },
    });
    expect(
      await prisma.curriculumRequirement.findUniqueOrThrow({ where: { id: first.id } }),
    ).toEqual(first);
    expect(await prisma.curriculumRequirement.count({ where: { curriculumId } })).toBe(2);
  });

  it('rejects an unknown curriculum without storing a partial requirement', async () => {
    await expect(
      prisma.curriculumRequirement.create({
        data: { ...requirementData(), curriculumId: randomUUID() },
      }),
    ).rejects.toMatchObject({ code: 'P2003' });
    expect(await prisma.curriculumRequirement.count({ where: { curriculumId } })).toBe(0);
  });

  it('deletes only context requirements and clears assignment while preserving student evidence', async () => {
    const evidence = await prisma.studentRecord.findUniqueOrThrow({
      where: { userId_courseId: { userId, courseId } },
    });
    await prisma.curriculumRequirement.create({ data: requirementData() });
    await prisma.user.update({ where: { id: userId }, data: { curriculumId } });
    await prisma.curriculum.delete({ where: { id: curriculumId } });
    expect(await prisma.curriculumRequirement.count({ where: { curriculumId } })).toBe(0);
    expect(await prisma.user.findUniqueOrThrow({ where: { id: userId } })).toMatchObject({
      curriculumId: null,
    });
    expect(await prisma.studentRecord.findUniqueOrThrow({ where: { id: evidence.id } })).toEqual(
      evidence,
    );
    expect(await prisma.course.count({ where: { id: courseId } })).toBe(1);
  });

  it.each([0, -1])(
    'rejects nonpositive requirement credits %i at the database boundary',
    async (credits) => {
      await expect(
        prisma.curriculumRequirement.create({ data: { ...requirementData(), credits } }),
      ).rejects.toThrow('violates check constraint');
      expect(await prisma.curriculumRequirement.count({ where: { curriculumId } })).toBe(0);
    },
  );

  it.each([
    { academicYear: 0 },
    { academicSemester: 0 },
    { academicSemester: 4 },
    { sourceOrder: -1 },
  ])('rejects invalid occurrence metadata %#', async (invalid) => {
    await expect(
      prisma.curriculumRequirement.create({ data: { ...requirementData(), ...invalid } }),
    ).rejects.toThrow('violates check constraint');
    expect(await prisma.curriculumRequirement.count({ where: { curriculumId } })).toBe(0);
  });

  it('allows an explicitly unknown slot and zero source order without inventing placement', async () => {
    const saved = await prisma.curriculumRequirement.create({
      data: { curriculumId, name: 'Free elective', credits: 1, sourceOrder: 0 },
    });
    expect(saved).toMatchObject({
      academicYear: null,
      academicSemester: null,
      sourceLabel: null,
      sourceOrder: 0,
      kind: 'FREE_ELECTIVE',
    });
  });
});
