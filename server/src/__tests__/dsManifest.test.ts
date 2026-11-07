import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { verifyCurriculumManifest } from '../services/curriculumManifest';

const read = (name: string) =>
  JSON.parse(readFileSync(resolve(__dirname, '../../../docs/phase-1', name), 'utf8')) as unknown;

/**
 * The committed DS manifest is a transcription of the signed 2025 document. These cases keep the
 * transcription honest: the arithmetic is checked here rather than trusted, and the document's own
 * defects stay visible instead of being quietly repaired in the file.
 */
describe('DS 2025 committed manifest', () => {
  it('transcribes the document faithfully, including the code it prints wrongly', () => {
    const report = verifyCurriculumManifest(read('ds-2025-manifest.json'));
    expect(report.readiness).toBe(false);
    // The document prints T149IU where it means IT149IU, which is not a valid IU code.
    expect(report.issues).toHaveLength(1);
    expect(report.issues[0]).toMatchObject({ category: 'SOURCE' });
    expect(report.issues[0].path).toBe('prerequisites.2.prerequisite');
    expect(report.issues[0].message).toMatch(/published IU form/);
  });

  it('becomes self-consistent once the two codes the document contradicts are read as intended', () => {
    const report = verifyCurriculumManifest(read('ds-2025-manifest-proposed-readings.json'));
    expect(report.blockers).toEqual([]);
    expect(report.readiness).toBe(true);
    expect(report.credits).toEqual({ declared: 124, blocks: 124, required: 113, elective: 11 });
    expect(report.counts).toEqual({
      blocks: 4,
      courses: 50,
      placements: 50,
      electiveGroups: 1,
      requirements: 1,
      prerequisites: 32,
      excluded: 2,
    });
    expect(report.program).toEqual({ code: 'DS', cohort: 'K2025' });
    expect(report.source?.sha256).toBe(
      'e911cb8a6efb80b7636127fcc030f86895c638b30f742ee73692525ce502ddc7',
    );
  });

  it('splits the 11 elective credits as a 7-credit pool plus a 4-credit free elective', () => {
    const manifest = read('ds-2025-manifest-proposed-readings.json') as {
      blocks: { electiveCredits: number }[];
      placements: { group: string | null; selectCredits: number | null }[];
      requirements: { credits: number }[];
    };
    const allocation = manifest.blocks.reduce((total, block) => total + block.electiveCredits, 0);
    const pool = new Set(
      manifest.placements
        .filter(({ group }) => group !== null)
        .map(({ selectCredits }) => selectCredits),
    );
    const requirement = manifest.requirements.reduce((total, { credits }) => total + credits, 0);
    expect(allocation).toBe(11);
    expect([...pool]).toEqual([7]);
    expect(requirement).toBe(4);
  });

  it('never counts physical training toward the credit total', () => {
    const manifest = read('ds-2025-manifest-proposed-readings.json') as {
      excluded: { code: string | null }[];
      blocks: { requiredCourses: string[] }[];
    };
    const excluded = manifest.excluded.map(({ code }) => code);
    expect(excluded).toEqual(['PT001IU', 'PT002IU']);
    const required = new Set(manifest.blocks.flatMap(({ requiredCourses }) => requiredCourses));
    for (const code of excluded) expect(required.has(code!)).toBe(false);
  });
});
