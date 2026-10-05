import dotenv from 'dotenv';
import path from 'path';
import type {
  AllocationUtilityPolicyDTO,
  EligibleCohortDemandPolicyDTO,
  SimulationAllocationPolicyDTO,
  SimulationResourcePolicyDTO,
} from '@iu-study-planner/shared';
import { readCohortDemandPolicy } from './cohortDemand';
import { readAllocationUtilityPolicy } from './allocationUtility';
import { readSimulationAllocationPolicy } from './simulationAllocation';
import { readSimulationResourcePolicy } from './simulationResources';

dotenv.config({ path: path.join(__dirname, '../../.env') });

interface Config {
  port: number;
  nodeEnv: string;
  databaseUrl: string;
  corsOrigin: string;
  jwtSecret: string;
  jwtExpiresIn: number;
  demoLoginEnabled: boolean;
  ratingWritesPerHour: number;
  semesterDifficultyPenaltyWeight: number;
  recommendationGradeFitWeight: number;
  recommendationGradeDifficultyTolerance: number;
  simulationResourcePolicy: SimulationResourcePolicyDTO;
  cohortDemandPolicy: EligibleCohortDemandPolicyDTO;
  simulationAllocationPolicy: SimulationAllocationPolicyDTO;
  allocationUtilityPolicy: AllocationUtilityPolicyDTO;
}

const duration = /^([1-9]\d*)(s|m|h|d)$/.exec(process.env.JWT_EXPIRES_IN || '7d');
const secondsPerUnit: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };
if (!duration)
  throw new Error('JWT_EXPIRES_IN must use seconds, minutes, hours, or days (e.g. 7d)');
const jwtExpiresIn = Number(duration[1]) * secondsPerUnit[duration[2]];
if (!Number.isSafeInteger(jwtExpiresIn * 1000)) throw new Error('JWT_EXPIRES_IN is too large');
if (
  process.env.NODE_ENV === 'production' &&
  (!process.env.JWT_SECRET ||
    process.env.JWT_SECRET.length < 32 ||
    /your-secret|change-in-production/i.test(process.env.JWT_SECRET))
) {
  throw new Error('Production requires a non-placeholder JWT_SECRET of at least 32 characters');
}

const ratingWritesPerHour = Number(process.env.RATING_WRITES_PER_HOUR || '60');
if (
  !Number.isSafeInteger(ratingWritesPerHour) ||
  ratingWritesPerHour < 1 ||
  ratingWritesPerHour > 10000
) {
  throw new Error('RATING_WRITES_PER_HOUR must be an integer from 1 to 10000');
}

const semesterDifficultyPenaltyWeight = Number(
  process.env.SEMESTER_DIFFICULTY_PENALTY_WEIGHT || '10',
);
if (
  !Number.isFinite(semesterDifficultyPenaltyWeight) ||
  semesterDifficultyPenaltyWeight < 0 ||
  semesterDifficultyPenaltyWeight > 50
)
  throw new Error('SEMESTER_DIFFICULTY_PENALTY_WEIGHT must be between 0 and 50');

const recommendationGradeFitWeight = Number(process.env.RECOMMENDATION_GRADE_FIT_WEIGHT || '2');
if (
  !Number.isFinite(recommendationGradeFitWeight) ||
  recommendationGradeFitWeight < 0 ||
  recommendationGradeFitWeight > 20
)
  throw new Error('RECOMMENDATION_GRADE_FIT_WEIGHT must be between 0 and 20');

const recommendationGradeDifficultyTolerance = Number(
  process.env.RECOMMENDATION_GRADE_DIFFICULTY_TOLERANCE || '0.5',
);
if (
  !Number.isFinite(recommendationGradeDifficultyTolerance) ||
  recommendationGradeDifficultyTolerance < 0 ||
  recommendationGradeDifficultyTolerance > 4
)
  throw new Error('RECOMMENDATION_GRADE_DIFFICULTY_TOLERANCE must be between 0 and 4');

const config: Config = {
  allocationUtilityPolicy: readAllocationUtilityPolicy(process.env),
  simulationAllocationPolicy: readSimulationAllocationPolicy(process.env),
  cohortDemandPolicy: readCohortDemandPolicy(process.env),
  simulationResourcePolicy: readSimulationResourcePolicy(process.env),
  recommendationGradeFitWeight,
  recommendationGradeDifficultyTolerance,
  ratingWritesPerHour,
  semesterDifficultyPenaltyWeight,
  port: parseInt(process.env.PORT || '3001', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  databaseUrl:
    process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/iu_study_planner',
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  jwtSecret: process.env.JWT_SECRET || 'your-secret-key-change-in-production',
  jwtExpiresIn,
  demoLoginEnabled:
    (process.env.NODE_ENV || 'development') === 'development' &&
    process.env.DEMO_LOGIN_ENABLED !== 'false',
};

export default config;
