import type { CourseDifficultyDTO } from '@iu-study-planner/shared';

export function CourseRatingBadge({ course }: { course: Partial<CourseDifficultyDTO> }) {
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
    <p className="mt-1 text-xs leading-snug text-gray-700 tabular-nums">
      <span className="block">Difficulty {ratingDifficulty.toFixed(1)} / 5</span>
      <span className="block">
        {ratingCount === 0
          ? 'No ratings yet'
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
