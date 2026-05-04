import { PrismaClient, CourseCategory, Semester, CourseStatus } from '@prisma/client';
import { readFileSync } from 'fs';
import { join } from 'path';

const prisma = new PrismaClient();

interface ScrapedCourse {
  id: string;
  name: string;
  credits: number;
  lectureHours: number;
  labHours: number;
  year: number;
  semester: number;
  isElective: boolean;
  electiveGroup?: string;
  selectCount?: number;
}

interface ScrapedSemester {
  year: number;
  semester: number;
  courses: ScrapedCourse[];
}

function determineCategory(course: ScrapedCourse): CourseCategory {
  if (course.isElective) {
    return CourseCategory.MAJOR_ELECTIVE;
  }
  return CourseCategory.REQUIRED;
}

function determineSemesterOffered(scrapedSem: number): Semester[] {
  if (scrapedSem === 1) return [Semester.FALL];
  if (scrapedSem === 2) return [Semester.SPRING];
  if (scrapedSem === 3) return [Semester.SUMMER];
  return [Semester.FALL, Semester.SPRING];
}

function calculateDifficulty(course: ScrapedCourse): number {
  const difficulty = course.year + (course.credits >= 4 ? 1 : 0);
  return Math.max(1, Math.min(5, difficulty));
}

function generateDescription(course: ScrapedCourse): string | undefined {
  const parts: string[] = [];
  if (course.lectureHours > 0) {
    parts.push(`${course.lectureHours}h lecture`);
  }
  if (course.labHours > 0) {
    parts.push(`${course.labHours}h lab`);
  }
  return parts.length > 0 ? parts.join(', ') : undefined;
}

function inferPrerequisites(allCourses: Map<string, ScrapedCourse>): { course: string; prerequisite: string }[] {
  const prerequisites: { course: string; prerequisite: string }[] = [];

  const labToLecture: Record<string, string> = {
    'IT099IU': 'IT067IU',
    'IT101IU': 'IT074IU',
    'IT098IU': 'IT068IU',
    'IT106IU': 'IT105IU',
    'IT129IU': 'IT128IU',
    'IT126IU': 'IT110IU',
    'PH016IU': 'PH015IU',
  };

  for (const [labCode, lectureCode] of Object.entries(labToLecture)) {
    if (allCourses.has(labCode) && allCourses.has(lectureCode)) {
      prerequisites.push({ course: labCode, prerequisite: lectureCode });
    }
  }

  const yearProgression: Record<string, string[]> = {
    'IT069IU': ['IT116IU', 'IT149IU'],
    'IT013IU': ['IT069IU', 'IT153IU'],
    'IT079IU': ['IT069IU'],
    'MA003IU': ['MA001IU'],
    'IT089IU': ['IT067IU', 'IT099IU'],
    'IT090IU': ['IT069IU'],
    'IT096IU': ['IT091IU'],
    'IT125IU': ['IT091IU'],
    'IT017IU': ['IT089IU', 'IT013IU'],
    'IT139IU': ['IT091IU'],
    'IT114IU': ['IT090IU'],
    'IT160IU': ['IT079IU', 'MA026IU'],
    'IT130IU': ['MA001IU', 'IT154IU'],
    'IT117IU': ['IT091IU'],
    'IT076IU': ['IT090IU'],
    'IT172IU': ['IT013IU', 'MA001IU'],
    'IT170IU': ['IT159IU'],
    'IT082IU': ['IT013IU'],
    'IT083IU': ['IT076IU'],
    'IT103IU': ['MA001IU', 'MA003IU'],
    'IT173IU': ['IT079IU', 'MA026IU'],
    'IT168IU': ['IT083IU'],
    'IT169IU': ['MA026IU'],
    'IT157IU': ['IT159IU'],
    'IT133IU': ['IT093IU'],
    'IT164IU': ['IT091IU'],
    'IT165IU': ['IT091IU'],
    'IT166IU': ['IT076IU'],
    'IT167IU': ['IT093IU'],
    'IT150IU': ['IT079IU'],
    'IT156IU': ['IT091IU'],
    'IT138IU': ['MA026IU'],
    'IT171IU': ['MA026IU'],
    'IT136IU': ['MA026IU'],
    'IT137IU': ['IT079IU', 'MA026IU'],
    'IT144IU': ['IT094IU'],
    'IT145IU': ['IT094IU'],
    'IT146IU': ['IT091IU'],
    'IT163IU': ['MA003IU', 'IT153IU'],
  };

  for (const [courseCode, prereqCodes] of Object.entries(yearProgression)) {
    if (allCourses.has(courseCode)) {
      for (const prereqCode of prereqCodes) {
        if (allCourses.has(prereqCode)) {
          prerequisites.push({ course: courseCode, prerequisite: prereqCode });
        }
      }
    }
  }

  return prerequisites;
}

