import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AxiosError, AxiosHeaders } from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  AdminStudentsPageDTO,
  AdminStudentSummaryDTO,
  AuthUserDTO,
  CurriculumSummaryDTO,
} from '@iu-study-planner/shared';
import { getSession } from '@/lib/api';
import { getCurriculumReferences } from '@/lib/curriculumApi';
import { assignReferenceCurriculum, listAssignableStudents } from '@/lib/adminUsersApi';
import { ReferenceAssignmentPanel } from '../ReferenceAssignmentPanel';

vi.mock('@/lib/api', () => ({ getSession: vi.fn() }));
vi.mock('@/lib/curriculumApi', () => ({ getCurriculumReferences: vi.fn() }));
vi.mock('@/lib/adminUsersApi', () => ({
  listAssignableStudents: vi.fn(),
  assignReferenceCurriculum: vi.fn(),
}));

const adminId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const studentA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const studentB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const curriculumA = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const curriculumB = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

const session = (id = adminId): AuthUserDTO => ({
  id,
  studentId: 'ADMIN',
  name: 'Admin',
  email: 'admin@example.test',
  role: 'ADMIN',
  curriculumId: null,
});

const references: CurriculumSummaryDTO[] = [
  {
    id: curriculumA,
    code: 'CS',
    name: 'Computer Science',
    school: 'CSE',
    degree: 'Bachelor',
    programUrl: 'https://example.test/cs',
    totalCredits: null,
    isGpaPath: false,
    sourceLabel: null,
    sourceUrl: null,
    usage: 'REFERENCE_ONLY',
  },
  {
    id: curriculumB,
    code: 'IT',
    name: 'Information Technology',
    school: 'CSE',
    degree: 'Bachelor',
    programUrl: 'https://example.test/it',
    totalCredits: null,
    isGpaPath: false,
    sourceLabel: null,
    sourceUrl: null,
    usage: 'REFERENCE_ONLY',
  },
];

const student = (changes: Partial<AdminStudentSummaryDTO> = {}): AdminStudentSummaryDTO => ({
  id: studentA,
  studentId: 'REF-001',
  name: 'Reference Student',
  email: 'ref-001@example.test',
  curriculumId: null,
  curriculum: null,
  ...changes,
});

const page = (
  students: AdminStudentSummaryDTO[],
  nextAfter: string | null = null,
  after: string | null = null,
): AdminStudentsPageDTO => ({
  usage: 'REFERENCE_ONLY',
  pageSize: 50,
  after,
  students,
  nextAfter,
});

const conflictish = (status: number) =>
  new AxiosError('failed', 'ERR_BAD_REQUEST', undefined, undefined, {
    status,
    statusText: 'Failed',
    data: { success: false, error: 'failed' },
    headers: {},
    config: { headers: new AxiosHeaders() },
  });
const conflict = () => conflictish(409);

const renderPanel = async (userId = adminId) => {
  const view = render(<ReferenceAssignmentPanel userId={userId} />);
  await screen.findByLabelText('Student account');
  return view;
};

