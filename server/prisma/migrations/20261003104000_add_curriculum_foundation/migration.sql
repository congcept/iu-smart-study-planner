-- Additive foundation only. No legacy data is converted or removed here.
-- CS backfill, unknown/free-elective requirements, and reader activation are separate steps.

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "curriculum_id" TEXT;

-- CreateTable
CREATE TABLE "curriculums" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "school" TEXT NOT NULL,
    "degree" TEXT NOT NULL,
    "program_url" TEXT NOT NULL,
    "total_credits" INTEGER,
    "is_gpa_path" BOOLEAN NOT NULL DEFAULT false,
    "source_label" TEXT,
    "source_url" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "curriculums_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "curriculum_courses" (
    "id" TEXT NOT NULL,
    "curriculum_id" TEXT NOT NULL,
    "course_id" TEXT NOT NULL,

    CONSTRAINT "curriculum_courses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "curriculum_placements" (
    "id" TEXT NOT NULL,
    "curriculum_course_id" TEXT NOT NULL,
    "academic_year" INTEGER,
    "academic_semester" INTEGER,
    "elective_group" TEXT,
    "elective_select_count" INTEGER,
    "source_order" INTEGER NOT NULL,
    "source_label" TEXT,

    CONSTRAINT "curriculum_placements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "curriculum_prerequisites" (
    "id" TEXT NOT NULL,
    "curriculum_id" TEXT NOT NULL,
    "course_id" TEXT NOT NULL,
    "prerequisite_id" TEXT NOT NULL,
    "is_corequisite" BOOLEAN NOT NULL DEFAULT false,
    "is_strict" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "curriculum_prerequisites_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "curriculums_code_key" ON "curriculums"("code");

-- CreateIndex
CREATE INDEX "curriculum_courses_course_id_idx" ON "curriculum_courses"("course_id");

-- CreateIndex
CREATE UNIQUE INDEX "curriculum_courses_curriculum_id_course_id_key" ON "curriculum_courses"("curriculum_id", "course_id");

-- CreateIndex
CREATE UNIQUE INDEX "curriculum_placements_curriculum_course_id_source_order_key" ON "curriculum_placements"("curriculum_course_id", "source_order");

-- CreateIndex
CREATE INDEX "curriculum_prerequisites_curriculum_id_prerequisite_id_idx" ON "curriculum_prerequisites"("curriculum_id", "prerequisite_id");

-- CreateIndex
CREATE UNIQUE INDEX "curriculum_prerequisites_curriculum_id_course_id_prerequisi_key" ON "curriculum_prerequisites"("curriculum_id", "course_id", "prerequisite_id");

-- CreateIndex
CREATE INDEX "users_curriculum_id_idx" ON "users"("curriculum_id");

-- AddForeignKey
ALTER TABLE "curriculum_courses" ADD CONSTRAINT "curriculum_courses_curriculum_id_fkey" FOREIGN KEY ("curriculum_id") REFERENCES "curriculums"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "curriculum_courses" ADD CONSTRAINT "curriculum_courses_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "curriculum_placements" ADD CONSTRAINT "curriculum_placements_curriculum_course_id_fkey" FOREIGN KEY ("curriculum_course_id") REFERENCES "curriculum_courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "curriculum_prerequisites" ADD CONSTRAINT "curriculum_prerequisites_curriculum_id_course_id_fkey" FOREIGN KEY ("curriculum_id", "course_id") REFERENCES "curriculum_courses"("curriculum_id", "course_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "curriculum_prerequisites" ADD CONSTRAINT "curriculum_prerequisites_curriculum_id_prerequisite_id_fkey" FOREIGN KEY ("curriculum_id", "prerequisite_id") REFERENCES "curriculum_courses"("curriculum_id", "course_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_curriculum_id_fkey" FOREIGN KEY ("curriculum_id") REFERENCES "curriculums"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CHECK constraints are maintained here because Prisma does not model them.
ALTER TABLE "curriculums" ADD CONSTRAINT "curriculums_total_credits_check"
    CHECK ("total_credits" IS NULL OR "total_credits" >= 0);

ALTER TABLE "curriculum_placements" ADD CONSTRAINT "curriculum_placements_academic_year_check"
    CHECK ("academic_year" IS NULL OR "academic_year" > 0);

ALTER TABLE "curriculum_placements" ADD CONSTRAINT "curriculum_placements_academic_semester_check"
    CHECK ("academic_semester" IS NULL OR "academic_semester" BETWEEN 1 AND 3);

ALTER TABLE "curriculum_placements" ADD CONSTRAINT "curriculum_placements_elective_select_count_check"
    CHECK ("elective_select_count" IS NULL OR "elective_select_count" > 0);

ALTER TABLE "curriculum_placements" ADD CONSTRAINT "curriculum_placements_source_order_check"
    CHECK ("source_order" >= 0);
