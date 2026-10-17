ALTER TABLE "planned_semesters" ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "reference_metadata" JSONB;
CREATE TABLE "reference_selection_receipts" (
 "id" TEXT NOT NULL,
 "user_id" TEXT NOT NULL,
 "request_id" TEXT NOT NULL,
 "semester_id" TEXT NOT NULL,
 "request_json" JSONB NOT NULL,
 "receipt_json" JSONB NOT NULL,
 "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "reference_selection_receipts_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "reference_selection_receipts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 CONSTRAINT "reference_selection_receipts_semester_id_fkey" FOREIGN KEY ("semester_id") REFERENCES "planned_semesters"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "reference_selection_receipts_user_id_request_id_key" ON "reference_selection_receipts"("user_id", "request_id");
CREATE INDEX "reference_selection_receipts_semester_id_idx" ON "reference_selection_receipts"("semester_id");
