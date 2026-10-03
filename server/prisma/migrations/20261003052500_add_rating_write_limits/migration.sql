-- One durable fixed-hour quota row per account, shared across API instances.
CREATE TABLE "rating_write_limits" (
    "user_id" TEXT NOT NULL,
    "window_start" TIMESTAMP(3) NOT NULL,
    "write_count" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "rating_write_limits_pkey" PRIMARY KEY ("user_id"),
    CONSTRAINT "rating_write_limits_count_check" CHECK ("write_count" >= 0),
    CONSTRAINT "rating_write_limits_user_id_fkey" FOREIGN KEY ("user_id")
        REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
