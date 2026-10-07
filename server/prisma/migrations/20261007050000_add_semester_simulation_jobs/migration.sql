-- Additive scenario manifests only; no live inputs, students or assignments are captured.
CREATE TABLE "simulation_semester_allocation_jobs" (
  "id" TEXT NOT NULL,
  "curriculum_id" TEXT NOT NULL,
  "semester" "Semester" NOT NULL,
  "year" INTEGER NOT NULL,
  "model" TEXT NOT NULL DEFAULT 'SEMESTER_CREDIT_BUDGET_V1',
  "created_by_id" TEXT,
  "request_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "simulation_semester_allocation_jobs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "semester_jobs_year_check" CHECK ("year" BETWEEN 2000 AND 2100),
  CONSTRAINT "semester_jobs_model_check" CHECK ("model" = 'SEMESTER_CREDIT_BUDGET_V1'),
  CONSTRAINT "semester_jobs_curriculum_fkey" FOREIGN KEY ("curriculum_id") REFERENCES "curriculums"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "semester_jobs_creator_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE RESTRICT
);
CREATE UNIQUE INDEX "semester_jobs_actor_request_key" ON "simulation_semester_allocation_jobs"("created_by_id", "request_id");
CREATE INDEX "semester_jobs_scope_created_idx" ON "simulation_semester_allocation_jobs"("curriculum_id", "semester", "year", "created_at");

CREATE FUNCTION protect_semester_simulation_job_request() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF (to_jsonb(NEW) - 'created_by_id') IS DISTINCT FROM (to_jsonb(OLD) - 'created_by_id')
    OR (NEW.created_by_id IS DISTINCT FROM OLD.created_by_id AND NEW.created_by_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Semester simulation job request is immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER semester_simulation_jobs_immutable
BEFORE UPDATE ON "simulation_semester_allocation_jobs"
FOR EACH ROW EXECUTE FUNCTION protect_semester_simulation_job_request();
