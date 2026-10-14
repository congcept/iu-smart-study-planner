import type {
  SimulationSemesterRun,
  SimulationSemesterParticipant,
  SimulationSemesterAllocationExecution,
  SimulationSemesterAllocationJob,
} from '@prisma/client';
import {
  CreateSemesterAllocationRunSchema,
  OwnSemesterAllocationRunV1Schema,
  SemesterAllocationRunV1Schema,
  SemesterAllocationStorageV1Schema,
  SemesterAllocationStudentResultV1Schema,
  SemesterAllocationJobSchema,
  SemesterAllocationJobOutcomeSchema,
  type SemesterAllocationStorageV1DTO,
  type SemesterAllocationJobOutcomeDTO,
} from '@iu-study-planner/shared';

export type StoredRun = SimulationSemesterRun & { participants: SimulationSemesterParticipant[] };
export type StoredExecution = SimulationSemesterAllocationExecution & { run: StoredRun | null };
export type StoredHistoryRow = SimulationSemesterAllocationJob & {
  execution: StoredExecution | null;
  run: { id: string } | null;
};
const uuid = CreateSemesterAllocationRunSchema.shape.expectedActorId;
const jobUuid = SemesterAllocationJobSchema.shape.id;
const storedError = () => new Error('Stored semester simulation could not be verified');
const outcomeStoredError = () =>
  new Error('Stored semester simulation outcome could not be verified');

// Pure extraction of the existing pinned verifiers/projections. No database/config imports.
/** Private verifier only. No public reader returns the full snapshot or captured UUIDs. */
export function verifyStoredSemesterAllocationRun(row: StoredRun): SemesterAllocationStorageV1DTO {
  const parsed = SemesterAllocationStorageV1Schema.safeParse({
    id: row.id,
    formatVersion: row.formatVersion,
    capturedAt: row.capturedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    snapshotStored: true,
    simulationAssignmentsStored: true,
    result: row.result,
  });
  if (!parsed.success || row.participants.length > 500) throw storedError();
  const scope = parsed.data.result.envelope.scope;
  if (
    scope.curriculumId !== row.curriculumId.toLowerCase() ||
    scope.semester !== row.semester ||
    scope.year !== row.year ||
    !uuid.safeParse(row.requestId).success ||
    (row.jobId !== null && !uuid.safeParse(row.jobId).success) ||
    (row.createdById !== null && !uuid.safeParse(row.createdById).success)
  )
    throw storedError();
  const outcomes = new Map(
    parsed.data.result.students.map((student) => [student.studentId, student]),
  );
  if (row.participants.length !== outcomes.size) throw storedError();
  const seen = new Set<string>();
  for (const participant of row.participants) {
    const id = uuid.safeParse(participant.capturedStudentId);
    const user = participant.userId === null ? null : uuid.safeParse(participant.userId);
    const result = SemesterAllocationStudentResultV1Schema.safeParse(participant.result);
    if (
      !uuid.safeParse(participant.id).success ||
      participant.runId.toLowerCase() !== parsed.data.id ||
      !id.success ||
      (user !== null && (!user.success || user.data !== id.data)) ||
      !result.success ||
      result.data.studentId !== id.data ||
      seen.has(id.data) ||
      JSON.stringify(result.data) !== JSON.stringify(outcomes.get(id.data))
    )
      throw storedError();
    seen.add(id.data);
  }
  return parsed.data;
}

function metadata(run: SemesterAllocationStorageV1DTO) {
  return {
    id: run.id,
    formatVersion: run.formatVersion,
    capturedAt: run.capturedAt,
    createdAt: run.createdAt,
    snapshotStored: run.snapshotStored,
    simulationAssignmentsStored: run.simulationAssignmentsStored,
  };
}

/** Projection deliberately omits participant identities, choices, utilities and retry keys. */
export function projectSemesterAllocationRun(run: SemesterAllocationStorageV1DTO) {
  const result = run.result;
  const stopReasonCounts = {
    TARGET_REACHED: 0,
    NO_REMAINING_CHOICES: 0,
    CREDIT_LIMIT: 0,
    RESOURCE_UNKNOWN: 0,
    CAPACITY_EXHAUSTED: 0,
  };
  for (const student of result.students) stopReasonCounts[student.reason]++;
  return SemesterAllocationRunV1Schema.parse({
    ...metadata(run),
    result: {
      kind: 'SIMULATION',
      usage: 'REFERENCE_ONLY',
      model: result.model,
      scope: result.envelope.scope,
      curriculum: result.envelope.curriculum,
      envelope: result.envelope,
      policy: result.policy,
      studentCount: result.students.length,
      assignedStudentCount: result.assignedStudentCount,
      assignedCourseCount: result.assignedCourseCount,
      totalTargetCredits: result.students.reduce((sum, student) => sum + student.targetCredits, 0),
      totalAssignedCredits: result.students.reduce(
        (sum, student) => sum + student.assignedCredits,
        0,
      ),
      totalRemainingCredits: result.students.reduce(
        (sum, student) => sum + student.remainingCredits,
        0,
      ),
      stopReasonCounts,
      usedSections: result.usedSections,
      rounds: result.rounds,
      courses: result.courses,
      eligibilityValidated: false,
      allocationValidated: false,
      timetableValidated: false,
      academicPlansChanged: false,
    },
  });
}

