import { PrismaClient, CourseCategory, Semester, CourseStatus } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Starting database seed...');

  // Sample Computer Science courses (IU curriculum inspired)
  const courses = [
    // Year 1 - Semester 1
    {
      code: 'IT100',
      name: 'Introduction to Computing',
      credits: 3,
      difficultyLevel: 1,
      category: CourseCategory.REQUIRED,
      semesterOffered: [Semester.FALL, Semester.SPRING],
    },
    {
      code: 'MA101',
      name: 'Calculus I',
      credits: 3,
      difficultyLevel: 3,
      category: CourseCategory.REQUIRED,
      semesterOffered: [Semester.FALL, Semester.SPRING],
    },
    {
      code: 'PH101',
      name: 'Physics I',
      credits: 3,
      difficultyLevel: 3,
      category: CourseCategory.REQUIRED,
      semesterOffered: [Semester.FALL, Semester.SPRING],
    },

    // Year 1 - Semester 2
    {
      code: 'IT101',
      name: 'Programming Fundamentals',
      credits: 3,
      difficultyLevel: 2,
      category: CourseCategory.CORE,
      semesterOffered: [Semester.FALL, Semester.SPRING],
    },
    {
      code: 'MA102',
      name: 'Calculus II',
      credits: 3,
      difficultyLevel: 3,
      category: CourseCategory.REQUIRED,
      semesterOffered: [Semester.FALL, Semester.SPRING],
    },
    {
      code: 'PH102',
      name: 'Physics II',
      credits: 3,
      difficultyLevel: 3,
      category: CourseCategory.REQUIRED,
      semesterOffered: [Semester.FALL, Semester.SPRING],
    },

    // Year 2 - Semester 1
    {
      code: 'IT102',
      name: 'Object-Oriented Programming',
      credits: 3,
      difficultyLevel: 3,
      category: CourseCategory.CORE,
      semesterOffered: [Semester.FALL, Semester.SPRING],
    },
    {
      code: 'MA203',
      name: 'Discrete Mathematics',
      credits: 3,
      difficultyLevel: 4,
      category: CourseCategory.CORE,
      semesterOffered: [Semester.FALL, Semester.SPRING],
    },
    {
      code: 'IT200',
      name: 'Data Structures',
      credits: 3,
      difficultyLevel: 4,
      category: CourseCategory.CORE,
      semesterOffered: [Semester.FALL, Semester.SPRING],
    },
    {
      code: 'IT201',
      name: 'Computer Architecture',
      credits: 3,
      difficultyLevel: 3,
      category: CourseCategory.CORE,
      semesterOffered: [Semester.FALL, Semester.SPRING],
    },

    // Year 2 - Semester 2
    {
      code: 'IT202',
      name: 'Algorithms',
      credits: 3,
      difficultyLevel: 5,
      category: CourseCategory.CORE,
      semesterOffered: [Semester.FALL, Semester.SPRING],
    },
    {
      code: 'IT203',
      name: 'Database Systems',
      credits: 3,
      difficultyLevel: 3,
      category: CourseCategory.CORE,
      semesterOffered: [Semester.FALL, Semester.SPRING],
    },
    {
      code: 'IT204',
      name: 'Operating Systems',
      credits: 3,
      difficultyLevel: 4,
      category: CourseCategory.CORE,
      semesterOffered: [Semester.FALL, Semester.SPRING],
    },
    {
      code: 'MA205',
      name: 'Probability & Statistics',
      credits: 3,
      difficultyLevel: 3,
      category: CourseCategory.REQUIRED,
      semesterOffered: [Semester.FALL, Semester.SPRING],
    },

    // Year 3 - Semester 1
    {
      code: 'IT300',
      name: 'Software Engineering',
      credits: 3,
      difficultyLevel: 3,
      category: CourseCategory.CORE,
      semesterOffered: [Semester.FALL, Semester.SPRING],
    },
    {
      code: 'IT301',
      name: 'Computer Networks',
      credits: 3,
      difficultyLevel: 4,
      category: CourseCategory.CORE,
      semesterOffered: [Semester.FALL, Semester.SPRING],
    },
    {
      code: 'IT302',
      name: 'Web Development',
      credits: 3,
      difficultyLevel: 2,
      category: CourseCategory.ELECTIVE,
      semesterOffered: [Semester.FALL, Semester.SPRING],
    },
    {
      code: 'IT303',
      name: 'Artificial Intelligence',
      credits: 3,
      difficultyLevel: 5,
      category: CourseCategory.ELECTIVE,
      semesterOffered: [Semester.FALL],
    },

    // Year 3 - Semester 2
    {
      code: 'IT304',
      name: 'Machine Learning',
      credits: 3,
      difficultyLevel: 5,
      category: CourseCategory.ELECTIVE,
      semesterOffered: [Semester.SPRING],
    },
    {
      code: 'IT305',
      name: 'Mobile Development',
      credits: 3,
      difficultyLevel: 3,
      category: CourseCategory.ELECTIVE,
      semesterOffered: [Semester.SPRING],
    },
    {
      code: 'IT306',
      name: 'Information Security',
      credits: 3,
      difficultyLevel: 4,
      category: CourseCategory.CORE,
      semesterOffered: [Semester.FALL, Semester.SPRING],
    },
    {
      code: 'IT307',
      name: 'Cloud Computing',
      credits: 3,
      difficultyLevel: 3,
      category: CourseCategory.ELECTIVE,
      semesterOffered: [Semester.SPRING],
    },

    // Year 4 - Semester 1
    {
      code: 'IT400',
      name: 'Capstone Project I',
      credits: 3,
      difficultyLevel: 4,
      category: CourseCategory.REQUIRED,
      semesterOffered: [Semester.FALL],
    },
    {
      code: 'IT401',
      name: 'Distributed Systems',
      credits: 3,
      difficultyLevel: 5,
      category: CourseCategory.ELECTIVE,
      semesterOffered: [Semester.FALL],
    },
    {
      code: 'IT402',
      name: 'Data Mining',
      credits: 3,
      difficultyLevel: 4,
      category: CourseCategory.ELECTIVE,
      semesterOffered: [Semester.FALL],
    },

    // Year 4 - Semester 2
    {
      code: 'IT403',
      name: 'Capstone Project II',
      credits: 3,
      difficultyLevel: 4,
      category: CourseCategory.REQUIRED,
      semesterOffered: [Semester.SPRING],
    },
    {
      code: 'IT404',
      name: 'Blockchain Technology',
      credits: 3,
      difficultyLevel: 4,
      category: CourseCategory.ELECTIVE,
      semesterOffered: [Semester.SPRING],
    },
    {
      code: 'IT405',
      name: 'Internship',
      credits: 6,
      difficultyLevel: 2,
      category: CourseCategory.REQUIRED,
      semesterOffered: [Semester.SPRING, Semester.SUMMER],
    },
  ];

  // Create courses
  console.log('Creating courses...');
  const createdCourses: Record<string, { id: string, name: string, code: string, credits: number, difficultyLevel: number }> = {};

  for (const courseData of courses) {
    const course = await prisma.course.create({
      data: courseData,
    });
    createdCourses[course.code] = course;
    console.log(`  ✅ Created: ${course.code} - ${course.name}`);
  }

  // Define prerequisites
  const prerequisites = [
    // IT101 requires IT100
    { course: 'IT101', prerequisite: 'IT100' },
    // MA102 requires MA101
    { course: 'MA102', prerequisite: 'MA101' },
    // PH102 requires PH101
    { course: 'PH102', prerequisite: 'PH101' },
    // IT102 requires IT101
    { course: 'IT102', prerequisite: 'IT101' },
    // IT200 requires IT101 and MA101
    { course: 'IT200', prerequisite: 'IT101' },
    { course: 'IT200', prerequisite: 'MA101' },
    // IT201 requires IT100
    { course: 'IT201', prerequisite: 'IT100' },
    // IT202 requires IT200 and MA203
    { course: 'IT202', prerequisite: 'IT200' },
    { course: 'IT202', prerequisite: 'MA203' },
    // IT203 requires IT200
    { course: 'IT203', prerequisite: 'IT200' },
    // IT204 requires IT201 and IT200
    { course: 'IT204', prerequisite: 'IT201' },
    { course: 'IT204', prerequisite: 'IT200' },
    // MA203 requires MA102
    { course: 'MA203', prerequisite: 'MA102' },
    // IT300 requires IT102
    { course: 'IT300', prerequisite: 'IT102' },
    // IT301 requires IT204
    { course: 'IT301', prerequisite: 'IT204' },
    // IT302 requires IT102
    { course: 'IT302', prerequisite: 'IT102' },
    // IT303 requires IT202 and MA205
    { course: 'IT303', prerequisite: 'IT202' },
    { course: 'IT303', prerequisite: 'MA205' },
    // IT304 requires IT303
    { course: 'IT304', prerequisite: 'IT303' },
    // IT305 requires IT102
    { course: 'IT305', prerequisite: 'IT102' },
    // IT306 requires IT301
    { course: 'IT306', prerequisite: 'IT301' },
    // IT307 requires IT301
    { course: 'IT307', prerequisite: 'IT301' },
    // IT400 requires IT300
    { course: 'IT400', prerequisite: 'IT300' },
    // IT401 requires IT301 and IT204
    { course: 'IT401', prerequisite: 'IT301' },
    { course: 'IT401', prerequisite: 'IT204' },
    // IT402 requires IT203 and MA205
    { course: 'IT402', prerequisite: 'IT203' },
    { course: 'IT402', prerequisite: 'MA205' },
    // IT403 requires IT400
    { course: 'IT403', prerequisite: 'IT400' },
    // IT404 requires IT306
    { course: 'IT404', prerequisite: 'IT306' },
  ];

  // Create prerequisites
  console.log('\nCreating prerequisite relationships...');
  for (const prereq of prerequisites) {
    const course = createdCourses[prereq.course];
    const prerequisite = createdCourses[prereq.prerequisite];

    if (course && prerequisite) {
      await prisma.prerequisite.create({
        data: {
          courseId: course.id,
          prerequisiteId: prerequisite.id,
        },
      });
      console.log(`  🔗 ${prereq.prerequisite} → ${prereq.course}`);
    }
  }

  // Create a sample user
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
  console.log(`  👤 Created user: ${sampleUser.name} (${sampleUser.studentId})`);

  // Create sample student records (completed courses)
  console.log('\nCreating sample student records...');
  const completedCourses = [
    'IT100',
    'MA101',
    'PH101',
    'IT101',
    'MA102',
    'PH102',
    'IT102',
    'MA203',
    'IT200',
  ];

  for (let i = 0; i < completedCourses.length; i++) {
    const course = createdCourses[completedCourses[i]];
    if (course) {
      await prisma.studentRecord.create({
        data: {
          userId: sampleUser.id,
          courseId: course.id,
          grade: ['A', 'B+', 'B', 'A-', 'B+'][Math.floor(Math.random() * 5)],
          gradePoints: [4.0, 3.5, 3.0, 3.7, 3.5][Math.floor(Math.random() * 5)],
          semester: i < 3 ? 'Fall' : i < 6 ? 'Spring' : 'Fall',
          year: i < 3 ? 2022 : i < 6 ? 2023 : 2023,
          status: CourseStatus.COMPLETED,
        },
      });
      console.log(`  ✅ Completed: ${course.code}`);
    }
  }

  // Create a sample study plan
  console.log('\nCreating sample study plan...');
  const studyPlan = await prisma.studyPlan.create({
    data: {
      userId: sampleUser.id,
      name: 'My 4-Year Study Plan',
      description: 'Balanced course load with focus on core CS courses',
      isActive: true,
    },
  });

  // Add planned semesters
  const plannedSemesters = [
    {
      semester: Semester.SPRING,
      year: 2024,
      courses: ['IT201', 'IT202', 'IT203', 'IT204', 'MA205'],
    },
    { semester: Semester.FALL, year: 2024, courses: ['IT300', 'IT301', 'IT302', 'IT303'] },
    { semester: Semester.SPRING, year: 2025, courses: ['IT304', 'IT305', 'IT306', 'IT307'] },
    { semester: Semester.FALL, year: 2025, courses: ['IT400', 'IT401', 'IT402'] },
    { semester: Semester.SPRING, year: 2026, courses: ['IT403', 'IT404', 'IT405'] },
  ];

  for (const plan of plannedSemesters) {
    const courseData = plan.courses.map((code, index) => ({
      courseId: createdCourses[code].id,
      position: index,
    }));

    const totalCredits = plan.courses.reduce((sum, code) => sum + createdCourses[code].credits, 0);
    const difficultyScore =
      plan.courses.reduce((sum, code) => sum + createdCourses[code].difficultyLevel, 0) /
      plan.courses.length;

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
    console.log(`  📅 ${plan.semester} ${plan.year}: ${plan.courses.join(', ')}`);
  }

  console.log('\n✨ Database seeded successfully!');
  console.log('\n📊 Summary:');
  console.log(`   - Courses created: ${courses.length}`);
  console.log(`   - Prerequisites created: ${prerequisites.length}`);
  console.log(`   - Users created: 1`);
  console.log(`   - Student records created: ${completedCourses.length}`);
  console.log(`   - Study plans created: 1 with ${plannedSemesters.length} semesters`);
}

main()
  .catch((e) => {
    console.error('❌ Error seeding database:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
