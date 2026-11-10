import { BadRequestException } from '@nestjs/common';
import {
  disputeCaseListQuery,
  disputeCaseWhere,
  parseAssignmentBody,
  parseNoteBody,
  parseStatusBody,
} from './dispute-case.query';

const ME = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';

function parsed(query: Record<string, unknown> = {}) {
  return disputeCaseListQuery(query, ME);
}

describe('dispute case queries', () => {
  it('rejects empty, duplicate, unknown, and array filters', () => {
    expect(() => parsed({ status: 'open,' })).toThrow(BadRequestException);
    expect(() => parsed({ status: 'open,open' })).toThrow(BadRequestException);
    expect(() => parsed({ assignment: 'team' })).toThrow(BadRequestException);
    expect(() => parsed({ status: ['open'] })).toThrow(BadRequestException);
    expect(() => parsed({ limit: 0 })).toThrow(BadRequestException);
    expect(() => parsed({ limit: 21 })).toThrow(BadRequestException);
    expect(() => parsed({ cursor: '%%%' })).toThrow(BadRequestException);
  });

  it('combines filter groups and keeps assignment meanings distinct', () => {
    const where = disputeCaseWhere(parsed({
      status: 'open,in_review',
      assignment: 'unassigned,others',
      engagementState: 'disputed',
      q: OTHER,
    }));
    expect(where).toEqual({
      AND: [
        {
          OR: [
            { engagement: { title: { contains: OTHER, mode: 'insensitive' } } },
            { engagement: { client: { displayName: { contains: OTHER, mode: 'insensitive' } } } },
            { engagement: { provider: { displayName: { contains: OTHER, mode: 'insensitive' } } } },
            { engagement: { invoices: { some: { invoiceNumber: { equals: OTHER, mode: 'insensitive' } } } } },
            { id: OTHER },
            { engagementId: OTHER },
            { engagement: { clientId: OTHER } },
            { engagement: { providerId: OTHER } },
            { engagement: { payments: { some: { id: OTHER } } } },
          ],
        },
        { status: { in: ['open', 'in_review'] } },
        {
          OR: [
            { assigneeStaffMemberId: null },
            { AND: [{ assigneeStaffMemberId: { not: null } }, { NOT: { assigneeStaffMemberId: ME } }] },
          ],
        },
        { OR: [{ isLatest: true, engagement: { status: 'disputed' } }] },
      ],
    });
  });

  it('requires a close outcome only when closing, and a request key', () => {
    const key = 'idem-key-12345678';
    expect(parseStatusBody({ action: 'close', outcome: 'other', note: 'Done', expectedRevision: 1, idempotencyKey: key })).toMatchObject({
      action: 'close',
      outcome: 'other',
    });
    expect(() => parseStatusBody({ action: 'start_review', outcome: 'other', note: 'Now', expectedRevision: 0, idempotencyKey: key })).toThrow(BadRequestException);
    expect(() => parseStatusBody({ action: 'close', note: 'Done', expectedRevision: 0, idempotencyKey: key })).toThrow(BadRequestException);
    expect(() => parseNoteBody({ body: '  ', idempotencyKey: key })).toThrow(BadRequestException);
    expect(() => parseAssignmentBody({ assigneeStaffMemberId: 'nope', note: 'Move', expectedRevision: 0, idempotencyKey: key })).toThrow(BadRequestException);
    expect(parseAssignmentBody({ assigneeStaffMemberId: null, note: 'Clear', expectedRevision: 2, idempotencyKey: key }).assigneeStaffMemberId).toBeNull();
  });
});
