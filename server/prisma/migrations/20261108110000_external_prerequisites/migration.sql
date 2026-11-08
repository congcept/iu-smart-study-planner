-- A requirement may be satisfied by a course outside this curriculum. IT states four requirements as
-- "IT116IU or IT149IU", and IT149IU is a Data Science course, so the membership foreign key cannot
-- hold that branch. An edge now names either a member or an external code, never both.
ALTER TABLE "curriculum_prerequisites" ALTER COLUMN "prerequisite_id" DROP NOT NULL;
ALTER TABLE "curriculum_prerequisites" ADD COLUMN "external_prerequisite" TEXT;

ALTER TABLE "curriculum_prerequisites"
  ADD CONSTRAINT "curriculum_prerequisites_target_check" CHECK (
    num_nonnulls("prerequisite_id", "external_prerequisite") = 1
  );

-- NULLs are distinct in a unique index, so external edges need their own guard against duplicates.
CREATE UNIQUE INDEX "curriculum_prerequisites_external_key"
  ON "curriculum_prerequisites"("curriculum_id", "course_id", "external_prerequisite")
  WHERE "external_prerequisite" IS NOT NULL;
