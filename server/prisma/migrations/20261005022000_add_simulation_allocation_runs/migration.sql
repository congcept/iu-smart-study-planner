-- Additive aggregate history only. Existing academic data is untouched.
CREATE TABLE "simulation_allocation_runs" (
  "id" TEXT NOT NULL,
  "curriculum_id" TEXT NOT NULL,
  "semester" "Semester" NOT NULL,
  "year" INTEGER NOT NULL,
  "request_id" TEXT NOT NULL,
  "created_by_id" TEXT,
  "format_version" INTEGER NOT NULL DEFAULT 1,
  "captured_at" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "result" JSONB NOT NULL,
  CONSTRAINT "simulation_allocation_runs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "simulation_allocation_runs_year_check" CHECK ("year" BETWEEN 2000 AND 2100),
  CONSTRAINT "simulation_allocation_runs_version_check" CHECK ("format_version" > 0),
  CONSTRAINT "simulation_allocation_runs_time_check" CHECK ("captured_at" <= "created_at"),
  CONSTRAINT "simulation_allocation_runs_result_check" CHECK (jsonb_typeof("result") = 'object'),
  CONSTRAINT "simulation_allocation_runs_curriculum_id_fkey" FOREIGN KEY ("curriculum_id") REFERENCES "curriculums"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "simulation_allocation_runs_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE RESTRICT
);
CREATE UNIQUE INDEX "simulation_allocation_runs_created_by_id_request_id_key" ON "simulation_allocation_runs"("created_by_id", "request_id");
CREATE INDEX "simulation_allocation_runs_curriculum_id_semester_year_created_at_idx" ON "simulation_allocation_runs"("curriculum_id", "semester", "year", "created_at");

-- Creator removal may anonymize history; results and source metadata never change.
CREATE FUNCTION protect_simulation_allocation_history() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF (to_jsonb(NEW) - 'created_by_id') IS DISTINCT FROM (to_jsonb(OLD) - 'created_by_id')
    OR (NEW.created_by_id IS DISTINCT FROM OLD.created_by_id AND NEW.created_by_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Simulation allocation history is immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER simulation_allocation_runs_immutable
BEFORE UPDATE ON "simulation_allocation_runs"
FOR EACH ROW EXECUTE FUNCTION protect_simulation_allocation_history();
