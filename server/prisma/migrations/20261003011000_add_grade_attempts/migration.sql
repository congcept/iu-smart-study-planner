-- Preserve legacy student_records; numeric attempts start as explicit new entries.
CREATE TABLE "grade_attempts" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "course_id" TEXT NOT NULL,
    "request_id" UUID NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "semester" "Semester",
    "year" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "grade_attempts_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "grade_attempts_score_check" CHECK (
        "score" <> 'NaN'::DOUBLE PRECISION AND "score" >= 0 AND "score" <= 100
    ),
    CONSTRAINT "grade_attempts_year_check" CHECK (
        "year" IS NULL OR "year" BETWEEN 2000 AND 2100
    )
);

CREATE UNIQUE INDEX "grade_attempts_user_id_request_id_key" ON "grade_attempts"("user_id", "request_id");
CREATE INDEX "grade_attempts_course_id_idx" ON "grade_attempts"("course_id");
ALTER TABLE "grade_attempts" ADD CONSTRAINT "grade_attempts_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "grade_attempts" ADD CONSTRAINT "grade_attempts_course_id_fkey"
    FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
