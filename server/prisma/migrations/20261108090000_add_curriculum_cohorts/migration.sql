-- A cohort is an admission year governed by one curriculum structure. Additive: no existing row
-- gains a cohort here, and a curriculum with no cohort rows keeps its current behaviour.
CREATE TABLE "curriculum_cohorts" (
    "id" TEXT NOT NULL,
    "curriculum_id" TEXT NOT NULL,
    "cohort" TEXT NOT NULL,
    "source_label" TEXT,
    "source_url" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "curriculum_cohorts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "curriculum_cohorts_curriculum_id_cohort_key"
    ON "curriculum_cohorts"("curriculum_id", "cohort");
CREATE INDEX "curriculum_cohorts_cohort_idx" ON "curriculum_cohorts"("cohort");

ALTER TABLE "curriculum_cohorts"
    ADD CONSTRAINT "curriculum_cohorts_curriculum_id_fkey"
    FOREIGN KEY ("curriculum_id") REFERENCES "curriculums"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A cohort label must be usable as one, and one structure cannot claim the same cohort twice.
ALTER TABLE "curriculum_cohorts"
    ADD CONSTRAINT "curriculum_cohorts_label_check" CHECK (
        "cohort" <> '' AND "cohort" = btrim("cohort")
    );
