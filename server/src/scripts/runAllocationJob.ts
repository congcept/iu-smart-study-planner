import { CreateAllocationJobSchema } from '@iu-study-planner/shared';
import { prisma } from '../db';
import { runOneAllocationJob } from '../services/allocationJobExecution';

async function main() {
  const args = process.argv.slice(2);
  if (
    args.length !== 2 ||
    args[0] !== '--apply' ||
    !CreateAllocationJobSchema.shape.requestId.safeParse(args[1]).success
  ) {
    process.stderr.write('Usage: allocation:run-one -- --apply <job-uuid>\n');
    process.exitCode = 2;
    return;
  }
  const result = await runOneAllocationJob(args[1]);
  process.stdout.write(
    `${JSON.stringify({
      ...result,
      notice: result.processed
        ? 'Reference simulation only; no student registration or full-semester assignment.'
        : 'No unlocked pending request is available for this ID. Inspect its outcome before retrying.',
    })}\n`,
  );
}

main()
  .catch(() => {
    process.stderr.write(
      'Could not confirm simulation execution. Inspect the outcome before retrying.\n',
    );
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
