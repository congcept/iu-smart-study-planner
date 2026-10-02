-- AlterTable
ALTER TABLE "courses" ADD COLUMN     "elective_group" TEXT,
ADD COLUMN     "elective_select_count" INTEGER;

-- CreateIndex
CREATE INDEX "courses_elective_group_idx" ON "courses"("elective_group");
