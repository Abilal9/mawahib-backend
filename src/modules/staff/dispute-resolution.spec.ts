import { BadRequestException } from '@nestjs/common';
import { WorkEngagementStatus } from '@prisma/client';
import { assertEngagementPartyTransition, assertEngagementTransition } from '../marketplace/state-machines';
import { resolutionOptions, resolutionRefusal } from './dispute-resolution';

const ready = {
  caseStatus: 'open' as const,
  isLatest: true,
  engagementStatus: 'disputed',
  engagementDeleted: false,
  openedFromStatus: 'delivered',
  hasDelivery: true,
  hasSucceededPayment: true,
};

describe('dispute resolution rules', () => {
  it('allows the staff transition and keeps it off the participant actions', () => {
    expect(() => assertEngagementTransition(WorkEngagementStatus.disputed, WorkEngagementStatus.delivered)).not.toThrow();
    expect(() => assertEngagementTransition(WorkEngagementStatus.disputed, WorkEngagementStatus.in_progress)).not.toThrow();
    expect(() => assertEngagementPartyTransition(
      WorkEngagementStatus.disputed,
      WorkEngagementStatus.delivered,
      true,
      false,
    )).toThrow(BadRequestException);
    expect(() => assertEngagementPartyTransition(
      WorkEngagementStatus.disputed,
      WorkEngagementStatus.in_progress,
      false,
      true,
    )).toThrow(BadRequestException);
  });

  it('explains when a business resolution is unavailable', () => {
    expect(resolutionOptions(ready).return_to_client_review.available).toBe(true);
    expect(resolutionOptions(ready).further_work.available).toBe(true);
    expect(resolutionOptions(ready).follow_up.available).toBe(true);
    expect(resolutionOptions({ ...ready, hasDelivery: false }).return_to_client_review.reason).toMatch(/delivery/);
    expect(resolutionOptions({ ...ready, hasSucceededPayment: false }).further_work.reason).toMatch(/payment/);
    expect(resolutionRefusal({ ...ready, isLatest: false }, 'return_to_client_review')?.code).toBe('DISPUTE_CASE_NOT_LATEST');
    expect(resolutionRefusal({ ...ready, engagementStatus: 'completed' }, 'follow_up')?.code).toBe('ENGAGEMENT_CHANGED');
    expect(resolutionOptions({ ...ready, caseStatus: 'closed' }).follow_up.reason).toMatch(/Reopening/);
  });
});
