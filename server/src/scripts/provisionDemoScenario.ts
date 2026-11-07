import { prisma } from '../db';
import { applyDemoScenario, readDemoScenario } from '../services/demoProvisioning';

const USAGE =
  'Usage: demo:scenario [--check | --apply]. --check is read-only; --apply writes the simulated scenario for the demo student only. Neither assigns a curriculum.';

async function main(): Promise<void> {
  const mode = process.argv[2] ?? '--check';
  if (!['--check', '--apply'].includes(mode) || process.argv.length > 3) {
    throw new Error(USAGE);
  }
  const report = mode === '--apply' ? await applyDemoScenario() : await readDemoScenario();
  const nextStep =
    mode === '--apply'
      ? 'Sign in as the demo student to review the legacy map, then attach the reference curriculum from /admin as the demo administrator. The assignment is deliberately not written here.'
      : 'Run with --apply to write the scenario.';
  process.stdout.write(`${JSON.stringify({ ...report, nextStep }, null, 2)}\n`);
}

main()
  .catch((error: unknown) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : 'Demo scenario provisioning failed'}\n`,
    );
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
