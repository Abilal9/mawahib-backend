import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AdminReadService } from './admin-read.service';
import { jobWhere, parseEnumList, parseIncludeDeleted } from './admin-read.query';

const JOB_ID = '11111111-1111-4111-8111-111111111111';

describe('marketplace staff reads', () => {
  function service(prisma: Record<string, unknown>) {
    return new AdminReadService(prisma as never);
  }

  it('hides deleted jobs unless includeDeleted is true and counts the full match', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const count = jest.fn().mockResolvedValueOnce(2).mockResolvedValueOnce(9);
    const admin = service({ jobListing: { findMany, count, findUnique: jest.fn() } });

    const page = await admin.listJobs({ q: 'design', status: 'open,closed' });

    expect(page).toEqual({ items: [], nextCursor: null, total: 9, matchCount: 2 });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          deletedAt: null,
          status: { in: ['open', 'closed'] },
        }),
        take: 21,
      }),
    );
    const selected = findMany.mock.calls[0][0].select as Record<string, unknown>;
    expect(selected).not.toHaveProperty('description');
    expect(selected).not.toHaveProperty('salaryLabel');
    expect(selected).not.toHaveProperty('skills');
  });

  it('includes deleted rows only for the explicit filter', () => {
    expect(jobWhere({
      limit: 20,
      cursor: null,
      q: null,
      includeDeleted: true,
      status: null,
      employmentType: null,
    })).toEqual({});
    expect(() => parseIncludeDeleted('maybe')).toThrow(BadRequestException);
  });

  it('rejects an unknown status and a blank status item', () => {
    expect(() => parseEnumList('open,nope', ['open', 'closed'], 'job status')).toThrow(
      BadRequestException,
    );
    expect(() => parseEnumList('open,', ['open', 'closed'], 'job status')).toThrow(
      BadRequestException,
    );
  });

  it('counts every non-deleted job and engagement for the overview', async () => {
    const jobCount = jest.fn().mockResolvedValue(6);
    const engagementCount = jest.fn().mockResolvedValue(4);
    const admin = service({
      jobListing: { count: jobCount },
      workEngagement: { count: engagementCount },
    });
    await expect(admin.marketplaceSummary()).resolves.toEqual({
      totalJobs: 6,
      totalEngagements: 4,
    });
    expect(jobCount).toHaveBeenCalledWith({ where: { deletedAt: null } });
    expect(engagementCount).toHaveBeenCalledWith({ where: { deletedAt: null } });
  });

  it('returns 404 when a job is missing', async () => {
    const admin = service({
      jobListing: { findUnique: jest.fn().mockResolvedValue(null) },
    });
    await expect(admin.jobDetail(JOB_ID)).rejects.toBeInstanceOf(NotFoundException);
  });
});
