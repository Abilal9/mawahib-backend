import { planServiceJobBackfill } from './service-job-backfill';

const design = { id: 'design', nameEn: 'Design', isActive: true };
const skills = [
  ['UI Design', 'ui'],
  ['Art Direction', 'art'],
  ['Branding', 'branding'],
  ['Figma', 'figma'],
  ['After Effects', 'ae'],
  ['Campaign Design', 'campaign'],
  ['Design Systems', 'systems'],
  ['Illustration', 'illustration'],
  ['Prototyping', 'proto'],
].map(([nameEn, id]) => ({
  id,
  nameEn,
  isActive: true,
  categoryActive: true,
}));

describe('service and job taxonomy backfill', () => {
  const jobs = [
    {
      id: 'design-job',
      deletedAt: null,
      categoryId: null,
      exploreTag: 'Design',
      skills: ['Branding', 'Packaging', 'Figma', 'Branding'],
      linkedSkillCount: 0,
    },
    {
      id: 'tech-job',
      deletedAt: null,
      categoryId: null,
      exploreTag: 'Tech',
      skills: ['UI Design', 'Web'],
      linkedSkillCount: 0,
    },
    {
      id: 'food-job',
      deletedAt: null,
      categoryId: null,
      exploreTag: 'Food',
      skills: ['Illustration', 'Food'],
      linkedSkillCount: 0,
    },
    {
      id: 'already',
      deletedAt: null,
      categoryId: 'design',
      exploreTag: 'Design',
      skills: ['Figma'],
      linkedSkillCount: 1,
    },
  ];

  it('maps only the exact Design tag and allow-listed skill names', () => {
    const plan = planServiceJobBackfill({
      jobs,
      categories: [design, { id: 'food', nameEn: 'Food', isActive: true }],
      skills,
    });
    expect(plan.serviceCategoryUpdates).toBe(0);
    expect(plan.serviceSkillLinks).toBe(0);
    expect(plan.categoryUpdates).toEqual([
      { listingId: 'design-job', categoryId: 'design' },
    ]);
    expect(plan.skillLinks).toEqual([
      { listingId: 'design-job', skillId: 'branding', position: 0 },
      { listingId: 'design-job', skillId: 'figma', position: 1 },
      { listingId: 'tech-job', skillId: 'ui', position: 0 },
      { listingId: 'food-job', skillId: 'illustration', position: 0 },
    ]);
    expect(plan.skippedSkillTokens.map((row) => row.token)).toEqual([
      'Packaging',
      'Web',
      'Food',
    ]);
  });

  it('does nothing on a second run once links exist', () => {
    const first = planServiceJobBackfill({
      jobs,
      categories: [design],
      skills,
    });
    const second = planServiceJobBackfill({
      jobs: jobs.map((job) => ({
        ...job,
        categoryId:
          first.categoryUpdates.find((row) => row.listingId === job.id)
            ?.categoryId ?? job.categoryId,
        linkedSkillCount:
          job.linkedSkillCount +
          first.skillLinks.filter((row) => row.listingId === job.id).length,
      })),
      categories: [design],
      skills,
    });
    expect(second.categoryUpdates).toEqual([]);
    expect(second.skillLinks).toEqual([]);
  });

  it('skips a category map when Design is not a single active category', () => {
    const plan = planServiceJobBackfill({
      jobs,
      categories: [],
      skills,
    });
    expect(plan.categoryUpdates).toEqual([]);
    expect(plan.skillLinks.length).toBeGreaterThan(0);
  });
});
