import '@testing-library/jest-dom/vitest';
import { AxiosError } from 'axios';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppendGradeAttemptDTO, StudentGradesDTO } from '@iu-study-planner/shared';
import { getCourses } from '@/lib/api';
import { appendStudentGrade, getStudentGrades } from '@/lib/gradesApi';
import { GradeEntry } from '../GradeEntry';
import { GradeDashboard } from '../GradeDashboard';
vi.mock('@/lib/api', () => ({ getCourses: vi.fn() }));
vi.mock('@/lib/gradesApi', () => ({ appendStudentGrade: vi.fn(), getStudentGrades: vi.fn() }));
const catalog = vi.mocked(getCourses);
const append = vi.mocked(appendStudentGrade);
const read = vi.mocked(getStudentGrades);
const courseId = '00000000-0000-4000-8000-000000000001';
const requestId = '00000000-0000-4000-8000-000000000002';
const empty: StudentGradesDTO = {
  attempts: [],
  summary: { gpa100: null, gradedCourseCount: 0, gradedCredits: 0, courseScores: [] },
  completedCoursesWithoutNumericGrades: [],
};
const payload: AppendGradeAttemptDTO = { courseId, requestId, score: 0 };
const saved = (data = payload): StudentGradesDTO => ({
  ...empty,
  summary: {
    gpa100: data.score,
    gradedCourseCount: 1,
    gradedCredits: 4,
    courseScores: [{ courseId, score: data.score, credits: 4 }],
  },
  attempts: [
    {
      ...data,
      id: 'attempt',
      semester: data.semester ?? null,
      year: data.year ?? null,
      createdAt: '2026-10-03T00:00:00Z',
      course: { id: courseId, code: 'MA001IU', name: 'Calculus 1', credits: 4 },
    },
  ],
});
const onSaved = vi.fn();
const storage = new Map<string, string>();
const key = 'pending_grade_attempt:one';
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function mount() {
  const view = render(<GradeEntry userId="one" onSaved={onSaved} />);
  await waitFor(() => expect(screen.queryByText('Loading courses…')).not.toBeInTheDocument());
  return view;
}
function fill(score = '0') {
  fireEvent.change(screen.getByLabelText('Course'), { target: { value: courseId } });
  fireEvent.change(screen.getByLabelText('Score out of 100'), { target: { value: score } });
}
function submit() {
  fireEvent.click(screen.getByRole('button', { name: 'Save score' }));
}
beforeEach(() => {
  vi.resetAllMocks();
  storage.clear();
  vi.stubGlobal('sessionStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
  catalog.mockResolvedValue({
    success: true,
    data: [
      { id: courseId, code: 'MA001IU', name: 'Calculus 1' } as NonNullable<
        Awaited<ReturnType<typeof getCourses>>['data']
      >[number],
    ],
  });
  append.mockImplementation(async (data) => saved(data));
  read.mockResolvedValue(empty);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
describe('numeric grade entry', () => {
  it('updates dashboard history from the returned snapshot without an extra load', async () => {
    render(<GradeDashboard userId="one" />);
    await waitFor(() => expect(screen.getByLabelText('Course')).toBeEnabled());
    fill('85');
    submit();
    await screen.findByRole('region', { name: 'Grade history table' });
    expect(screen.getByText('85')).toBeInTheDocument();
    expect(screen.getByText('Highest')).toBeInTheDocument();
    expect(read).toHaveBeenCalledTimes(1);
  });
  it('saves a real zero with a UUID, clears the journal and publishes the full snapshot', async () => {
    await mount();
    fill();
    submit();
    await screen.findByText('Score saved. Course completion is unchanged.');
    expect(append).toHaveBeenCalledTimes(1);
    expect(append.mock.calls[0][0]).toMatchObject({ courseId, score: 0 });
    expect(append.mock.calls[0][0].requestId).toMatch(/^[a-f0-9-]{36}$/);
    expect(onSaved).toHaveBeenCalledWith(saved(append.mock.calls[0][0]));
    expect(storage.has(key)).toBe(false);
    expect(screen.getByLabelText('Score out of 100')).toHaveFocus();
  });
  it('accepts decimal scores and optional term metadata', async () => {
    await mount();
    fill('83.75');
    fireEvent.change(screen.getByLabelText('Semester (optional)'), { target: { value: 'SPRING' } });
    fireEvent.change(screen.getByLabelText('Year (optional)'), { target: { value: '2026' } });
    submit();
    await waitFor(() => expect(append).toHaveBeenCalled());
    expect(append.mock.calls[0][0]).toMatchObject({ score: 83.75, semester: 'SPRING', year: 2026 });
  });
  it.each(['', '-1', '101'])('rejects invalid score %s without a write', async (score) => {
    await mount();
    fill(score);
    submit();
    expect(await screen.findByRole('alert')).toHaveTextContent('Choose a course');
    expect(append).not.toHaveBeenCalled();
  });
  it('rejects missing course and fractional/out-of-range years', async () => {
    await mount();
    submit();
    expect(append).not.toHaveBeenCalled();
    fill('80');
    for (const year of ['2026.5', '1999', '2101']) {
      fireEvent.change(screen.getByLabelText('Year (optional)'), { target: { value: year } });
      submit();
    }
    expect(append).not.toHaveBeenCalled();
  });
  it('retains the request before POST and prevents double submissions', async () => {
    const response = deferred<StudentGradesDTO>();
    append.mockReturnValue(response.promise);
    await mount();
    fill('70');
    const form = screen.getByRole('button', { name: 'Save score' }).closest('form')!;
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(append).toHaveBeenCalledTimes(1);
    expect(JSON.parse(storage.get(key)!)).toEqual(append.mock.calls[0][0]);
    expect(screen.getByLabelText('Score out of 100')).toBeDisabled();
    await act(async () => response.resolve(saved(append.mock.calls[0][0])));
  });
  it('recovers a saved attempt after a lost response without another POST', async () => {
    append.mockImplementation(async (data) => {
      read.mockResolvedValue(saved(data));
      throw new Error('lost');
    });
    await mount();
    fill('85');
    submit();
    await screen.findByText('Score saved. Course completion is unchanged.');
    expect(append).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledTimes(1);
  });
  it('retries an absent attempt with identical payload and key while fields remain locked', async () => {
    append.mockRejectedValueOnce(new Error('lost'));
    await mount();
    fill('65');
    submit();
    const retry = await screen.findByRole('button', { name: 'Retry this attempt' });
    expect(screen.getByLabelText('Score out of 100')).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Discard request' })).not.toBeInTheDocument();
    fireEvent.click(retry);
    await screen.findByText('Score saved. Course completion is unchanged.');
    expect(append.mock.calls[1][0]).toEqual(append.mock.calls[0][0]);
  });
  it('blocks further writes when recovery fails and reloads before retrying', async () => {
    append.mockRejectedValueOnce(new Error('lost'));
    read.mockRejectedValueOnce(new Error('offline'));
    await mount();
    fill();
    submit();
    const reload = await screen.findByRole('button', { name: 'Reload saved grades' });
    expect(screen.getByLabelText('Course')).toBeDisabled();
    expect(append).toHaveBeenCalledTimes(1);
    fireEvent.click(reload);
    await screen.findByRole('button', { name: 'Retry this attempt' });
    expect(append).toHaveBeenCalledTimes(1);
  });
  it('restores and reconciles an interrupted request on remount', async () => {
    storage.set(key, JSON.stringify(payload));
    read.mockResolvedValue(saved());
    await mount();
    await screen.findByText('Score saved. Course completion is unchanged.');
    expect(append).not.toHaveBeenCalled();
    expect(storage.has(key)).toBe(false);
  });
  it('keeps an interrupted request when the old account unmounts and ignores its late response', async () => {
    const response = deferred<StudentGradesDTO>();
    append.mockReturnValue(response.promise);
    const { rerender } = await mount();
    fill('88');
    submit();
    const old = append.mock.calls[0][0];
    rerender(<GradeEntry userId="two" onSaved={onSaved} />);
    await act(async () => response.resolve(saved(old)));
    expect(onSaved).not.toHaveBeenCalled();
    expect(JSON.parse(storage.get(key)!)).toEqual(old);
    expect(screen.getByLabelText('Score out of 100')).toHaveValue(null);
  });
  it('blocks a mismatched saved retry key instead of treating it as success', async () => {
    storage.set(key, JSON.stringify(payload));
    read.mockResolvedValue(saved({ ...payload, score: 100 }));
    await mount();
    expect(await screen.findByRole('alert')).toHaveTextContent('different details');
    expect(onSaved).not.toHaveBeenCalled();
    expect(storage.has(key)).toBe(true);
  });
  it('rejects corrupt recovery data without erasing it or submitting', async () => {
    storage.set(key, 'broken');
    await mount();
    expect(screen.getByRole('alert')).toHaveTextContent('Browser recovery data');
    expect(screen.getByLabelText('Course')).toBeDisabled();
    expect(storage.get(key)).toBe('broken');
    expect(append).not.toHaveBeenCalled();
  });
  it('does not send when browser request persistence fails', async () => {
    await mount();
    vi.stubGlobal('sessionStorage', {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota');
      },
    });
    fill();
    submit();
    expect(await screen.findByRole('alert')).toHaveTextContent('No score was submitted');
    expect(append).not.toHaveBeenCalled();
  });
  it('unlocks a definitive validation rejection instead of retaining an ambiguous retry', async () => {
    const error = new AxiosError('bad');
    error.response = {
      status: 400,
      data: {},
      statusText: 'Bad Request',
      headers: {},
      config: { headers: {} },
    } as NonNullable<AxiosError['response']>;
    append.mockRejectedValueOnce(error);
    await mount();
    fill();
    submit();
    await screen.findByText(/The server rejected this attempt/);
    expect(screen.getByLabelText('Course')).toBeEnabled();
    expect(storage.has(key)).toBe(false);
    expect(read).not.toHaveBeenCalled();
  });
  it('offers catalog retry and does not submit while courses are unavailable', async () => {
    catalog.mockRejectedValueOnce(new Error('offline'));
    await mount();
    expect(screen.getByLabelText('Course')).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Reload courses' }));
    await waitFor(() => expect(screen.getByLabelText('Course')).toBeEnabled());
  });
});
