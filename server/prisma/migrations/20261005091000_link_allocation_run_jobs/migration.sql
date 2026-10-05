-- Nullable private provenance preserves all existing manually captured history.
ALTER TABLE "simulation_allocation_runs" ADD COLUMN "job_id" TEXT;
CREATE UNIQUE INDEX "simulation_allocation_runs_job_id_key" ON "simulation_allocation_runs"("job_id");
ALTER TABLE "simulation_allocation_runs" ADD CONSTRAINT "simulation_allocation_runs_job_id_fkey"
  FOREIGN KEY ("job_id") REFERENCES "simulation_allocation_jobs"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
-- The existing JSONB comparison trigger also protects this new source field.
