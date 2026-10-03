-- Additive storage for uncoded requirements only; no source data is converted here.
-- CreateEnum
CREATE TYPE "CurriculumRequirementKind" AS ENUM ('FREE_ELECTIVE');

-- CreateTable
CREATE TABLE "curriculum_requirements" (
    "id" TEXT NOT NULL,
    "curriculum_id" TEXT NOT NULL,
    "kind" "CurriculumRequirementKind" NOT NULL DEFAULT 'FREE_ELECTIVE',
    "name" TEXT NOT NULL,
    "credits" INTEGER NOT NULL,
    "academic_year" INTEGER,
    "academic_semester" INTEGER,
    "source_order" INTEGER NOT NULL,
    "source_label" TEXT,

    CONSTRAINT "curriculum_requirements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "curriculum_requirements_curriculum_id_source_order_key" ON "curriculum_requirements"("curriculum_id", "source_order");

-- AddForeignKey
ALTER TABLE "curriculum_requirements" ADD CONSTRAINT "curriculum_requirements_curriculum_id_fkey" FOREIGN KEY ("curriculum_id") REFERENCES "curriculums"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Domain integrity is explicit because Prisma does not model CHECK constraints.
ALTER TABLE "curriculum_requirements" ADD CONSTRAINT "curriculum_requirements_credits_check" CHECK ("credits" > 0);
ALTER TABLE "curriculum_requirements" ADD CONSTRAINT "curriculum_requirements_academic_year_check" CHECK ("academic_year" IS NULL OR "academic_year" > 0);
ALTER TABLE "curriculum_requirements" ADD CONSTRAINT "curriculum_requirements_academic_semester_check" CHECK ("academic_semester" IS NULL OR "academic_semester" BETWEEN 1 AND 3);
ALTER TABLE "curriculum_requirements" ADD CONSTRAINT "curriculum_requirements_source_order_check" CHECK ("source_order" >= 0);
