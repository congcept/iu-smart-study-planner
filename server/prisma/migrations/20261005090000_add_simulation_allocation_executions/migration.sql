-- Additive terminal outcomes only. Queue requests and aggregate history stay immutable.
CREATE TYPE "SimulationAllocationExecutionStatus" AS ENUM ('SUCCEEDED', 'FAILED');

CREATE TABLE "simulation_allocation_executions" (
  "job_id" TEXT NOT NULL,
  "status" "SimulationAllocationExecutionStatus" NOT NULL,
  "run_id" TEXT,
  "failure_code" TEXT,
  "completed_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "simulation_allocation_executions_pkey" PRIMARY KEY ("job_id"),
  CONSTRAINT "simulation_allocation_executions_outcome_check" CHECK (
    ("status" = 'SUCCEEDED' AND "run_id" IS NOT NULL AND "failure_code" IS NULL)
    OR
    ("status" = 'FAILED' AND "run_id" IS NULL AND "failure_code" IS NOT NULL
      AND "failure_code" IN ('AUTHOR_UNAVAILABLE', 'PREVIEW_UNAVAILABLE'))
  ),
  CONSTRAINT "simulation_allocation_executions_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "simulation_allocation_jobs"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "simulation_allocation_executions_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "simulation_allocation_runs"("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE UNIQUE INDEX "simulation_allocation_executions_run_id_key" ON "simulation_allocation_executions"("run_id");

CREATE FUNCTION protect_simulation_allocation_execution() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF to_jsonb(NEW) IS DISTINCT FROM to_jsonb(OLD) THEN
    RAISE EXCEPTION 'Simulation allocation execution is immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER simulation_allocation_executions_immutable
BEFORE UPDATE ON "simulation_allocation_executions"
FOR EACH ROW EXECUTE FUNCTION protect_simulation_allocation_execution();
