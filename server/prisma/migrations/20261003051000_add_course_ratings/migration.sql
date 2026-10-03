-- Add explicit votes without replacing the existing seed difficulty values.
ALTER TABLE "courses" ADD COLUMN "avg_rating" DOUBLE PRECISION,
    ADD COLUMN "rating_count" INTEGER NOT NULL DEFAULT 0,
    ADD CONSTRAINT "courses_avg_rating_check" CHECK (
        "avg_rating" IS NULL OR ("avg_rating" <> 'NaN'::DOUBLE PRECISION AND "avg_rating" BETWEEN 1 AND 5)
    ),
    ADD CONSTRAINT "courses_rating_count_check" CHECK ("rating_count" >= 0);

CREATE TABLE "course_ratings" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "course_id" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "course_ratings_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "course_ratings_rating_check" CHECK ("rating" BETWEEN 1 AND 5)
);
CREATE UNIQUE INDEX "course_ratings_user_id_course_id_key" ON "course_ratings"("user_id", "course_id");
CREATE INDEX "course_ratings_course_id_idx" ON "course_ratings"("course_id");
ALTER TABLE "course_ratings" ADD CONSTRAINT "course_ratings_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "course_ratings" ADD CONSTRAINT "course_ratings_course_id_fkey"
    FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Maintain the cache for every write, including foreign-key cascades and admin deletion.
-- Acquire the course lock before the aggregate query so concurrent READ COMMITTED votes
-- see the preceding writer's committed votes when refreshing their shared cache.
CREATE FUNCTION refresh_course_rating_cache() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
    affected_id TEXT;
BEGIN
    FOR affected_id IN
        SELECT DISTINCT course_id FROM (
            VALUES (CASE WHEN TG_OP <> 'INSERT' THEN OLD.course_id END),
                   (CASE WHEN TG_OP <> 'DELETE' THEN NEW.course_id END)
        ) AS affected(course_id)
        WHERE course_id IS NOT NULL ORDER BY course_id
    LOOP
        PERFORM 1 FROM "courses" WHERE "id" = affected_id FOR UPDATE;
        IF NOT FOUND THEN CONTINUE; END IF;
        UPDATE "courses" SET "avg_rating" = aggregate.average,
            "rating_count" = aggregate.count
        FROM (
            SELECT AVG("rating")::DOUBLE PRECISION AS average, COUNT(*)::INTEGER AS count
            FROM "course_ratings" WHERE "course_id" = affected_id
        ) AS aggregate
        WHERE "courses"."id" = affected_id;
    END LOOP;
    RETURN NULL;
END;
$$;
CREATE TRIGGER course_ratings_refresh_cache
    AFTER INSERT OR UPDATE OR DELETE ON "course_ratings"
    FOR EACH ROW EXECUTE FUNCTION refresh_course_rating_cache();
