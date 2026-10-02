-- CreateEnum
CREATE TYPE "CourseCategory" AS ENUM ('REQUIRED', 'ELECTIVE', 'CORE', 'MAJOR_ELECTIVE', 'GENERAL_EDUCATION', 'FREE_ELECTIVE');

-- CreateEnum
CREATE TYPE "Semester" AS ENUM ('FALL', 'SPRING', 'SUMMER');

-- CreateEnum
CREATE TYPE "CourseStatus" AS ENUM ('PLANNED', 'IN_PROGRESS', 'COMPLETED', 'FAILED', 'DROPPED');

-- CreateTable
CREATE TABLE "courses" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "credits" INTEGER NOT NULL,
    "difficulty_level" SMALLINT NOT NULL,
    "description" TEXT,
    "category" "CourseCategory" NOT NULL DEFAULT 'REQUIRED',
    "semesterOffered" "Semester"[] DEFAULT ARRAY['FALL', 'SPRING']::"Semester"[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "courses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prerequisites" (
    "id" TEXT NOT NULL,
    "course_id" TEXT NOT NULL,
    "prerequisite_id" TEXT NOT NULL,
    "is_corequisite" BOOLEAN NOT NULL DEFAULT false,
    "is_strict" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prerequisites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "student_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT,
    "major" TEXT,
    "enrollment_year" INTEGER,
    "target_graduation_year" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student_records" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "course_id" TEXT NOT NULL,
    "grade" TEXT,
    "grade_points" DOUBLE PRECISION,
    "semester" TEXT,
    "year" INTEGER,
    "status" "CourseStatus" NOT NULL DEFAULT 'COMPLETED',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "student_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "study_plans" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "study_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "planned_semesters" (
    "id" TEXT NOT NULL,
    "study_plan_id" TEXT NOT NULL,
    "semester" "Semester" NOT NULL,
    "year" INTEGER NOT NULL,
    "courses" JSONB NOT NULL,
    "total_credits" INTEGER NOT NULL DEFAULT 0,
    "difficulty_score" DOUBLE PRECISION,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "planned_semesters_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "courses_code_key" ON "courses"("code");

-- CreateIndex
CREATE INDEX "courses_code_idx" ON "courses"("code");

-- CreateIndex
CREATE INDEX "courses_category_idx" ON "courses"("category");

-- CreateIndex
CREATE INDEX "prerequisites_course_id_idx" ON "prerequisites"("course_id");

-- CreateIndex
CREATE INDEX "prerequisites_prerequisite_id_idx" ON "prerequisites"("prerequisite_id");

-- CreateIndex
CREATE UNIQUE INDEX "prerequisites_course_id_prerequisite_id_key" ON "prerequisites"("course_id", "prerequisite_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_student_id_key" ON "users"("student_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_student_id_idx" ON "users"("student_id");

-- CreateIndex
CREATE INDEX "users_email_idx" ON "users"("email");

-- CreateIndex
CREATE INDEX "student_records_user_id_idx" ON "student_records"("user_id");

-- CreateIndex
CREATE INDEX "student_records_course_id_idx" ON "student_records"("course_id");

-- CreateIndex
CREATE UNIQUE INDEX "student_records_user_id_course_id_key" ON "student_records"("user_id", "course_id");

-- CreateIndex
CREATE INDEX "study_plans_user_id_idx" ON "study_plans"("user_id");

-- CreateIndex
CREATE INDEX "planned_semesters_study_plan_id_idx" ON "planned_semesters"("study_plan_id");

-- CreateIndex
CREATE UNIQUE INDEX "planned_semesters_study_plan_id_semester_year_key" ON "planned_semesters"("study_plan_id", "semester", "year");

-- AddForeignKey
ALTER TABLE "prerequisites" ADD CONSTRAINT "prerequisites_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prerequisites" ADD CONSTRAINT "prerequisites_prerequisite_id_fkey" FOREIGN KEY ("prerequisite_id") REFERENCES "courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_records" ADD CONSTRAINT "student_records_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_records" ADD CONSTRAINT "student_records_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "study_plans" ADD CONSTRAINT "study_plans_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "planned_semesters" ADD CONSTRAINT "planned_semesters_study_plan_id_fkey" FOREIGN KEY ("study_plan_id") REFERENCES "study_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;
