-- Additive private simulation history; no existing academic or one-course records change.
CREATE TABLE "simulation_semester_runs" (
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
  CONSTRAINT "simulation_semester_runs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "simulation_semester_runs_year_check" CHECK ("year" BETWEEN 2000 AND 2100),
  CONSTRAINT "simulation_semester_runs_version_check" CHECK ("format_version" > 0),
  CONSTRAINT "simulation_semester_runs_time_check" CHECK ("captured_at" <= "created_at"),
  CONSTRAINT "simulation_semester_runs_result_check" CHECK (jsonb_typeof("result") = 'object'),
  CONSTRAINT "simulation_semester_runs_curriculum_id_fkey" FOREIGN KEY ("curriculum_id") REFERENCES "curriculums"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "simulation_semester_runs_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE RESTRICT
);
CREATE UNIQUE INDEX "simulation_semester_runs_created_by_id_request_id_key" ON "simulation_semester_runs"("created_by_id", "request_id");
CREATE INDEX "simulation_semester_runs_scope_history_idx" ON "simulation_semester_runs"("curriculum_id", "semester", "year", "created_at", "id");

CREATE TABLE "simulation_semester_participants" (
  "id" TEXT NOT NULL,
  "run_id" TEXT NOT NULL,
  "captured_student_id" TEXT NOT NULL,
  "user_id" TEXT,
  "result" JSONB NOT NULL,
  CONSTRAINT "simulation_semester_participants_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "simulation_semester_participants_link_check" CHECK ("user_id" IS NULL OR "user_id" = "captured_student_id"),
  CONSTRAINT "simulation_semester_participants_result_check" CHECK (jsonb_typeof("result") = 'object'),
  CONSTRAINT "simulation_semester_participants_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "simulation_semester_runs"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "simulation_semester_participants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE RESTRICT
);
CREATE UNIQUE INDEX "simulation_semester_participants_run_id_captured_student_id_key" ON "simulation_semester_participants"("run_id", "captured_student_id");
CREATE UNIQUE INDEX "simulation_semester_participants_run_id_user_id_key" ON "simulation_semester_participants"("run_id", "user_id");
CREATE INDEX "simulation_semester_participants_user_id_run_id_idx" ON "simulation_semester_participants"("user_id", "run_id");

-- SetNull foreign-key updates revoke access, without changing immutable captured results.
CREATE FUNCTION protect_semester_simulation_run() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF (to_jsonb(NEW) - 'created_by_id') IS DISTINCT FROM (to_jsonb(OLD) - 'created_by_id')
    OR (NEW.created_by_id IS DISTINCT FROM OLD.created_by_id AND NEW.created_by_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Semester simulation history is immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER simulation_semester_runs_immutable BEFORE UPDATE ON "simulation_semester_runs"
FOR EACH ROW EXECUTE FUNCTION protect_semester_simulation_run();

CREATE FUNCTION protect_semester_simulation_participant() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF (to_jsonb(NEW) - 'user_id') IS DISTINCT FROM (to_jsonb(OLD) - 'user_id')
    OR (NEW.user_id IS DISTINCT FROM OLD.user_id AND NEW.user_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Semester simulation participant is immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER simulation_semester_participants_immutable BEFORE UPDATE ON "simulation_semester_participants"
FOR EACH ROW EXECUTE FUNCTION protect_semester_simulation_participant();
