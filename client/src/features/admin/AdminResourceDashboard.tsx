import { isAxiosError } from 'axios';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ResourceScopeSchema,
  ResourcesSnapshotSchema,
  type CurriculumDetailDTO,
  type CurriculumSummaryDTO,
  type ResourceScopeDTO,
  type ResourcesSnapshotDTO,
  type UpsertResourcesDTO,
} from '@iu-study-planner/shared';
import { Button } from '@/components/ui';
import { getSession } from '@/lib/api';
import { getResources, saveResources } from '@/lib/adminResourcesApi';
import { getCurriculumReference, getCurriculumReferences } from '@/lib/curriculumApi';
import { ResourceSettingsForm } from './ResourceSettingsForm';
import { PlannedDemandPanel } from './PlannedDemandPanel';
import { AllocationPreviewPanel } from './AllocationPreviewPanel';
import { SemesterAllocationPreviewPanel } from './SemesterAllocationPreviewPanel';
import { AllocationRunCapturePanel } from './AllocationRunCapturePanel';
import { AllocationRunHistoryPanel } from './AllocationRunHistoryPanel';
import { AllocationJobPanel } from './AllocationJobPanel';
import { AllocationJobHistoryPanel } from './AllocationJobHistoryPanel';
import {
  ResourceRequestSchema,
  resourceRequestKey,
  confirmsResourceRequest,
} from './resourceRecovery';

type Selection = { curriculumId: string; semester: ResourceScopeDTO['semester']; year: string };
type Loaded = {
  key: string;
  sequence: number;
  snapshot: ResourcesSnapshotDTO;
  reference: CurriculumDetailDTO;
};
const selectionKey = (selection: Selection) => JSON.stringify(selection);
const selectionOf = (scope: ResourceScopeDTO): Selection => ({
  curriculumId: scope.curriculumId,
  semester: scope.semester,
  year: String(scope.year),
});
class AdminSessionChanged extends Error {}

export function AdminResourceDashboard({ userId }: { userId: string }) {
  const owner = userId.toLowerCase();
  return <ResourceSession key={owner} userId={owner} />;
}

