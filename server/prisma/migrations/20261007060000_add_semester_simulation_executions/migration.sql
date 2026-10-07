-- Private provenance extension only. Existing direct captures keep a null job link.
ALTER TABLE "simulation_semester_runs" ADD COLUMN "job_id" TEXT;
CREATE UNIQUE INDEX "semester_runs_job_key" ON "simulation_semester_runs"("job_id");
ALTER TABLE "simulation_semester_runs" ADD CONSTRAINT "semester_runs_job_fkey"
  FOREIGN KEY ("job_id") REFERENCES "simulation_semester_allocation_jobs"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
-- The existing JSON-based immutable run trigger also freezes the new job_id field.

CREATE TABLE "simulation_semester_allocation_executions" (
  "job_id" TEXT NOT NULL,
  "status" "SimulationAllocationExecutionStatus" NOT NULL,
  "run_id" TEXT,
  "failure_code" TEXT,
  "completed_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "simulation_semester_allocation_executions_pkey" PRIMARY KEY ("job_id"),
  CONSTRAINT "semester_executions_outcome_check" CHECK (
    ("status" = 'SUCCEEDED' AND "run_id" IS NOT NULL AND "failure_code" IS NULL)
    OR ("status" = 'FAILED' AND "run_id" IS NULL AND "failure_code" IN ('AUTHOR_UNAVAILABLE', 'PREVIEW_UNAVAILABLE') AND "failure_code" IS NOT NULL)
  ),
  CONSTRAINT "semester_executions_job_fkey" FOREIGN KEY ("job_id") REFERENCES "simulation_semester_allocation_jobs"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "semester_executions_run_fkey" FOREIGN KEY ("run_id") REFERENCES "simulation_semester_runs"("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE UNIQUE INDEX "semester_executions_run_key" ON "simulation_semester_allocation_executions"("run_id");

CREATE FUNCTION protect_semester_simulation_execution() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  request_row "simulation_semester_allocation_jobs"%ROWTYPE;
  capture_row "simulation_semester_runs"%ROWTYPE;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF to_jsonb(NEW) IS DISTINCT FROM to_jsonb(OLD) THEN
      RAISE EXCEPTION 'Semester simulation execution is immutable';
    END IF;
    RETURN NEW;
  END IF;
  SELECT * INTO request_row FROM "simulation_semester_allocation_jobs" WHERE id = NEW.job_id;
  IF NOT FOUND OR NEW.completed_at < request_row.created_at THEN
    RAISE EXCEPTION 'Semester simulation execution chronology could not be verified';
  END IF;
  IF NEW.status = 'SUCCEEDED' THEN
    SELECT * INTO capture_row FROM "simulation_semester_runs" WHERE id = NEW.run_id;
    IF NOT FOUND OR capture_row.job_id IS DISTINCT FROM NEW.job_id
      OR capture_row.created_by_id IS DISTINCT FROM request_row.created_by_id
      OR capture_row.curriculum_id IS DISTINCT FROM request_row.curriculum_id
      OR capture_row.semester IS DISTINCT FROM request_row.semester
      OR capture_row.year IS DISTINCT FROM request_row.year
      OR request_row.model <> 'SEMESTER_CREDIT_BUDGET_V1' OR capture_row.format_version <> 1
      OR capture_row.captured_at < request_row.created_at
      OR capture_row.created_at > NEW.completed_at THEN
      RAISE EXCEPTION 'Semester simulation execution provenance could not be verified';
    END IF;
  ELSIF EXISTS (SELECT 1 FROM "simulation_semester_runs" WHERE job_id = NEW.job_id) THEN
    RAISE EXCEPTION 'Failed semester simulation cannot have a linked capture';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER semester_simulation_executions_protected
BEFORE INSERT OR UPDATE ON "simulation_semester_allocation_executions"
FOR EACH ROW EXECUTE FUNCTION protect_semester_simulation_execution();

CREATE FUNCTION verify_semester_job_capture() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  request_row "simulation_semester_allocation_jobs"%ROWTYPE;
BEGIN
  IF NEW.job_id IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO request_row FROM "simulation_semester_allocation_jobs" WHERE id = NEW.job_id;
  IF NOT FOUND OR NEW.created_by_id IS DISTINCT FROM request_row.created_by_id
    OR NEW.created_by_id IS NULL
    OR NEW.curriculum_id IS DISTINCT FROM request_row.curriculum_id
    OR NEW.semester IS DISTINCT FROM request_row.semester
    OR NEW.year IS DISTINCT FROM request_row.year
    OR NEW.format_version <> 1 OR request_row.model <> 'SEMESTER_CREDIT_BUDGET_V1'
    OR NEW.captured_at < request_row.created_at
    OR EXISTS (SELECT 1 FROM "simulation_semester_allocation_executions" WHERE job_id = NEW.job_id) THEN
    RAISE EXCEPTION 'Semester job capture provenance could not be verified';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER semester_job_capture_provenance
BEFORE INSERT ON "simulation_semester_runs"
FOR EACH ROW EXECUTE FUNCTION verify_semester_job_capture();
