import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

interface ConfigurationReport {
  error: string | null;
  origin?: string;
  demoEnabled?: boolean;
  secureCookie?: boolean;
}

// Isolate only dotenv's file loading so a developer's .env cannot affect the result.
// Prisma, configuration and the invalid-config entry point are the real modules.
function load(
  nodeEnv: string,
  origin?: string,
  entry = false,
  jwtSecret = 'isolated-config-test-secret-at-least-32-chars',
) {
  const bootstrap = `
    const Module = require('node:module');
    const originalLoad = Module._load;
    Module._load = function(name) {
      if (name === 'dotenv') return { config: () => ({}) };
      return originalLoad.apply(this, arguments);
    };
    require(${JSON.stringify(require.resolve('ts-node/register/transpile-only'))});
    const report = { error: null };
    try {
      ${entry ? `require(${JSON.stringify(resolve(__dirname, '../index.ts'))});` : ''}
      const config = require(${JSON.stringify(resolve(__dirname, '../config'))}).default;
      report.origin = config.corsOrigin;
      report.demoEnabled = config.demoLoginEnabled;
      require(${JSON.stringify(resolve(__dirname, '../services/authService'))}).clearAuthCookie({
        clearCookie: (_name, options) => { report.secureCookie = options.secure; },
      });
    } catch (error) {
      report.error = error instanceof Error ? error.message : 'Unexpected configuration failure';
    }
    process.stdout.write('CORS_CONFIG:' + JSON.stringify(report) + '\\n');
    process.exitCode = report.error ? 1 : 0;
  `;
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: nodeEnv,
    JWT_SECRET: jwtSecret,
    JWT_EXPIRES_IN: '7d',
    DEMO_LOGIN_ENABLED: 'true',
    DATABASE_URL: 'postgresql://unused:unused@127.0.0.1:1/not-accessed',
    PORT: '0',
  };
  if (origin === undefined) delete env.CORS_ORIGIN;
  else env.CORS_ORIGIN = origin;
  delete env.DYLD_INSERT_LIBRARIES;
  const result = spawnSync(process.execPath, ['-e', bootstrap], {
    cwd: resolve(__dirname, '../..'),
    env,
    encoding: 'utf8',
    timeout: 15_000,
  });
  expect(result.error).toBeUndefined();
  expect(result.signal).toBeNull();
  const line = result.stdout.split('\n').find((value) => value.startsWith('CORS_CONFIG:'));
  expect(line).toBeDefined();
  const report = JSON.parse(line!.slice('CORS_CONFIG:'.length)) as ConfigurationReport;
  return { ...result, report };
}

describe('production origin configuration boundary', () => {
  it.each([undefined, '', '*', 'https://user:do-not-log@example.test/path'])(
    'rejects invalid production configuration %# before entry-point initialization',
    (origin) => {
      const result = load('production', origin, true);
      expect(result.status).toBe(1);
      expect(result.report).toEqual({
        error: 'Production requires CORS_ORIGIN to be one explicit HTTP(S) origin',
      });
      expect(result.stdout + result.stderr).not.toContain('do-not-log');
      expect(result.stdout + result.stderr).not.toContain('Database connected');
      expect(result.stdout + result.stderr).not.toContain('Server running');
    },
    20_000,
  );
  it('accepts a canonical production origin with secure cookies and disabled demos', () => {
    const result = load('production', 'HTTPS://PLANNER.EXAMPLE.TEST:443/');
    expect(result.status).toBe(0);
    expect(result.report).toEqual({
      error: null,
      origin: 'https://planner.example.test',
      demoEnabled: false,
      secureCookie: true,
    });
  }, 20_000);
  it('retains the development default and local demo/cookie behavior', () => {
    const result = load('development');
    expect(result.status).toBe(0);
    expect(result.report).toEqual({
      error: null,
      origin: 'http://localhost:5173',
      demoEnabled: true,
      secureCookie: false,
    });
  }, 20_000);
  it('retains the production JWT secret gate before entry-point initialization', () => {
    const result = load('production', 'https://planner.example.test', true, 'short');
    expect(result.status).toBe(1);
    expect(result.report).toEqual({
      error: 'Production requires a non-placeholder JWT_SECRET of at least 32 characters',
    });
  }, 20_000);
});