function ResourceSession({ userId }: { userId: string }) {
  const [journal] = useState(() => {
    try {
      const raw = sessionStorage.getItem(resourceRequestKey(userId));
      const request = raw ? ResourceRequestSchema.parse(JSON.parse(raw)) : null;
      if (request && request.userId !== userId) throw new Error('Wrong recovery owner');
      return { payload: request?.payload ?? null, invalid: false };
    } catch {
      return { payload: null, invalid: true };
    }
  });
  const pending = useRef<UpsertResourcesDTO | null>(journal.payload);
  const invalidJournal = useRef(journal.invalid);
  const generation = useRef(0);
  const busy = useRef(false);
  const [references, setReferences] = useState<CurriculumSummaryDTO[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogError, setCatalogError] = useState(false);
  const [selection, setSelection] = useState<Selection>(
    journal.payload
      ? selectionOf(journal.payload)
      : { curriculumId: '', semester: 'FALL', year: String(new Date().getFullYear()) },
  );
  const currentKey = selectionKey(selection);
  const identity = useRef(currentKey);
  if (identity.current !== currentKey) {
    identity.current = currentKey;
    generation.current++;
  }
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(
    journal.invalid
      ? 'This tab’s recovery data cannot be verified. Clear the local request before saving.'
      : journal.payload
        ? 'A previous save is unconfirmed. Check the saved settings before starting another save.'
        : '',
  );

  const verifySession = useCallback(async () => {
    const user = await getSession();
    if (!user || user.id.toLowerCase() !== userId || user.role !== 'ADMIN')
      throw new AdminSessionChanged();
  }, [userId]);
  const readSnapshot = useCallback(async (scope: ResourceScopeDTO) => {
    const snapshot = ResourcesSnapshotSchema.parse(await getResources(scope));
    if (
      snapshot.curriculum.id !== scope.curriculumId ||
      snapshot.semester !== scope.semester ||
      snapshot.year !== scope.year
    )
      throw new Error('Wrong resource scope');
    return snapshot;
  }, []);
  const loadCatalog = useCallback(async () => {
    if (busy.current) return;
    const token = ++generation.current;
    setCatalogLoading(true);
    setCatalogError(false);
    setLoaded(null);
    try {
      await verifySession();
      if (token !== generation.current) return;
      const rows = await getCurriculumReferences();
      if (token !== generation.current) return;
      setReferences(rows);
      setSelection((current) =>
        current.curriculumId ? current : { ...current, curriculumId: rows[0]?.id ?? '' },
      );
    } catch (error) {
      if (token === generation.current) {
        setCatalogError(true);
        setMessage(
          error instanceof AdminSessionChanged
            ? 'Your admin session changed. Sign in again before configuring resources.'
            : 'Could not load curriculum references. Check your connection and reload.',
        );
      }
    } finally {
      if (token === generation.current) setCatalogLoading(false);
    }
  }, [verifySession]);
  const load = useCallback(async () => {
    if (busy.current || catalogLoading || catalogError || !selection.curriculumId) return;
    const token = ++generation.current;
    setLoading(true);
    setLoadError('');
    setLoaded(null);
    const parsed = ResourceScopeSchema.safeParse({
      ...selection,
      year: selection.year.trim() === '' ? NaN : Number(selection.year),
    });
    if (!parsed.success) {
      setLoadError('Choose a curriculum and a whole year from 2000 to 2100.');
      setLoading(false);
      return;
    }
    try {
      await verifySession();
      if (token !== generation.current) return;
      const [snapshot, reference] = await Promise.all([
        readSnapshot(parsed.data),
        getCurriculumReference(parsed.data.curriculumId),
      ]);
      if (token !== generation.current) return;
      if (reference.id.toLowerCase() !== parsed.data.curriculumId)
        throw new Error('Wrong reference');
      setLoaded({ key: currentKey, sequence: token, snapshot, reference });
    } catch (error) {
      if (token === generation.current)
        setLoadError(
          error instanceof AdminSessionChanged
            ? 'Your admin session changed. Sign in again before configuring resources.'
            : 'Could not load saved settings and reference courses. Reload to try again.',
        );
    } finally {
      if (token === generation.current) setLoading(false);
    }
  }, [catalogError, catalogLoading, currentKey, readSnapshot, selection, verifySession]);
  useEffect(() => {
    const active = generation;
    void loadCatalog();
    return () => {
      active.current++;
    };
  }, [loadCatalog]);
  useEffect(() => {
    void load();
  }, [load]);

  const confirm = async (payload: UpsertResourcesDTO, token: number) => {
    await verifySession();
    if (token !== generation.current) return false;
    const snapshot = await readSnapshot({
      curriculumId: payload.curriculumId,
      semester: payload.semester,
      year: payload.year,
    });
    if (token !== generation.current || !confirmsResourceRequest(snapshot, payload, userId))
      return false;
    sessionStorage.removeItem(resourceRequestKey(userId));
    pending.current = null;
    invalidJournal.current = false;
    setLoaded((previous) =>
      previous && previous.key === currentKey
        ? { ...previous, sequence: token, snapshot }
        : previous,
    );
    setMessage('Simulation settings saved and confirmed.');
    return true;
  };
  const checkSaved = async () => {
    const payload = pending.current;
    if (busy.current || !payload || invalidJournal.current) return;
    busy.current = true;
    setSaving(true);
    setMessage('Checking saved simulation settings…');
    const token = ++generation.current;
    try {
      if (!(await confirm(payload, token)) && token === generation.current)
        setMessage(
          'The saved settings do not confirm this request. It remains preserved in this tab. Clear the local request, then review the latest settings before saving again.',
        );
    } catch (error) {
      if (token === generation.current)
        setMessage(
          error instanceof AdminSessionChanged
            ? 'Your admin session changed. The local request is preserved; sign in again before checking it.'
            : 'Could not confirm saved settings or clear recovery data. The local request is preserved.',
        );
    } finally {
      if (token === generation.current) {
        busy.current = false;
        setSaving(false);
      }
    }
  };
  const clearPending = () => {
    if (busy.current) return;
    try {
      sessionStorage.removeItem(resourceRequestKey(userId));
      pending.current = null;
      invalidJournal.current = false;
      setMessage('The local request was cleared. Saved server settings remain unchanged.');
      void load();
    } catch {
      setMessage('Could not clear recovery data. Restore this tab’s storage and try again.');
    }
  };
  const save = async (payload: UpsertResourcesDTO) => {
    if (
      busy.current ||
      pending.current ||
      invalidJournal.current ||
      loading ||
      !loaded ||
      loaded.key !== currentKey ||
      loaded.sequence !== generation.current
    )
      return;
    if (
      payload.curriculumId !== loaded.snapshot.curriculum.id ||
      payload.semester !== loaded.snapshot.semester ||
      payload.year !== loaded.snapshot.year ||
      payload.expectedRevision !== (loaded.snapshot.resource?.revision ?? 0)
    )
      return;
    busy.current = true;
    setSaving(true);
    setMessage('Saving simulation settings…');
    const token = ++generation.current;
    let postError: unknown;
    try {
      await verifySession();
      if (token !== generation.current) return;
      // Persist before POST so reload and lost-response recovery never silently rebase the write.
      sessionStorage.setItem(resourceRequestKey(userId), JSON.stringify({ userId, payload }));
      pending.current = payload;
      try {
        await saveResources(payload);
      } catch (error) {
        postError = error;
      }
      if (token !== generation.current) return;
      if (!(await confirm(payload, token)) && token === generation.current)
        setMessage(
          isAxiosError(postError) && postError.response?.status === 409
            ? 'A different revision is saved. Your request was not confirmed. Clear the local request to load and review the latest settings.'
            : 'Could not confirm this save. The request is preserved. Check saved settings; no save will be retried automatically.',
        );
    } catch (error) {
      if (token === generation.current) {
        if (!pending.current && !(error instanceof AdminSessionChanged)) {
          invalidJournal.current = true;
        }
        setMessage(
          error instanceof AdminSessionChanged
            ? 'Your admin session changed. Sign in again before configuring resources.'
            : pending.current
              ? 'Could not confirm this save or clear recovery data. The request is preserved; check saved settings again.'
              : 'Could not preserve this request for recovery. Restore this tab’s storage and reload before saving.',
        );
      }
    } finally {
      if (token === generation.current) {
        busy.current = false;
        setSaving(false);
      }
    }
  };
  const active = loaded?.key === currentKey ? loaded : null;
  const pendingRequest = pending.current;
  const recoveryBlocked = !!pendingRequest || invalidJournal.current;
  const fieldClass =
    'mt-2 min-h-11 w-full min-w-0 rounded-md border border-gray-300 bg-white px-3 py-2 text-base text-gray-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-700 disabled:bg-gray-100';
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <header>
        <h2 className="text-2xl font-bold text-gray-900">Simulation resources</h2>
        <p className="mt-2 max-w-prose text-sm text-gray-600">
          Configure a school-admin resource scenario for a curriculum and semester. These inputs are
          simulated. Review planned selections, allocation previews and saved simulation outcomes.
          Official course offerings and full-semester allocation remain unverified.
        </p>
      </header>
      {message && (
        <p
          role={recoveryBlocked || loadError || catalogError ? 'alert' : 'status'}
          className="text-sm text-gray-700"
        >
          {message}
        </p>
      )}
      {recoveryBlocked && (
        <div className="space-y-3">
          <p className="text-sm text-gray-600">
            Clearing a local request only removes this tab’s recovery copy. It does not change saved
            settings.
          </p>
          <div className="flex flex-wrap gap-3">
            {pendingRequest && !invalidJournal.current && (
              <Button
                variant="secondary"
                className="min-h-11"
                disabled={saving || catalogLoading || loading}
                onClick={() => void checkSaved()}
              >
                Check saved settings
              </Button>
            )}
            <Button
              variant="secondary"
              className="min-h-11"
              disabled={saving || catalogLoading || loading}
              onClick={clearPending}
            >
              Clear local request
            </Button>
          </div>
        </div>
      )}
      {catalogLoading ? (
        <p role="status" className="text-gray-600">
          Loading simulation curriculum references…
        </p>
      ) : catalogError ? (
        <Button className="min-h-11" onClick={() => void loadCatalog()}>
          Reload references
        </Button>
      ) : references.length === 0 && !pendingRequest ? (
        <p className="text-gray-600">
          No reference curricula are available. Add and verify a curriculum reference before
          configuring a simulation.
        </p>
      ) : (
        <>
          <section aria-label="Simulation selection" className="border-b border-gray-200 pb-6">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <label className="block text-sm font-medium text-gray-900 sm:col-span-2">
                Reference curriculum
                <select
                  className={fieldClass}
                  disabled={saving || recoveryBlocked}
                  value={selection.curriculumId}
                  onChange={(event) =>
                    setSelection((current) => ({ ...current, curriculumId: event.target.value }))
                  }
                >
                  {selection.curriculumId &&
                    !references.some((reference) => reference.id === selection.curriculumId) && (
                      <option value={selection.curriculumId}>Previous simulation curriculum</option>
                    )}
                  {references.map((reference) => (
                    <option key={reference.id} value={reference.id}>
                      {reference.code} — {reference.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm font-medium text-gray-900">
                Semester
                <select
                  className={fieldClass}
                  disabled={saving || recoveryBlocked}
                  value={selection.semester}
                  onChange={(event) =>
                    setSelection((current) => ({
                      ...current,
                      semester: event.target.value as ResourceScopeDTO['semester'],
                    }))
                  }
                >
                  <option value="FALL">Fall</option>
                  <option value="SPRING">Spring</option>
                  <option value="SUMMER">Summer</option>
                </select>
              </label>
              <label className="block text-sm font-medium text-gray-900">
                Year
                <input
                  type="number"
                  inputMode="numeric"
                  min={2000}
                  max={2100}
                  step={1}
                  className={fieldClass}
                  disabled={saving || recoveryBlocked}
                  value={selection.year}
                  onChange={(event) =>
                    setSelection((current) => ({ ...current, year: event.target.value }))
                  }
                />
              </label>
            </div>
            <p className="mt-3 text-sm text-gray-600">
              This selects a simulation scenario and does not assign a curriculum to any account.
              Changing the selection or reloading replaces unsaved edits.
            </p>
            <Button
              variant="secondary"
              className="mt-3 min-h-11"
              disabled={saving || loading}
              onClick={() => void load()}
            >
              Reload saved settings
            </Button>
          </section>
          {loading ? (
            <p role="status" className="text-gray-600">
              Loading saved settings and reference courses…
            </p>
          ) : loadError ? (
            <p role="alert" className="text-red-700">
              {loadError}
            </p>
          ) : (
            active && (
              <section
                aria-label="Simulation configuration"
                className="rounded-xl border border-gray-200 bg-white p-5 sm:p-6"
              >
                <h3 className="break-words text-lg font-semibold text-gray-900">
                  {active.snapshot.curriculum.name} · {active.snapshot.semester.toLowerCase()}{' '}
                  {active.snapshot.year}
                </h3>
                <p className="mt-2 mb-6 text-sm text-gray-600">
                  {active.snapshot.resource
                    ? `Saved revision ${active.snapshot.resource.revision}. Last updated ${new Date(active.snapshot.resource.updatedAt).toLocaleString()}.`
                    : 'No simulation settings are saved for this selection. Complete all four resource fields to create them.'}
                </p>
                {pendingRequest && (
                  <p className="mb-6 text-sm text-gray-700">
                    The fields below show your unconfirmed request, based on revision{' '}
                    {pendingRequest.expectedRevision}. They have not been confirmed as the saved
                    settings.
                  </p>
                )}
                <ResourceSettingsForm
                  key={`${active.key}:${active.sequence}`}
                  snapshot={active.snapshot}
                  reference={active.reference}
                  pending={pendingRequest}
                  locked={saving || recoveryBlocked || active.sequence !== generation.current}
                  saving={saving}
                  onSave={save}
                />
              </section>
            )
          )}
          {active && !loading && !loadError && (
            <SemesterAllocationPreviewPanel
              userId={userId}
              scope={{
                curriculumId: active.snapshot.curriculum.id,
                semester: active.snapshot.semester,
                year: active.snapshot.year,
              }}
              resourceRevision={active.snapshot.resource?.revision ?? null}
              courses={active.reference.courses}
            />
          )}
          {active && !loading && !loadError && (
            <AllocationPreviewPanel
              userId={userId}
              scope={{
                curriculumId: active.snapshot.curriculum.id,
                semester: active.snapshot.semester,
                year: active.snapshot.year,
              }}
              resourceRevision={active.snapshot.resource?.revision ?? null}
            />
          )}
          {active && !loading && !loadError && (
            <AllocationJobPanel
              userId={userId}
              scope={{
                curriculumId: active.snapshot.curriculum.id,
                semester: active.snapshot.semester,
                year: active.snapshot.year,
              }}
            />
          )}
          {active && !loading && !loadError && (
            <AllocationJobHistoryPanel
              userId={userId}
              scope={{
                curriculumId: active.snapshot.curriculum.id,
                semester: active.snapshot.semester,
                year: active.snapshot.year,
              }}
            />
          )}
          {active && !loading && !loadError && (
            <AllocationRunCapturePanel
              userId={userId}
              scope={{
                curriculumId: active.snapshot.curriculum.id,
                semester: active.snapshot.semester,
                year: active.snapshot.year,
              }}
            />
          )}
          {active && !loading && !loadError && (
            <AllocationRunHistoryPanel
              userId={userId}
              scope={{
                curriculumId: active.snapshot.curriculum.id,
                semester: active.snapshot.semester,
                year: active.snapshot.year,
              }}
            />
          )}
          {active && !loading && !loadError && (
            <PlannedDemandPanel
              userId={userId}
              scope={{
                curriculumId: active.snapshot.curriculum.id,
                semester: active.snapshot.semester,
                year: active.snapshot.year,
              }}
              resourceRevision={active.snapshot.resource?.revision ?? null}
            />
          )}
        </>
      )}
    </div>
  );
}
