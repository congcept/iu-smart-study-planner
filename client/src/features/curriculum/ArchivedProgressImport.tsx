import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui';
import { useAppStore } from '@/lib/store';
import type { Course } from '@/types';

interface PreviewCourse {
  id: string;
  course?: Course;
  note: string;
  problems: string[];
}

export function ArchivedProgressImport({ userId, courses }: { userId: string; courses: Course[] }) {
  const titleId = useId();
  const reviewId = useId();
  const [reviewOpen, setReviewOpen] = useState(false);
  const reviewButtonRef = useRef<HTMLDivElement>(null);
  const reviewRegionRef = useRef<HTMLDivElement>(null);
  const wasReviewOpen = useRef(false);
  useEffect(() => {
    if (reviewOpen) reviewRegionRef.current?.focus();
    else if (wasReviewOpen.current) reviewButtonRef.current?.querySelector('button')?.focus();
    wasReviewOpen.current = reviewOpen;
  }, [reviewOpen]);
  const [deferred, setDeferred] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const {
    progressOwnerId,
    browserProgressBackup: backup,
    browserProgressBackupError,
    completedIds,
    plannedIds,
    pendingCompletionIds,
    progressStatus,
    progressImportStatus,
    progressImportError,
    importBrowserProgress,
  } = useAppStore();

  const preview = useMemo(() => {
    const byId = new Map(courses.map((course) => [course.id, course]));
    const memberships = new Map<string, Set<string>>();
    for (const course of courses) {
      if (!course.electiveGroup) continue;
      const groups = memberships.get(course.id) ?? new Set<string>();
      groups.add(course.electiveGroup);
      memberships.set(course.id, groups);
    }
    const finalCompleted = new Set([
      ...Object.keys(completedIds),
      ...Object.keys(backup?.completedIds ?? {}),
    ]);
    const completed: PreviewCourse[] = Object.entries(backup?.completedIds ?? {}).map(
      ([id, claim]) => {
        const course = byId.get(id);
        const problems: string[] = [];
        if (!course) problems.push('This course is unavailable in the current curriculum.');
        if (claim !== null && !memberships.get(id)?.has(claim)) {
          problems.push(`The archived elective claim “${claim}” is not available for this course.`);
        }
        for (const edge of course?.prerequisites ?? []) {
          if (finalCompleted.has(edge.prerequisiteId)) continue;
          const prerequisite = byId.get(edge.prerequisiteId) ?? edge.prerequisite;
          problems.push(
            `Complete prerequisite ${prerequisite ? `${prerequisite.code}: ${prerequisite.name}` : edge.prerequisiteId} before importing.`,
          );
        }
        const existing = Object.prototype.hasOwnProperty.call(completedIds, id);
        const savedClaim = completedIds[id];
        const note = existing
          ? `Already completed. ${savedClaim ? `Saved claim: ${savedClaim}.` : 'No saved elective claim.'} Existing grades and claim are kept.`
          : claim !== null
            ? `Elective claim: ${claim}.`
            : memberships.has(id)
              ? 'No elective group assigned; this completion will not count toward an elective group.'
              : 'Add as completed.';
        return { id, course, note, problems };
      },
    );
    const planned: PreviewCourse[] = (backup?.plannedIds ?? []).map((id) => ({
      id,
      course: byId.get(id),
      note: Object.prototype.hasOwnProperty.call(completedIds, id)
        ? 'Already completed; kept completed.'
        : plannedIds.includes(id)
          ? 'Already planned; unchanged.'
          : 'Add as planned if no course record exists. Any existing record is kept.',
      problems: byId.has(id) ? [] : ['This course is unavailable in the current curriculum.'],
    }));
    return {
      completed,
      planned,
      blocked: [...completed, ...planned].some((entry) => entry.problems.length > 0),
    };
  }, [backup, courses, completedIds, plannedIds]);

  if (progressOwnerId !== userId) return null;
  if (progressImportStatus === 'success' && !backup)
    return (
      <p role="status" className="text-sm text-green-800">
        Earlier selections imported. Your account progress is saved.
      </p>
    );
  if (browserProgressBackupError)
    return (
      <section aria-labelledby={titleId} className="rounded-xl border border-gray-200 bg-white p-5">
        <h2 id={titleId} className="text-lg font-semibold text-gray-900">
          Earlier selections could not be read
        </h2>
        <p role="alert" className="mt-2 text-sm text-red-700">
          {browserProgressBackupError}
        </p>
        <p className="mt-2 max-w-prose text-sm text-gray-600">
          The original browser backup has been kept. You can continue using your saved account
          progress.
        </p>
      </section>
    );
  if (!backup || (!preview.completed.length && !preview.planned.length)) return null;

  const busy = progressImportStatus === 'importing';
  const ready = progressStatus === 'ready' && pendingCompletionIds.size === 0;
  const canImport = reviewOpen && ready && !busy && !preview.blocked;
  const download = () => {
    setDownloadError(null);
    try {
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' }),
      );
      const link = document.createElement('a');
      link.href = url;
      link.download = 'iu-planner-browser-selections.json';
      link.click();
      URL.revokeObjectURL(url);
    } catch {
      setDownloadError(
        'Could not download the backup. Your selections are still kept in this browser.',
      );
    }
  };
  const defer = () => {
    setReviewOpen(false);
    setDeferred(true);
  };
  const renderList = (entries: PreviewCourse[], label: string) => (
    <div>
      <h3 className="font-semibold text-gray-900">
        {label} ({entries.length})
      </h3>
      {entries.length ? (
        <ul className="mt-2 divide-y divide-gray-200">
          {entries.map(({ id, course, note, problems }) => (
            <li key={id} className="py-3 text-sm">
              <p className="break-words text-gray-900">
                <strong>{course?.code || 'Unavailable course'}</strong>
                {course ? ` · ${course.name}` : ''}
              </p>
              {!course && <p className="mt-1 break-all text-gray-600">{id}</p>}
              <p className="mt-1 text-gray-600">{note}</p>
              {problems.map((problem) => (
                <p key={problem} className="mt-1 text-red-700">
                  {problem}
                </p>
              ))}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-sm text-gray-600">No {label.toLowerCase()} in this backup.</p>
      )}
    </div>
  );

  return (
    <section
      aria-labelledby={titleId}
      aria-busy={busy}
      className="rounded-xl border border-gray-200 bg-white p-4 sm:p-5"
    >
      <h2 id={titleId} className="text-lg font-semibold text-gray-900">
        Earlier selections in this browser
      </h2>
      <p className="mt-2 max-w-prose text-sm text-gray-600">
        {deferred && !reviewOpen
          ? 'Your backup is kept. Review it whenever you are ready.'
          : `${preview.completed.length} completed and ${preview.planned.length} planned courses are backed up for this account.`}
      </p>
      {!reviewOpen ? (
        <div ref={reviewButtonRef} className="mt-3 flex flex-wrap gap-2">
          <Button
            className="min-h-11"
            aria-expanded={false}
            aria-controls={reviewId}
            onClick={() => setReviewOpen(true)}
          >
            Review selections
          </Button>
          {!deferred && (
            <Button className="min-h-11" variant="ghost" onClick={defer}>
              Later
            </Button>
          )}
        </div>
      ) : (
        <div
          id={reviewId}
          ref={reviewRegionRef}
          tabIndex={-1}
          role="region"
          aria-label="Review earlier selections"
          className="focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-700"
        >
          <p className="mt-3 max-w-prose text-sm text-gray-600">
            Import adds these selections to your saved progress. Nothing is removed. Existing course
            records, grades, and completed elective claims are kept.
          </p>
          <div
            className="mt-4 grid max-h-80 gap-6 overflow-y-auto pr-2 sm:grid-cols-2"
            tabIndex={0}
            role="region"
            aria-label="Archived course selections"
          >
            {renderList(preview.completed, 'Completed courses')}
            {renderList(preview.planned, 'Planned courses')}
          </div>
          {preview.blocked && (
            <p role="alert" className="mt-3 text-sm text-red-700">
              Resolve the course or prerequisite issues above before importing. Your backup has been
              kept.
            </p>
          )}
          {progressImportError && (
            <p role="alert" className="mt-3 text-sm text-red-700">
              {progressImportError} Your backup has been kept; review your saved progress before
              retrying.
            </p>
          )}
          {busy && (
            <p role="status" className="mt-3 text-sm text-gray-600">
              Importing selections and checking saved progress…
            </p>
          )}
          {!ready && !busy && (
            <p className="mt-3 text-sm text-gray-600">
              Wait until your saved progress is ready before importing.
            </p>
          )}
          {downloadError && (
            <p role="alert" className="mt-3 text-sm text-red-700">
              {downloadError}
            </p>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            <Button
              className="min-h-11"
              disabled={!canImport}
              isLoading={busy}
              onClick={() => {
                if (canImport) void importBrowserProgress();
              }}
            >
              Import selections
            </Button>
            <Button className="min-h-11" variant="secondary" disabled={busy} onClick={defer}>
              Later
            </Button>
            <Button className="min-h-11" variant="ghost" onClick={download}>
              Download backup
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
