import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const script = resolve(__dirname, '../scripts/verifyCurriculumManifest.ts');

function run(args: string[], cwd?: string) {
  const env: NodeJS.ProcessEnv = { ...process.env, NODE_ENV: 'test' };
  delete env.DYLD_INSERT_LIBRARIES;
  return spawnSync(process.execPath, [require.resolve('ts-node/dist/bin.js'), script, ...args], {
    cwd: cwd ?? resolve(__dirname, '../..'),
    env,
    encoding: 'utf8',
    timeout: 30_000,
  });
}

const valid = () => ({
  program: {
    code: 'SIM',
    name: 'Simulated program',
    school: 'CSE',
    degree: 'Bachelor',
    programUrl: 'https://example.test/program',
    cohort: 'K2025',
  },
  source: {
    label: 'Simulated signed document',
    url: 'https://example.test/document.pdf',
    sha256: 'b'.repeat(64),
    pages: '5-12',
    retrievedOn: '2026-11-07',
  },
  totalCredits: 7,
  excluded: [],
  blocks: [
    {
      code: 'I',
      name: 'General',
      requiredCredits: 3,
      electiveCredits: 0,
      requiredCourses: ['MA001IU'],
    },
    {
      code: 'III',
      name: 'Specialised',
      requiredCredits: 4,
      electiveCredits: 0,
      requiredCourses: ['IT069IU'],
    },
  ],
  courses: [
    { code: 'MA001IU', name: 'Calculus 1', credits: 3, lecture: 3, lab: 0 },
    { code: 'IT069IU', name: 'Object-Oriented Programming', credits: 4, lecture: 3, lab: 1 },
  ],
  placements: [
    {
      code: 'MA001IU',
      year: 1,
      semester: 1,
      group: null,
      selectCount: null,
      selectCredits: null,
      sourceOrder: 0,
    },
    {
      code: 'IT069IU',
      year: 2,
      semester: 1,
      group: null,
      selectCount: null,
      selectCredits: null,
      sourceOrder: 1,
    },
  ],
  requirements: [],
  prerequisites: [],
});

describe('verify:curriculum-manifest command', () => {
  let dir = '';
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'manifest-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('reports a self-consistent manifest and exits zero', () => {
    const path = join(dir, 'valid.json');
    writeFileSync(path, JSON.stringify(valid()));
    const result = run([path]);
    expect(result.status).toBe(0);
    const report = JSON.parse(result.stdout);
    expect(report.readiness).toBe(true);
    expect(report.blockers).toEqual([]);
    expect(report.credits).toEqual({ declared: 7, blocks: 7, required: 7, elective: 0 });
    expect(report.nextStep).toMatch(/has not been re-read/);
  });

  it('exits non-zero and names every blocker when the manifest is not consistent', () => {
    const broken = valid();
    broken.totalCredits = 124;
    const path = join(dir, 'broken.json');
    writeFileSync(path, JSON.stringify(broken));
    const result = run([path]);
    expect(result.status).toBe(1);
    const report = JSON.parse(result.stdout);
    expect(report.readiness).toBe(false);
    expect(report.blockers[0]).toMatch(/CREDIT_ARITHMETIC totalCredits/);
    expect(report.nextStep).toMatch(/do not correct the manifest alone/);
  });

  it('refuses to run without a path or with extra arguments', () => {
    expect(run([]).status).toBe(1);
    expect(run(['a.json', 'b.json']).stderr).toMatch(/Usage/);
  });

  it('reports an unreadable or non-JSON file without a stack trace', () => {
    const missing = run([join(dir, 'absent.json')]);
    expect(missing.status).toBe(1);
    expect(missing.stderr).toMatch(/Cannot read curriculum manifest/);

    const notJson = join(dir, 'not-json.json');
    writeFileSync(notJson, 'not json');
    const invalid = run([notJson]);
    expect(invalid.status).toBe(1);
    expect(invalid.stderr).toMatch(/not valid JSON/);
  });
});
