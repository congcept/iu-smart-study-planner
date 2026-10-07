import { SemesterAllocationJobSchema } from '@iu-study-planner/shared';
import { prisma } from '../db';
import { runOneSemesterAllocationJob } from '../services/semesterAllocationJobExecution';

async function main() {
  const args = process.argv.slice(2);
  if (
    args.length !== 2 ||
    args[0] !== '--apply' ||
    !SemesterAllocationJobSchema.shape.id.safeParse(args[1]).success
  ) {
    process.stderr.write('Usage: semester-allocation:run-one -- --apply <job-uuid>\n');
    process.exitCode = 2;
    return;
  }
  const result = await runOneSemesterAllocationJob(args[1]);
  process.stdout.write(
    `${JSON.stringify({
      ...result,
      notice:
        'Reference simulation only; no academic plan or registration changed. Pending means no terminal outcome committed in this snapshot.',
    })}\n`,
  );
}
main()
  .catch(() => {
    process.stderr.write(
      'Could not confirm semester execution. Inspect its outcome before retrying the same job.\n',
    );
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
