import { PaymentProviderKind, type PaymentStatus, type WorkEngagementStatus } from '@prisma/client';

export type DisputeEventRow = {
  id: string;
  note: string;
  createdAt: Date;
  toStatus: WorkEngagementStatus | string;
};

export type PaymentSummaryRow = {
  amount: { toFixed(digits: number): string } | string;
  currency: string;
  status: PaymentStatus | string;
  provider: PaymentProviderKind | string;
  createdAt?: Date;
  id?: string;
};

export type StaffUserSummary = {
  id: string;
  email: string;
  username: string;
  displayName: string;
  accountType: string;
  accountStatus: string;
  createdAt: string;
  deletedAt: string | null;
};

export type StaffUserDetail = StaffUserSummary & {
  followersCount: number;
  followingCount: number;
  postsCount: number;
  clientEngagementCount: number;
  providerEngagementCount: number;
  simulatedPaymentCount: number;
  statusAction: 'suspend' | 'restore' | 'deleted' | 'ineligible';
};

export type StaffDisputePayment = {
  amount: string;
  currency: string;
  status: string;
  simulated: boolean;
};

export type StaffDispute = {
  id: string;
  title: string;
  status: 'disputed';
  updatedAt: string;
  deletedAt: string | null;
  clientDisplayName: string | null;
  providerDisplayName: string | null;
  disputeEventId: string | null;
  disputeAt: string | null;
  disputeNote: string | null;
  payment: StaffDisputePayment | null;
};

export function selectDisputeEvent(events: DisputeEventRow[]): DisputeEventRow | null {
  const disputes = events.filter((event) => event.toStatus === 'disputed');
  disputes.sort((left, right) => {
    const time = right.createdAt.getTime() - left.createdAt.getTime();
    if (time !== 0) return time;
    return right.id.localeCompare(left.id);
  });
  return disputes[0] ?? null;
}

export function selectPayment(payments: PaymentSummaryRow[]): PaymentSummaryRow | null {
  if (payments.length === 0) return null;
  const ranked = [...payments].sort((left, right) => {
    const leftTime = left.createdAt?.getTime() ?? 0;
    const rightTime = right.createdAt?.getTime() ?? 0;
    if (rightTime !== leftTime) return rightTime - leftTime;
    return (right.id ?? '').localeCompare(left.id ?? '');
  });
  return ranked[0];
}

export function toPaymentSummary(payment: PaymentSummaryRow | null): StaffDisputePayment | null {
  if (!payment) return null;
  const amount = typeof payment.amount === 'string' ? payment.amount : payment.amount.toFixed(2);
  return {
    amount,
    currency: payment.currency,
    status: String(payment.status),
    simulated: payment.provider === PaymentProviderKind.mock,
  };
}

export function toDispute(row: {
  id: string;
  title: string;
  updatedAt: Date;
  deletedAt: Date | null;
  client: { displayName: string } | null;
  provider: { displayName: string } | null;
  events: DisputeEventRow[];
  payments: PaymentSummaryRow[];
}): StaffDispute {
  const event = selectDisputeEvent(row.events);
  return {
    id: row.id,
    title: row.title,
    status: 'disputed',
    updatedAt: row.updatedAt.toISOString(),
    deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
    clientDisplayName: row.client?.displayName ?? null,
    providerDisplayName: row.provider?.displayName ?? null,
    disputeEventId: event?.id ?? null,
    disputeAt: event ? event.createdAt.toISOString() : null,
    disputeNote: event ? event.note : null,
    payment: toPaymentSummary(selectPayment(row.payments)),
  };
}
