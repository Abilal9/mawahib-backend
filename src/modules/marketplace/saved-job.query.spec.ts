import { JobListingStatus } from '@prisma/client';
import { canSaveJob, savedJobWhere } from './saved-job.query';

const base = {
  deletedAt: null,
  posterDeletedAt: null,
  posterId: 'poster',
  viewerId: 'viewer',
  hasLiveApplication: false,
};

describe('saved job visibility', () => {
  it('allows open listings for any viewer', () => {
    expect(canSaveJob({ ...base, status: JobListingStatus.open })).toBe(true);
  });

  it.each([JobListingStatus.draft, JobListingStatus.archived])(
    'rejects %s even for the owner',
    (status) => {
      expect(
        canSaveJob({
          ...base,
          status,
          posterId: 'viewer',
          viewerId: 'viewer',
        }),
      ).toBe(false);
    },
  );

  it.each([
    JobListingStatus.closed,
    JobListingStatus.in_progress,
    JobListingStatus.completed,
    JobListingStatus.expired,
  ])('allows %s for the poster or a live applicant only', (status) => {
    expect(canSaveJob({ ...base, status, posterId: 'viewer', viewerId: 'viewer' })).toBe(
      true,
    );
    expect(
      canSaveJob({ ...base, status, hasLiveApplication: true }),
    ).toBe(true);
    expect(canSaveJob({ ...base, status })).toBe(false);
  });

  it('rejects a soft-deleted listing or poster', () => {
    expect(
      canSaveJob({
        ...base,
        status: JobListingStatus.open,
        deletedAt: new Date(),
      }),
    ).toBe(false);
    expect(
      canSaveJob({
        ...base,
        status: JobListingStatus.open,
        posterDeletedAt: new Date(),
      }),
    ).toBe(false);
  });

  it('puts applicant access and the keyset in the paged query', () => {
    const where = savedJobWhere('viewer', {
      createdAt: '2026-05-01T00:00:00.000Z',
      id: 'job-b',
    });
    expect(where.userId).toBe('viewer');
    expect(where.job).toMatchObject({
      deletedAt: null,
      poster: { deletedAt: null },
    });
    const job = where.job as {
      OR: Array<{
        status?: JobListingStatus | { in: JobListingStatus[] };
        OR?: unknown[];
      }>;
    };
    expect(job.OR[0]).toEqual({ status: JobListingStatus.open });
    expect(job.OR[1]).toMatchObject({
      OR: [
        { posterId: 'viewer' },
        { applications: { some: { applicantId: 'viewer', deletedAt: null } } },
      ],
    });
    expect(JSON.stringify(job.OR)).not.toContain('draft');
    expect(JSON.stringify(job.OR)).not.toContain('archived');
    expect(where.OR?.[1]).toMatchObject({ jobId: { lt: 'job-b' } });
  });
});
