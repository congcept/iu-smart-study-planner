CREATE TABLE "school_resources" (
    "id" TEXT NOT NULL,
    "curriculum_id" TEXT NOT NULL,
    "semester" "Semester" NOT NULL,
    "year" INTEGER NOT NULL,
    "professors" INTEGER NOT NULL DEFAULT 0,
    "classrooms" INTEGER NOT NULL DEFAULT 0,
    "lab_rooms" INTEGER NOT NULL DEFAULT 0,
    "max_students_per_section" INTEGER NOT NULL DEFAULT 40,
    "course_overrides" JSONB NOT NULL DEFAULT '{}',
    "revision" INTEGER NOT NULL DEFAULT 1,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "school_resources_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "school_resources_year_check" CHECK ("year" BETWEEN 2000 AND 2100),
    CONSTRAINT "school_resources_counts_check" CHECK (
        "professors" BETWEEN 0 AND 100000 AND "classrooms" BETWEEN 0 AND 100000
        AND "lab_rooms" BETWEEN 0 AND 100000
        AND "max_students_per_section" BETWEEN 1 AND 100000
    ),
    CONSTRAINT "school_resources_revision_check" CHECK ("revision" >= 1),
    CONSTRAINT "school_resources_overrides_check" CHECK (jsonb_typeof("course_overrides") = 'object')
);
CREATE UNIQUE INDEX "school_resources_curriculum_id_semester_year_key"
    ON "school_resources"("curriculum_id", "semester", "year");
ALTER TABLE "school_resources" ADD CONSTRAINT "school_resources_curriculum_id_fkey"
    FOREIGN KEY ("curriculum_id") REFERENCES "curriculums"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "school_resources" ADD CONSTRAINT "school_resources_updated_by_fkey"
    FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
