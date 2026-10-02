-- Additive migration: existing demo users and their progress remain unchanged.
CREATE TYPE "UserRole" AS ENUM ('STUDENT', 'ADMIN');
ALTER TABLE "users"
  ADD COLUMN "password_hash" TEXT,
  ADD COLUMN "role" "UserRole" NOT NULL DEFAULT 'STUDENT';
