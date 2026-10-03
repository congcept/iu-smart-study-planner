import type { useGpaPath } from './useGpaPath';

type Props = { policy: ReturnType<typeof useGpaPath> };

export function GpaPathControls({ policy }: Props) {
  if (policy.status === 'loading')
    return (
      <p role="status" className="text-sm text-gray-700">
        Loading your GPA path…
      </p>
    );
  if (policy.status === 'error')
    return (
      <div className="space-y-3">
        <p role="alert" className="text-sm text-red-700">
          Could not load your GPA path. Check your connection and try again.
        </p>
        <button
          type="button"
          className="min-h-11 rounded bg-blue-600 px-3 text-sm text-white"
          onClick={() => void policy.reload()}
        >
          Reload GPA path
        </button>
      </div>
    );
  if (!policy.manual)
    return (
      <div className="space-y-2 text-xs text-gray-700">
        <p className="font-semibold">
          {policy.mode === 'above' ? 'Thesis path' : 'Alternative path'}
        </p>
        <p className="tabular-nums">Recorded GPA: {policy.gpa100?.toFixed(2)} / 100</p>
        <p>
          Selected from your highest recorded course scores. The server compares the GPA before
          display rounding.
        </p>
        {policy.missingGradeCount > 0 && (
          <p>
            {policy.missingGradeCount} completed{' '}
            {policy.missingGradeCount === 1 ? 'course has' : 'courses have'} no numeric score yet.
          </p>
        )}
      </div>
    );
  return (
    <div className="space-y-2">
      <p className="text-xs text-gray-700">Choose a path while no numeric GPA is recorded.</p>
      <div className="flex gap-1">
        <button
          type="button"
          aria-pressed={policy.mode === 'above'}
          onClick={() => policy.selectManual('above')}
          className={`min-h-11 flex-1 rounded px-1 text-xs font-semibold ${policy.mode === 'above' ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-700'}`}
        >
          GPA {'>'} 70
        </button>
        <button
          type="button"
          aria-pressed={policy.mode === 'below'}
          onClick={() => policy.selectManual('below')}
          className={`min-h-11 flex-1 rounded px-1 text-xs font-semibold ${policy.mode === 'below' ? 'bg-orange-600 text-white' : 'bg-gray-200 text-gray-700'}`}
        >
          GPA {'<='} 70
        </button>
      </div>
    </div>
  );
}
