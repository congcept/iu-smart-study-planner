-- Additive: preserve the document's own prerequisite label and, where a requirement may be
-- satisfied by any one of several courses, the group those edges belong to.
ALTER TABLE "curriculum_prerequisites" ADD COLUMN "kind" TEXT;
ALTER TABLE "curriculum_prerequisites" ADD COLUMN "alternative_group" TEXT;

ALTER TABLE "curriculum_prerequisites"
  ADD CONSTRAINT "curriculum_prerequisites_kind_check" CHECK (
    "kind" IS NULL OR "kind" IN ('TQ', 'HT', 'SH')
  );
ALTER TABLE "curriculum_prerequisites"
  ADD CONSTRAINT "curriculum_prerequisites_alternative_group_check" CHECK (
    "alternative_group" IS NULL OR ("alternative_group" <> '' AND "alternative_group" = btrim("alternative_group"))
  );