beforeEach(() => {
  vi.mocked(getSession).mockReset();
  vi.mocked(getCurriculumReferences).mockReset();
  vi.mocked(listAssignableStudents).mockReset();
  vi.mocked(getSession).mockResolvedValue(session());
  vi.mocked(getCurriculumReferences).mockResolvedValue(references);
  vi.mocked(listAssignableStudents).mockResolvedValue(page([student()]));
  vi.mocked(assignReferenceCurriculum).mockReset();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('reference curriculum assignment panel', () => {
  it('reads accounts and references without writing anything on mount', async () => {
    await renderPanel();
    expect(listAssignableStudents).toHaveBeenCalledWith(undefined);
    expect(getCurriculumReferences).toHaveBeenCalledTimes(1);
    expect(assignReferenceCurriculum).not.toHaveBeenCalled();
    expect(
      screen.getByRole('option', { name: /REF-001 · Reference Student · no assignment/ }),
    ).toBeTruthy();
    expect(screen.getByRole('option', { name: 'No assignment' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'CS · Computer Science' })).toBeTruthy();
  });

  it('prefills the current assignment and only offers a save once the choice differs', async () => {
    vi.mocked(listAssignableStudents).mockResolvedValue(
      page([
        student({
          curriculumId: curriculumA,
          curriculum: { id: curriculumA, code: 'CS', name: 'Computer Science' },
        }),
      ]),
    );
    await renderPanel();
    fireEvent.change(screen.getByLabelText('Student account'), { target: { value: studentA } });
    const save = screen.getByRole('button', {
      name: 'Attach reference curriculum',
    }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Reference curriculum'), {
      target: { value: curriculumB },
    });
    expect(save.disabled).toBe(false);
    expect(assignReferenceCurriculum).not.toHaveBeenCalled();
  });

  it('attaches a reference curriculum and confirms the administrator session after the reply', async () => {
    vi.mocked(assignReferenceCurriculum).mockResolvedValue({
      userId: studentA,
      curriculumId: curriculumA,
      usage: 'REFERENCE_ONLY',
      changed: true,
    });
    await renderPanel();
    fireEvent.change(screen.getByLabelText('Student account'), { target: { value: studentA } });
    fireEvent.change(screen.getByLabelText('Reference curriculum'), {
      target: { value: curriculumA },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Attach reference curriculum' }));

    await screen.findByText('The reference curriculum was attached to this account.');
    expect(assignReferenceCurriculum).toHaveBeenCalledWith(studentA, {
      curriculumId: curriculumA,
      expectedCurriculumId: null,
    });
    // Two reads at mount, then the pre-write and post-write confirmations.
    expect(getSession).toHaveBeenCalledTimes(4);
    expect(screen.getByRole('option', { name: /REF-001 · Reference Student · CS/ })).toBeTruthy();
  });

  it('removes an assignment by sending an explicit null', async () => {
    vi.mocked(listAssignableStudents).mockResolvedValue(
      page([
        student({
          curriculumId: curriculumA,
          curriculum: { id: curriculumA, code: 'CS', name: 'Computer Science' },
        }),
      ]),
    );
    vi.mocked(assignReferenceCurriculum).mockResolvedValue({
      userId: studentA,
      curriculumId: null,
      usage: 'REFERENCE_ONLY',
      changed: true,
    });
    await renderPanel();
    fireEvent.change(screen.getByLabelText('Student account'), { target: { value: studentA } });
    fireEvent.change(screen.getByLabelText('Reference curriculum'), {
      target: { value: '' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Remove assignment' }));

    await screen.findByText('The reference curriculum was removed from this account.');
    expect(assignReferenceCurriculum).toHaveBeenCalledWith(studentA, {
      curriculumId: null,
      expectedCurriculumId: curriculumA,
    });
  });

  it('keeps the unconfirmed request visible when the account changed underneath it', async () => {
    vi.mocked(assignReferenceCurriculum).mockRejectedValue(conflict());
    await renderPanel();
    fireEvent.change(screen.getByLabelText('Student account'), { target: { value: studentA } });
    fireEvent.change(screen.getByLabelText('Reference curriculum'), {
      target: { value: curriculumB },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Attach reference curriculum' }));

    await screen.findByText(/This account changed since the list was read/);
    expect(screen.getByText(/The unconfirmed request targets IT\./)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Attach reference curriculum' })).toBeTruthy();
    expect(getSession).toHaveBeenCalledTimes(4);
  });

  it('hides every student row when the administrator session is no longer valid', async () => {
    vi.mocked(assignReferenceCurriculum).mockRejectedValue(conflict());
    await renderPanel();
    fireEvent.change(screen.getByLabelText('Student account'), { target: { value: studentA } });
    fireEvent.change(screen.getByLabelText('Reference curriculum'), {
      target: { value: curriculumB },
    });
    vi.mocked(getSession).mockRejectedValue(conflictish(401));
    fireEvent.click(screen.getByRole('button', { name: 'Attach reference curriculum' }));

    await screen.findByText(/Your admin session changed/);
    expect(screen.queryByLabelText('Student account')).toBeNull();
  });

  it('does not publish rows when the session cannot be confirmed after the read', async () => {
    let resolvePage: (value: AdminStudentsPageDTO) => void = () => {};
    vi.mocked(listAssignableStudents).mockImplementationOnce(
      () => new Promise((resolve) => (resolvePage = resolve)),
    );
    render(<ReferenceAssignmentPanel userId={adminId} />);
    await waitFor(() => expect(getSession).toHaveBeenCalledTimes(1));
    vi.mocked(getSession).mockRejectedValue(conflictish(401));
    await act(async () => {
      resolvePage(page([student({ studentId: 'STALE-999', name: 'Unconfirmed row' })]));
    });
    await screen.findByText(/Your admin session changed/);
    expect(screen.queryByText(/STALE-999/)).toBeNull();
    expect(screen.queryByLabelText('Student account')).toBeNull();
  });

  it('loads the next page of student accounts with its continuation', async () => {
    vi.mocked(listAssignableStudents).mockImplementation(async (after?: string) =>
      after === undefined
        ? page([student()], 'REF-001')
        : page(
            [student({ id: studentB, studentId: 'REF-002', name: 'Second Student' })],
            null,
            'REF-001',
          ),
    );
    await renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Load more student accounts' }));
    await screen.findByRole('option', { name: /REF-002 · Second Student/ });
    expect(listAssignableStudents).toHaveBeenLastCalledWith('REF-001');
  });
});