/** Project only a verified historical participant outcome; callers authorize its live access FK. */
export function projectOwnSemesterAllocationRun(
  run: SemesterAllocationStorageV1DTO,
  capturedStudentId: string,
) {
  const outcome = run.result.students.find(
    (student) => student.studentId === capturedStudentId.toLowerCase(),
  );
  if (!outcome) throw storedError();
  const own = {
    targetCredits: outcome.targetCredits,
    courseIds: outcome.courseIds,
    assignedCredits: outcome.assignedCredits,
    remainingCredits: outcome.remainingCredits,
    reason: outcome.reason,
  };
  const catalog = new Map(run.result.courses.map((course) => [course.courseId, course.credits]));
  return OwnSemesterAllocationRunV1Schema.parse({
    ...metadata(run),
    kind: 'SIMULATION',
    usage: 'REFERENCE_ONLY',
    model: run.result.model,
    scope: run.result.envelope.scope,
    eligibilityValidated: false,
    allocationValidated: false,
    timetableValidated: false,
    academicPlansChanged: false,
    result: own,
    courses: own.courseIds.map((courseId) => ({ courseId, credits: catalog.get(courseId) })),
  });
}

/** Full private replay and exact job provenance precede the small public projection. */
export function verifyStoredSemesterAllocationJobOutcome(
  job: SimulationSemesterAllocationJob,
  execution: StoredExecution | null,
): SemesterAllocationJobOutcomeDTO {
  const receipt = SemesterAllocationJobSchema.safeParse({
    id: job.id,
    kind: 'SIMULATION',
    usage: 'REFERENCE_ONLY',
    model: job.model,
    scope: { curriculumId: job.curriculumId, semester: job.semester, year: job.year },
    status: 'QUEUED',
    queuedAt: job.createdAt.toISOString(),
    inputsCaptured: false,
  });
  if (
    !receipt.success ||
    !jobUuid.safeParse(job.requestId).success ||
    (job.createdById !== null && !jobUuid.safeParse(job.createdById).success) ||
    (execution !== null && execution.jobId !== receipt.data.id)
  )
    throw outcomeStoredError();
  if (execution?.status === 'SUCCEEDED') {
    const row = execution.run;
    if (
      !row ||
      row.id !== execution.runId ||
      row.jobId !== receipt.data.id ||
      row.createdById !== job.createdById
    )
      throw outcomeStoredError();
    const run = verifyStoredSemesterAllocationRun(row);
    if (
      run.result.model !== receipt.data.model ||
      JSON.stringify(run.result.envelope.scope) !== JSON.stringify(receipt.data.scope) ||
      row.capturedAt < job.createdAt ||
      row.createdAt < row.capturedAt ||
      execution.completedAt < row.createdAt
    )
      throw outcomeStoredError();
  } else if (execution?.run !== null && execution?.run !== undefined) {
    throw outcomeStoredError();
  }
  const outcome = SemesterAllocationJobOutcomeSchema.safeParse({
    jobId: receipt.data.id,
    kind: 'SIMULATION',
    usage: 'REFERENCE_ONLY',
    model: receipt.data.model,
    scope: receipt.data.scope,
    queuedAt: receipt.data.queuedAt,
    executionModel: 'ATOMIC_SINGLE_JOB',
    status: execution?.status ?? 'PENDING',
    runId: execution?.runId ?? null,
    completedAt: execution?.completedAt.toISOString() ?? null,
    failureCode: execution?.failureCode ?? null,
  });
  if (!outcome.success) throw outcomeStoredError();
  return outcome.data;
}

export function verifySemesterHistoryRequest(row: StoredHistoryRow) {
  const outcome = verifyStoredSemesterAllocationJobOutcome(row, row.execution);
  // Nonterminal/failed requests must not hide a linked orphan. A success links the exact run.
  if (
    (outcome.status === 'SUCCEEDED' && row.run?.id !== outcome.runId) ||
    (outcome.status !== 'SUCCEEDED' && row.run !== null)
  )
    throw new Error('Stored semester request history could not be verified');
  const job = SemesterAllocationJobSchema.parse({
    id: outcome.jobId,
    kind: 'SIMULATION',
    usage: 'REFERENCE_ONLY',
    model: outcome.model,
    scope: outcome.scope,
    status: 'QUEUED',
    queuedAt: outcome.queuedAt,
    inputsCaptured: false,
  });
  return { job, outcome };
}
