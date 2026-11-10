import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { toEngagementDetail } from './admin-read.mapper';
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

  it('keeps each payment with its own invoice and does not expose provider secrets', () => {
    const detail = toEngagementDetail({
      id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      title: 'Brand work',
      status: 'completed',
      source: 'direct',
      client: { id: 'c', displayName: 'Client', deletedAt: null },
      provider: { id: 'p', displayName: 'Provider', deletedAt: null },
      listingId: null,
      applicationId: null,
      serviceOfferingId: null,
      createdAt: new Date('2026-01-02T00:00:00.000Z'),
      updatedAt: new Date('2026-01-03T00:00:00.000Z'),
      completedAt: new Date('2026-01-03T00:00:00.000Z'),
      deletedAt: null,
      dueAt: null,
      reviewWindowClosesAt: null,
      listing: null,
      serviceOffering: null,
      payments: [
        {
          id: 'pay-2',
          amount: '10.00',
          currency: 'SAR',
          status: 'failed',
          provider: 'mock',
          createdAt: new Date('2026-02-02T00:00:00.000Z'),
          invoice: null,
        },
        {
          id: 'pay-1',
          amount: '80.00',
          currency: 'SAR',
          status: 'succeeded',
          provider: 'mock',
          createdAt: new Date('2026-02-01T00:00:00.000Z'),
          invoice: {
            id: 'inv-1',
            invoiceNumber: 'MWH-2026-000001',
            status: 'generated',
            currency: 'SAR',
            total: '80.00',
            provider: 'mock',
            issuedAt: new Date('2026-02-01T00:00:00.000Z'),
            documentMediaAssetId: 'asset-1',
          },
        },
      ],
    });
    expect(detail.payments.map((item) => item.id)).toEqual(['pay-2', 'pay-1']);
    expect(detail.payments[0].invoice).toBeNull();
    expect(detail.payments[1].invoice).toMatchObject({
      invoiceNumber: 'MWH-2026-000001',
      amount: '80.00',
      simulated: true,
      hasDocument: true,
    });
    expect(JSON.stringify(detail)).not.toContain('providerReference');
    expect(JSON.stringify(detail)).not.toContain('asset-1');
  });

  it('does not issue a document url until a generated file exists', async () => {
    const admin = service({
      invoice: {
        findUnique: jest.fn().mockResolvedValue({
          status: 'pending',
          invoiceNumber: 'MWH-2026-000002',
          originalFileName: null,
          documentMediaAssetId: null,
        }),
      },
    });
    await expect(admin.invoiceDocument(JOB_ID)).rejects.toBeInstanceOf(ConflictException);
  });

  it('returns 404 when a job is missing', async () => {
    const admin = service({
      jobListing: { findUnique: jest.fn().mockResolvedValue(null) },
    });
    await expect(admin.jobDetail(JOB_ID)).rejects.toBeInstanceOf(NotFoundException);
  });
});
