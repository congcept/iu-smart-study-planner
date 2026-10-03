import dotenv from 'dotenv';
import path from 'path';

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

const config: Config = {
  ratingWritesPerHour,
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