async function main() {
  console.log('Starting database seed with real HCMIU CS course data...');

  const existingUser = await prisma.user.findFirst();
  if (existingUser) {
    console.log('Database is already seeded. Skipping seed process.');
    return;
  }

  const scrapedDataPath = join(__dirname, '../../scraped-courses.json');
  const scrapedData: ScrapedSemester[] = JSON.parse(readFileSync(scrapedDataPath, 'utf8'));

  const allCoursesFlat: ScrapedCourse[] = [];
  for (const sem of scrapedData) {
    for (const course of sem.courses) {
      allCoursesFlat.push(course);
    }
  }

  console.log(`Loaded ${allCoursesFlat.length} courses from scraped-courses.json`);

  const courseCodeToId: Map<string, string> = new Map();
  const allCoursesMap: Map<string, ScrapedCourse> = new Map();

  for (const course of allCoursesFlat) {
    allCoursesMap.set(course.id, course);
  }

  console.log('Creating courses...');
  for (const course of allCoursesFlat) {
    const category = determineCategory(course);
    const difficultyLevel = calculateDifficulty(course);
    const semesterOffered = determineSemesterOffered(course.semester);
    const description = generateDescription(course);

    const created = await prisma.course.create({
      data: {
        code: course.id,
        name: course.name,
        credits: course.credits,
        difficultyLevel,
        category,
        semesterOffered,
        description,
      },
    });

    courseCodeToId.set(course.id, created.id);
    console.log(`  Created: ${course.id} - ${course.name} [${category}, difficulty:${difficultyLevel}]`);
  }

  const prerequisitePairs = inferPrerequisites(allCoursesMap);

  console.log(`\nCreating ${prerequisitePairs.length} prerequisite relationships...`);
  for (const pair of prerequisitePairs) {
    const courseId = courseCodeToId.get(pair.course);
    const prerequisiteId = courseCodeToId.get(pair.prerequisite);

    if (courseId && prerequisiteId) {
      await prisma.prerequisite.create({
        data: {
          courseId,
          prerequisiteId,
        },
      });
      console.log(`  ${pair.prerequisite} -> ${pair.course}`);
    }
  }

  console.log('\nCreating sample user...');
  const sampleUser = await prisma.user.create({
    data: {
      studentId: 'IT2001001',
      name: 'Nguyen Van A',
      email: 'it2001001@student.hcmiu.edu.vn',
      major: 'Computer Science',
      enrollmentYear: 2022,
      targetGraduationYear: 2026,
    },
  });
  console.log(`  Created user: ${sampleUser.name} (${sampleUser.studentId})`);

  console.log('\nCreating sample student records...');
  const completedCourses = ['MA001IU', 'EN008IU', 'EN007IU', 'IT064IU', 'IT116IU', 'PT001IU', 'PH013IU', 'IT135IU', 'IT149IU'];

  for (let i = 0; i < completedCourses.length; i++) {
    const courseCode = completedCourses[i];
    const courseId = courseCodeToId.get(courseCode);
    if (courseId) {
      await prisma.studentRecord.create({
        data: {
          userId: sampleUser.id,
          courseId,
          grade: ['A', 'B+', 'B', 'A-', 'B+'][i % 5],
          gradePoints: [4.0, 3.5, 3.0, 3.7, 3.5][i % 5],
          semester: 'Fall',
          year: 2022,
          status: CourseStatus.COMPLETED,
        },
      });
      console.log(`  Completed: ${courseCode}`);
    }
  }

  console.log('\nCreating sample study plan...');
  const studyPlan = await prisma.studyPlan.create({
    data: {
      userId: sampleUser.id,
      name: 'My 4-Year Study Plan',
      description: 'Balanced course load following HCMIU CS curriculum',
      isActive: true,
    },
  });

  const plannedSemesters = [
    {
      semester: Semester.SPRING,
      year: 2023,
      courses: ['IT153IU', 'EN012IU', 'EN011IU', 'IT067IU', 'IT099IU', 'IT069IU', 'IT154IU'],
    },
    {
      semester: Semester.FALL,
      year: 2023,
      courses: ['IT013IU', 'IT079IU', 'MA003IU', 'IT068IU', 'IT098IU'],
    },
    {
      semester: Semester.SPRING,
      year: 2024,
      courses: ['IT089IU', 'IT093IU', 'IT090IU', 'IT024IU', 'IT159IU'],
    },
    {
      semester: Semester.FALL,
      year: 2024,
      courses: ['IT017IU', 'IT096IU', 'IT125IU', 'IT139IU'],
    },
    {
      semester: Semester.SPRING,
      year: 2025,
      courses: ['IT117IU', 'IT076IU', 'IT172IU', 'IT170IU'],
    },
    {
      semester: Semester.FALL,
      year: 2025,
      courses: ['IT083IU', 'IT110IU', 'IT126IU', 'IT103IU'],
    },
    {
      semester: Semester.SPRING,
      year: 2026,
      courses: ['IT058IU', 'IT168IU'],
    },
  ];

  for (const plan of plannedSemesters) {
    const courseData = plan.courses
      .filter((code) => courseCodeToId.has(code))
      .map((code, index) => ({
        courseId: courseCodeToId.get(code)!,
        position: index,
      }));

    const validCodes = plan.courses.filter((code) => courseCodeToId.has(code));
    const totalCredits = validCodes.reduce((sum, code) => {
      const course = allCoursesMap.get(code);
      return sum + (course?.credits ?? 0);
    }, 0);

    const difficultyScore =
      validCodes.reduce((sum, code) => {
        const course = allCoursesMap.get(code);
        return sum + calculateDifficulty(course!);
      }, 0) / validCodes.length;

    await prisma.plannedSemester.create({
      data: {
        studyPlanId: studyPlan.id,
        semester: plan.semester,
        year: plan.year,
        courses: courseData,
        totalCredits,
        difficultyScore,
      },
    });
    console.log(`  Planned: ${plan.semester} ${plan.year}: ${validCodes.join(', ')} (${totalCredits} credits)`);
  }

  const totalCredits = allCoursesFlat.reduce((sum, c) => sum + c.credits, 0);
  const electiveCount = allCoursesFlat.filter((c) => c.isElective).length;
  const requiredCount = allCoursesFlat.length - electiveCount;

  console.log('\nDatabase seeded successfully!');
  console.log('\nSummary:');
  console.log(`  Courses created: ${allCoursesFlat.length}`);
  console.log(`  Prerequisites created: ${prerequisitePairs.length}`);
  console.log(`  Required courses: ${requiredCount}`);
  console.log(`  Elective courses: ${electiveCount}`);
  console.log(`  Total credits: ${totalCredits}`);
  console.log(`  Users created: 1`);
  console.log(`  Study plans created: 1 with ${plannedSemesters.length} semesters`);
}

main()
  .catch((e) => {
    console.error('Error seeding database:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
