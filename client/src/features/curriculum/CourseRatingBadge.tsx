import type { CourseDifficultyDTO } from '@iu-study-planner/shared';

export function CourseRatingBadge({
  course,
  compact = false,
}: {
  course: Partial<CourseDifficultyDTO>;
  compact?: boolean;
}) {
  const { ratingDifficulty, ratingCount } = course;
  if (
    ratingDifficulty === undefined ||
    !Number.isFinite(ratingDifficulty) ||
    ratingDifficulty < 1 ||
    ratingDifficulty > 5 ||
    ratingCount === undefined ||
    !Number.isSafeInteger(ratingCount) ||
    ratingCount < 0
  )
    return null;

  return (
    <p
      className={`mt-1 leading-snug text-gray-700 tabular-nums ${compact ? 'text-[10px]' : 'text-xs'}`}
    >
      <span>Difficulty {ratingDifficulty.toFixed(1)} / 5</span>
      {' · '}
      <span>
        {ratingCount === 0
          ? compact
            ? '0 ratings'
            : 'No ratings yet'
          : `${ratingCount} ${ratingCount === 1 ? 'rating' : 'ratings'}`}
      </span>
      <span className="sr-only">
        {ratingCount === 0
          ? 'Estimate uses the shared mean.'
          : 'Estimate combines course ratings with the shared mean.'}{' '}
        Higher scores mean greater difficulty.
      </span>
    </p>
  );
}
