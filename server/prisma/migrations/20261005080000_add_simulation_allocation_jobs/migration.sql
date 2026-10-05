-- Additive queue requests only. No live inputs, results or academic records are stored.
CREATE TABLE "simulation_allocation_jobs" (
  "id" TEXT NOT NULL,
  "curriculum_id" TEXT NOT NULL,
  "semester" "Semester" NOT NULL,
  "year" INTEGER NOT NULL,
  "created_by_id" TEXT,
  "request_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "simulation_allocation_jobs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "simulation_allocation_jobs_year_check" CHECK ("year" BETWEEN 2000 AND 2100),
  CONSTRAINT "simulation_allocation_jobs_curriculum_id_fkey" FOREIGN KEY ("curriculum_id") REFERENCES "curriculums"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "simulation_allocation_jobs_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE RESTRICT
);
CREATE UNIQUE INDEX "simulation_allocation_jobs_created_by_id_request_id_key" ON "simulation_allocation_jobs"("created_by_id", "request_id");
CREATE INDEX "simulation_allocation_jobs_curriculum_id_semester_year_created_at_idx" ON "simulation_allocation_jobs"("curriculum_id", "semester", "year", "created_at");

-- Creator removal may anonymize a queued request; its source identity never changes.
CREATE FUNCTION protect_simulation_allocation_job_request() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF (to_jsonb(NEW) - 'created_by_id') IS DISTINCT FROM (to_jsonb(OLD) - 'created_by_id')
    OR (NEW.created_by_id IS DISTINCT FROM OLD.created_by_id AND NEW.created_by_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Simulation allocation job request is immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER simulation_allocation_jobs_immutable
BEFORE UPDATE ON "simulation_allocation_jobs"
FOR EACH ROW EXECUTE FUNCTION protect_simulation_allocation_job_request();
