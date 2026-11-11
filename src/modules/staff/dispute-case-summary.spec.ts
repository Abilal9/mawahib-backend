import { describeBusinessDisputeEnd } from './dispute-case-summary';

const opened = new Date('2026-11-11T12:00:00.000Z');
const later = new Date('2026-11-11T12:05:00.000Z');

describe('business dispute summary', () => {
  it('attributes a staff resolution to the audit actor and the closed case', () => {
    const summary = describeBusinessDisputeEnd({
      caseOpenedAt: opened,
      clientId: 'client',
      providerId: 'provider',
      engagementEvents: [
        {
          fromStatus: 'disputed',
          toStatus: 'delivered',
          actorId: null,
          createdAt: later,
        },
      ],
      caseEvents: [
        {
          action: 'returned_for_client_review',
          actorLabel: 'ada@example.com',
          engagementResultingStatus: 'delivered',
          createdAt: later,
        },
      ],
    });
    expect(summary).toMatchObject({
      kind: 'staff_resolution',
      actorLabel: 'ada@example.com',
      toStatus: 'delivered',
      closedThisCase: true,
    });
  });

  it('keeps client acceptance separate from the staff case', () => {
    const summary = describeBusinessDisputeEnd({
      caseOpenedAt: opened,
      clientId: 'client',
      providerId: 'provider',
      engagementEvents: [
        {
          fromStatus: 'disputed',
          toStatus: 'completed',
          actorId: 'client',
          createdAt: later,
        },
      ],
      caseEvents: [],
    });
    expect(summary).toMatchObject({
      kind: 'participant',
      by: 'client',
      toStatus: 'completed',
      closedThisCase: false,
    });
  });

  it('uses neutral wording when the actor is not a participant and there is no resolution audit', () => {
    const summary = describeBusinessDisputeEnd({
      caseOpenedAt: opened,
      clientId: 'client',
      providerId: 'provider',
      engagementEvents: [
        {
          fromStatus: 'disputed',
          toStatus: 'delivered',
          actorId: null,
          createdAt: later,
        },
      ],
      caseEvents: [{ action: 'note_added', actorLabel: 'ada@example.com', engagementResultingStatus: null, createdAt: later }],
    });
    expect(summary).toMatchObject({
      kind: 'unknown',
      actorLabel: null,
      by: null,
      toStatus: 'delivered',
      closedThisCase: false,
    });
  });
});
