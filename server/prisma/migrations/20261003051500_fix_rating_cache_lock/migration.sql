-- FK checks hold KEY SHARE locks. NO KEY UPDATE serializes cache refreshes
-- without deadlocking concurrent inserts while upgrading those FK locks.
CREATE OR REPLACE FUNCTION refresh_course_rating_cache() RETURNS TRIGGER LANGUAGE plpgsql AS $$
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
        PERFORM 1 FROM "courses" WHERE "id" = affected_id FOR NO KEY UPDATE;
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
