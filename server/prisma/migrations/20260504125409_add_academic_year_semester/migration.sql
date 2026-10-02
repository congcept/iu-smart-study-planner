-- AlterTable
ALTER TABLE "courses" ADD COLUMN     "academic_semester" INTEGER,
ADD COLUMN     "academic_year" INTEGER;

-- CreateIndex
CREATE INDEX "courses_academic_year_academic_semester_idx" ON "courses"("academic_year", "academic_semester");
