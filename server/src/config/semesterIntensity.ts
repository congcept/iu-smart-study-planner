export type SemesterIntensityMode = 'low' | 'normal' | 'high' | 'max';

export interface SemesterIntensityConfig {
  maxCreditsPerSemester: number;
  maxSemesters: number;
  preferredMinCredits: number;
}

/** Existing intensity policy, shared by legacy planning and contextual previews. */
export const INTENSITY_CONFIGS: Readonly<
  Record<SemesterIntensityMode, Readonly<SemesterIntensityConfig>>
> = {
  low: { maxCreditsPerSemester: 9, maxSemesters: 18, preferredMinCredits: 6 },
  normal: { maxCreditsPerSemester: 15, maxSemesters: 12, preferredMinCredits: 12 },
  high: { maxCreditsPerSemester: 21, maxSemesters: 10, preferredMinCredits: 15 },
  max: { maxCreditsPerSemester: 24, maxSemesters: 8, preferredMinCredits: 21 },
};

export function getSemesterIntensityConfig(mode: string): Readonly<SemesterIntensityConfig> {
  return mode === 'low' || mode === 'high' || mode === 'max'
    ? INTENSITY_CONFIGS[mode]
    : INTENSITY_CONFIGS.normal;
}
