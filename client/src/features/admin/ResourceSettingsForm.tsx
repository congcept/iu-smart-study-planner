import { useState, type FormEvent } from 'react';
import {
  UpsertResourcesSchema,
  type CurriculumDetailDTO,
  type ResourcesSnapshotDTO,
  type UpsertResourcesDTO,
} from '@iu-study-planner/shared';
import { Button } from '@/components/ui';

type OverrideRow = { key: number; code: string; capacity: string; professorCount: string };
const inputClass =
  'mt-2 min-h-11 w-full min-w-0 rounded-md border border-gray-300 bg-white px-3 py-2 text-base text-gray-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-700 disabled:bg-gray-100';
const numeric = (value: string) => (value.trim() === '' ? NaN : Number(value));

export function ResourceSettingsForm({
  snapshot,
  reference,
  pending,
  locked,
  saving,
  onSave,
}: {
  snapshot: ResourcesSnapshotDTO;
  reference: CurriculumDetailDTO;
  pending: UpsertResourcesDTO | null;
  locked: boolean;
  saving: boolean;
  onSave: (payload: UpsertResourcesDTO) => Promise<void>;
}) {
  const initial = pending ?? snapshot.resource;
  const [professors, setProfessors] = useState(initial ? String(initial.professors) : '');
  const [classrooms, setClassrooms] = useState(initial ? String(initial.classrooms) : '');
  const [labRooms, setLabRooms] = useState(initial ? String(initial.labRooms) : '');
  const [sectionSize, setSectionSize] = useState(
    initial ? String(initial.maxStudentsPerSection) : '',
  );
  const [rows, setRows] = useState<OverrideRow[]>(() =>
    Object.entries(initial?.courseOverrides ?? {}).map(([code, override], key) => ({
      key,
      code,
      capacity: override.capacity === undefined ? '' : String(override.capacity),
      professorCount: override.professorCount === undefined ? '' : String(override.professorCount),
    })),
  );
  const [nextKey, setNextKey] = useState(rows.length);
  const [error, setError] = useState('');
  const changeRow = (key: number, field: 'code' | 'capacity' | 'professorCount', value: string) => {
    setRows((current) =>
      current.map((row) => (row.key === key ? { ...row, [field]: value } : row)),
    );
    setError('');
  };
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (locked) return;
    const codes = rows.map((row) => row.code);
    if (new Set(codes).size !== codes.length) {
      setError('Choose each course only once.');
      return;
    }
    if (codes.some((code) => !reference.courses.some((course) => course.code === code))) {
      setError('Choose a current reference course for every override, or remove its row.');
      return;
    }
    const overrides = Object.fromEntries(
      rows.map((row) => [
        row.code,
        {
          ...(row.capacity.trim() !== '' ? { capacity: numeric(row.capacity) } : {}),
          ...(row.professorCount.trim() !== ''
            ? { professorCount: numeric(row.professorCount) }
            : {}),
        },
      ]),
    );
    const parsed = UpsertResourcesSchema.safeParse({
      curriculumId: snapshot.curriculum.id,
      semester: snapshot.semester,
      year: snapshot.year,
      professors: numeric(professors),
      classrooms: numeric(classrooms),
      labRooms: numeric(labRooms),
      maxStudentsPerSection: numeric(sectionSize),
      courseOverrides: overrides,
      expectedRevision: snapshot.resource?.revision ?? 0,
    });
    if (!parsed.success) {
      setError(
        'Enter whole numbers from 0 to 100,000 for resources. Students per section must be at least 1. Each course override needs capacity or professor count.',
      );
      return;
    }
    setError('');
    await onSave(parsed.data);
  };
  return (
    <form
      aria-label="Simulation resource settings"
      onSubmit={(event) => void save(event)}
      className="space-y-6"
    >
      <fieldset disabled={locked}>
        <legend className="text-lg font-semibold text-gray-900">Available resources</legend>
        <p className="mt-2 max-w-prose text-sm text-gray-600">
          Enter the resources available in this simulation. Zero means none are available; blank
          fields are incomplete.
        </p>
        <div className="mt-4 grid grid-cols-1 gap-5 sm:grid-cols-2">
          {(
            [
              ['Professors', professors, setProfessors, 0],
              ['Classrooms', classrooms, setClassrooms, 0],
              ['Lab rooms', labRooms, setLabRooms, 0],
              ['Students per section', sectionSize, setSectionSize, 1],
            ] as const
          ).map(([label, value, update, min]) => (
            <label key={label} className="block text-sm font-medium text-gray-900">
              {label}
              <input
                type="number"
                inputMode="numeric"
                min={min}
                max={100000}
                step={1}
                required
                value={value}
                onChange={(event) => {
                  update(event.target.value);
                  setError('');
                }}
                className={inputClass}
              />
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset disabled={locked} className="border-t border-gray-200 pt-6">
        <legend className="text-lg font-semibold text-gray-900">Course overrides</legend>
        <p className="mt-2 max-w-prose text-sm text-gray-600">
          Optional limits for individual reference courses. Leave one field blank to keep that limit
          unspecified. Saving replaces the complete override list.
        </p>
        <div className="mt-4 space-y-5">
          {rows.map((row, index) => (
            <div
              key={row.key}
              role="group"
              aria-label={`Course override ${index + 1}`}
              className="border-b border-gray-200 pb-5"
            >
              <label className="block text-sm font-medium text-gray-900">
                Course
                <select
                  value={row.code}
                  onChange={(event) => changeRow(row.key, 'code', event.target.value)}
                  className={inputClass}
                  required
                >
                  <option value="">Choose a reference course</option>
                  {row.code && !reference.courses.some((course) => course.code === row.code) && (
                    <option value={row.code}>
                      {row.code} — outside current reference; remove before saving
                    </option>
                  )}
                  {reference.courses.map((course) => (
                    <option
                      key={course.id}
                      value={course.code}
                      disabled={rows.some(
                        (other) => other.key !== row.key && other.code === course.code,
                      )}
                    >
                      {course.code} — {course.name}
                    </option>
                  ))}
                </select>
              </label>
              <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                <label className="block text-sm font-medium text-gray-900">
                  Capacity
                  <input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={100000}
                    step={1}
                    value={row.capacity}
                    onChange={(event) => changeRow(row.key, 'capacity', event.target.value)}
                    className={inputClass}
                  />
                </label>
                <label className="block text-sm font-medium text-gray-900">
                  Professor count
                  <input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={100000}
                    step={1}
                    value={row.professorCount}
                    onChange={(event) => changeRow(row.key, 'professorCount', event.target.value)}
                    className={inputClass}
                  />
                </label>
              </div>
              <Button
                type="button"
                variant="secondary"
                className="mt-3 min-h-11"
                onClick={() => {
                  setRows((current) => current.filter((item) => item.key !== row.key));
                  setError('');
                }}
              >
                Remove override
              </Button>
            </div>
          ))}
        </div>
        <Button
          type="button"
          variant="secondary"
          className="mt-4 min-h-11"
          disabled={rows.length >= 500 || reference.courses.length === 0}
          onClick={() => {
            setRows((current) => [
              ...current,
              { key: nextKey, code: '', capacity: '', professorCount: '' },
            ]);
            setNextKey((current) => current + 1);
          }}
        >
          Add course override
        </Button>
      </fieldset>
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
      <Button type="submit" className="min-h-11" disabled={locked} isLoading={saving}>
        Save simulation settings
      </Button>
    </form>
  );
}
