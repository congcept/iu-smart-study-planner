import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  OwnStudyPlanMetadataDTO,
  OwnStudyPlanSemesterMetadataDTO,
  OwnStudyPlanSemestersDTO,
  OwnStudyPlansDTO,
} from '@iu-study-planner/shared';
import { listSavedStudyPlans } from '@/lib/savedStudyPlansApi';
import { listSavedStudyPlanSemesters } from '@/lib/savedStudyPlanSemestersApi';
import { getSavedStudyPlanCourses } from '@/lib/savedStudyPlanCoursesApi';
import { ownerId } from '@/test/fixtures/curriculumReference';
import {
  savedCourseFixture,
  savedPlanId,
  savedSemesterId,
} from '@/test/fixtures/savedStudyPlanCourses';
import { SavedStudyPlansPanel } from '../SavedStudyPlansPanel';

vi.mock('@/lib/savedStudyPlansApi', async (original) => ({
  ...(await original<typeof import('@/lib/savedStudyPlansApi')>()),
  listSavedStudyPlans: vi.fn(),
}));
vi.mock('@/lib/savedStudyPlanSemestersApi', async (original) => ({
  ...(await original<typeof import('@/lib/savedStudyPlanSemestersApi')>()),
  listSavedStudyPlanSemesters: vi.fn(),
}));
vi.mock('@/lib/savedStudyPlanCoursesApi', async (original) => ({
  ...(await original<typeof import('@/lib/savedStudyPlanCoursesApi')>()),
  getSavedStudyPlanCourses: vi.fn(),
}));
vi.mock('../SavedReferenceSelectionEditor', () => ({
  SavedReferenceSelectionEditor: () => <p>Saved selection editor</p>,
}));
vi.mock('../SavedSemesterReferenceReview', () => ({
  SavedSemesterReferenceReview: () => <p>Saved semester review</p>,
}));

const readPlans = vi.mocked(listSavedStudyPlans);
const readSemesters = vi.mocked(listSavedStudyPlanSemesters);
const readCourses = vi.mocked(getSavedStudyPlanCourses);
const planHeading = () => screen.getByRole('heading', { name: 'Your saved study plans' });
const semesterHeading = () => screen.getByRole('heading', { name: 'Saved plan semester references' });
const coursesHeading = () => screen.getByRole('heading', { name: 'Saved semester course references' });
const viewSemesters = () =>
  screen.findByRole('button', { name: /View semesters for Saved reference/ });
const viewCourses = () => screen.findByRole('button', { name: /View courses for Fall 2026/ });

const metadata: OwnStudyPlanMetadataDTO = {
  id: savedPlanId,
  name: 'Saved reference',
  description: null,
  isActive: false,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  semesterCount: 1,
};
const semester: OwnStudyPlanSemesterMetadataDTO = {
  id: savedSemesterId,
  semester: 'FALL',
  year: 2026,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  storedTotalCredits: 9,
};
function planPage(): OwnStudyPlansDTO {
  return {
    visibility: 'CURRENT_ACCOUNT_ONLY',
    order: 'STORED_NEWEST_FIRST',
    scope: { userId: ownerId, curriculumId: null, studyPlansValidated: false },
    pageSize: 5,
    after: null,
    plans: [metadata],
    nextAfter: null,
  };
}
function semesterPage(): OwnStudyPlanSemestersDTO {
  return {
    visibility: 'CURRENT_ACCOUNT_ONLY',
    order: 'STORED_NEWEST_FIRST',
    scope: { userId: ownerId, curriculumId: null, studyPlansValidated: false },
    plan: metadata,
    pageSize: 5,
    after: null,
    semesters: [semester],
    nextAfter: null,
  };
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  readPlans.mockResolvedValue(planPage());
  readSemesters.mockResolvedValue(semesterPage());
  readCourses.mockResolvedValue(savedCourseFixture());
});
afterEach(() => {
  vi.restoreAllMocks();
  cleanup();
});

describe('saved planner navigation focus', () => {
  it('moves focus to each new view heading and restores it through explicit Back', async () => {
    render(<SavedStudyPlansPanel ownerId={ownerId} />);

    fireEvent.click(await viewSemesters());
    expect(semesterHeading()).toHaveFocus();

    fireEvent.click(await viewCourses());
    expect(coursesHeading()).toHaveFocus();

    fireEvent.click(screen.getByRole('button', { name: 'Back to saved semesters' }));
    expect(semesterHeading()).toHaveFocus();

    fireEvent.click(screen.getByRole('button', { name: 'Back to saved plans' }));
    expect(planHeading()).toHaveFocus();
  });

  it('leaves focus alone during ordinary list, semester and course reads', async () => {
    render(
      <>
        <button>Outside planner</button>
        <SavedStudyPlansPanel ownerId={ownerId} />
      </>,
    );
    const outside = screen.getByRole('button', { name: 'Outside planner' });

    await viewSemesters();
    outside.focus();
    fireEvent.click(screen.getByRole('button', { name: 'Reload saved plans' }));
    await viewSemesters();
    expect(outside).toHaveFocus();

    fireEvent.click(screen.getByRole('button', { name: /View semesters for Saved reference/ }));
    expect(semesterHeading()).toHaveFocus();
    outside.focus();
    fireEvent.click(screen.getByRole('button', { name: 'Reload saved semesters' }));
    await viewCourses();
    expect(outside).toHaveFocus();

    fireEvent.click(screen.getByRole('button', { name: /View courses for Fall 2026/ }));
    expect(coursesHeading()).toHaveFocus();
    outside.focus();
    fireEvent.click(screen.getByRole('button', { name: 'Reload saved courses' }));
    await screen.findByRole('button', { name: 'Reload saved courses' });
    expect(outside).toHaveFocus();
  });
});

const backgroundRefreshes: Array<[string, () => void]> = [
  ['window focus', () => fireEvent(window, new Event('focus'))],
  ['visibilitychange to visible', () => fireEvent(document, new Event('visibilitychange'))],
];

describe.each(backgroundRefreshes)('saved planner background %s', (_label, refresh) => {
  it('does not steal focus when it drops the selected semester view', async () => {
    render(
      <>
        <button>Outside planner</button>
        <SavedStudyPlansPanel ownerId={ownerId} />
      </>,
    );
    const outside = screen.getByRole('button', { name: 'Outside planner' });

    fireEvent.click(await viewSemesters());
    expect(semesterHeading()).toHaveFocus();

    outside.focus();
    refresh();
    expect(screen.queryByRole('heading', { name: 'Saved plan semester references' })).toBeNull();
    await viewSemesters();
    expect(outside).toHaveFocus();
  });

  it('does not steal focus when it drops the selected course view', async () => {
    render(
      <>
        <button>Outside planner</button>
        <SavedStudyPlansPanel ownerId={ownerId} />
      </>,
    );
    const outside = screen.getByRole('button', { name: 'Outside planner' });

    fireEvent.click(await viewSemesters());
    fireEvent.click(await viewCourses());
    expect(coursesHeading()).toHaveFocus();

    outside.focus();
    refresh();
    expect(screen.queryByRole('heading', { name: 'Saved semester course references' })).toBeNull();
    await viewSemesters();
    expect(outside).toHaveFocus();
  });
});
