-- Additive: an elective pool may be stated in credits rather than in a course count.
-- The CS reference import states counts and keeps writing elective_select_count.
ALTER TABLE "curriculum_placements" ADD COLUMN "elective_select_credits" INTEGER;

-- A placement states one kind of pool, and only on an elective group.
ALTER TABLE "curriculum_placements"
  ADD CONSTRAINT "curriculum_placements_elective_pool_check" CHECK (
    ("elective_select_credits" IS NULL OR "elective_select_credits" > 0)
    AND (
      "elective_select_count" IS NULL
      OR "elective_select_credits" IS NULL
    )
    AND (
      "elective_select_credits" IS NULL
      OR ("elective_group" IS NOT NULL AND "elective_select_count" IS NULL)
    )
  );
