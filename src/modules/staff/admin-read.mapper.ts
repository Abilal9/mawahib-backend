import { PaymentProviderKind, type PaymentStatus } from '@prisma/client';

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

export type StaffParty = {
  id: string;
  displayName: string;
  deleted: boolean;
};

type PartyRow = { id: string; displayName: string; deletedAt: Date | null };

const PACKAGE_ORDER = ['basic', 'standard', 'premium'];

function party(row: PartyRow | null | undefined): StaffParty | null {
  if (!row) return null;
  return { id: row.id, displayName: row.displayName, deleted: row.deletedAt != null };
}

function iso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

function money(value: { toFixed(digits: number): string } | string | null | undefined): string | null {
  if (value == null) return null;
  return typeof value === 'string' ? Number(value).toFixed(2) : value.toFixed(2);
}

export type StaffJobListItem = {
  id: string;
  title: string;
  companyName: string | null;
  status: string;
  employmentType: string;
  poster: StaffParty | null;
  applicationCount: number;
  postedAt: string | null;
  createdAt: string;
  deletedAt: string | null;
};

export type StaffJobDetail = StaffJobListItem & {
  location: string;
  updatedAt: string;
  category: { id: string; nameEn: string } | null;
  customCategory: string | null;
  pricing: {
    type: string;
    currency: string;
    fixedAmount: string | null;
    minAmount: string | null;
    maxAmount: string | null;
  };
  engagementCount: number;
  engagements: StaffEngagementInvoices[];
};

export function toJobList(row: {
  id: string;
  title: string;
  companyName: string | null;
  status: string;
  employmentType: string;
  poster: PartyRow | null;
  postedAt: Date | null;
  createdAt: Date;
  deletedAt: Date | null;
  _count: { applications: number };
}): StaffJobListItem {
  return {
    id: row.id,
    title: row.title,
    companyName: row.companyName,
    status: row.status,
    employmentType: row.employmentType,
    poster: party(row.poster),
    applicationCount: row._count.applications,
    postedAt: iso(row.postedAt),
    createdAt: row.createdAt.toISOString(),
    deletedAt: iso(row.deletedAt),
  };
}

export function toJobDetail(row: Parameters<typeof toJobList>[0] & {
  location: string;
  updatedAt: Date;
  customCategory: string | null;
  pricingType: string;
  currency: string;
  fixedAmount: { toFixed(digits: number): string } | string | null;
  minAmount: { toFixed(digits: number): string } | string | null;
  maxAmount: { toFixed(digits: number): string } | string | null;
  taxonomyCategory: { id: string; nameEn: string } | null;
  _count: { applications: number; engagements: number };
  engagements: Array<{
    id: string;
    title: string;
    status: string;
    deletedAt: Date | null;
    client: PartyRow | null;
    provider: PartyRow | null;
    payments: PaymentAttemptRow[];
  }>;
}): StaffJobDetail {
  return {
    ...toJobList(row),
    location: row.location,
    updatedAt: row.updatedAt.toISOString(),
    category: row.taxonomyCategory,
    customCategory: row.customCategory,
    pricing: {
      type: row.pricingType,
      currency: row.currency.trim(),
      fixedAmount: money(row.fixedAmount),
      minAmount: money(row.minAmount),
      maxAmount: money(row.maxAmount),
    },
    engagementCount: row._count.engagements,
    engagements: row.engagements.map(toEngagementInvoices),
  };
}

export type StaffServiceListItem = {
  id: string;
  title: string;
  status: string;
  owner: StaffParty | null;
  currency: string;
  fromPrice: string | null;
  packageCount: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

export type StaffServicePackage = {
  id: string;
  tier: string;
  price: string;
  currency: string;
  deliveryLabel: string;
};

export type StaffServiceDetail = StaffServiceListItem & {
  category: { id: string; nameEn: string } | null;
  customCategory: string | null;
  packages: StaffServicePackage[];
  engagementCount: number;
};

function orderedPackages(packages: StaffServicePackage[]): StaffServicePackage[] {
  return [...packages].sort(
    (left, right) => PACKAGE_ORDER.indexOf(left.tier) - PACKAGE_ORDER.indexOf(right.tier),
  );
}

export function toServiceList(row: {
  id: string;
  title: string;
  status: string;
  user: PartyRow | null;
  currency: string;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  packages: Array<{ price: { toFixed(digits: number): string } | string }>;
}): StaffServiceListItem {
  const prices = row.packages
    .map((item) => money(item.price))
    .filter((price): price is string => price != null)
    .sort((left, right) => Number(left) - Number(right));
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    owner: party(row.user),
    currency: row.currency.trim(),
    fromPrice: prices[0] ?? null,
    packageCount: row.packages.length,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    deletedAt: iso(row.deletedAt),
  };
}

export function toServiceDetail(row: {
  id: string;
  title: string;
  status: string;
  user: PartyRow | null;
  currency: string;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  customCategory: string | null;
  taxonomyCategory: { id: string; nameEn: string } | null;
  packages: Array<{
    id: string;
    tier: string;
    price: { toFixed(digits: number): string } | string;
    currency: string;
    deliveryLabel: string;
  }>;
  _count: { engagements: number };
}): StaffServiceDetail {
  return {
    ...toServiceList(row),
    category: row.taxonomyCategory,
    customCategory: row.customCategory,
    packages: orderedPackages(
      row.packages.map((item) => ({
        id: item.id,
        tier: item.tier,
        price: money(item.price) ?? '0.00',
        currency: item.currency.trim(),
        deliveryLabel: item.deliveryLabel,
      })),
    ),
    engagementCount: row._count.engagements,
  };
}

export type StaffApplicationListItem = {
  id: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  listing: { id: string; title: string; status: string; deleted: boolean } | null;
  applicant: StaffParty | null;
  poster: StaffParty | null;
  engagementId: string | null;
};

export type StaffApplicationDetail = StaffApplicationListItem & {
  engagement: { id: string; status: string; deleted: boolean } | null;
};

export function toApplicationList(row: {
  id: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  listing: {
    id: string;
    title: string;
    status: string;
    deletedAt: Date | null;
    poster: PartyRow | null;
  } | null;
  applicant: PartyRow | null;
  engagement: { id: string } | null;
}): StaffApplicationListItem {
  return {
    id: row.id,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    deletedAt: iso(row.deletedAt),
    listing: row.listing
      ? {
          id: row.listing.id,
          title: row.listing.title,
          status: row.listing.status,
          deleted: row.listing.deletedAt != null,
        }
      : null,
    applicant: party(row.applicant),
    poster: party(row.listing?.poster),
    engagementId: row.engagement?.id ?? null,
  };
}

export function toApplicationDetail(row: Parameters<typeof toApplicationList>[0] & {
  engagement: { id: string; status: string; deletedAt: Date | null } | null;
}): StaffApplicationDetail {
  return {
    ...toApplicationList(row),
    engagement: row.engagement
      ? {
          id: row.engagement.id,
          status: row.engagement.status,
          deleted: row.engagement.deletedAt != null,
        }
      : null,
  };
}

export type StaffEngagementListItem = {
  id: string;
  title: string;
  status: string;
  source: string;
  client: StaffParty | null;
  provider: StaffParty | null;
  listingId: string | null;
  applicationId: string | null;
  serviceOfferingId: string | null;
  payment: StaffDisputePayment | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  deletedAt: string | null;
};

export type StaffEngagementDetail = StaffEngagementListItem & {
  dueAt: string | null;
  reviewWindowClosesAt: string | null;
  listing: { id: string; title: string; deleted: boolean } | null;
  serviceOffering: { id: string; title: string; deleted: boolean } | null;
  disputeCaseId: string | null;
  payments: StaffPaymentAttempt[];
};

export function toEngagementList(row: {
  id: string;
  title: string;
  status: string;
  source: string;
  client: PartyRow | null;
  provider: PartyRow | null;
  listingId: string | null;
  applicationId: string | null;
  serviceOfferingId: string | null;
  payments: PaymentSummaryRow[];
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
  deletedAt: Date | null;
}): StaffEngagementListItem {
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    source: row.source,
    client: party(row.client),
    provider: party(row.provider),
    listingId: row.listingId,
    applicationId: row.applicationId,
    serviceOfferingId: row.serviceOfferingId,
    payment: toPaymentSummary(selectPayment(row.payments)),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    completedAt: iso(row.completedAt),
    deletedAt: iso(row.deletedAt),
  };
}

export function toEngagementDetail(row: Omit<Parameters<typeof toEngagementList>[0], 'payments'> & {
  payments: PaymentAttemptRow[];
  dueAt: Date | null;
  reviewWindowClosesAt: Date | null;
  listing: { id: string; title: string; deletedAt: Date | null } | null;
  serviceOffering: { id: string; title: string; deletedAt: Date | null } | null;
  disputeCases?: Array<{ id: string }>;
}): StaffEngagementDetail {
  return {
    ...toEngagementList(row),
    dueAt: iso(row.dueAt),
    reviewWindowClosesAt: iso(row.reviewWindowClosesAt),
    listing: row.listing
      ? { id: row.listing.id, title: row.listing.title, deleted: row.listing.deletedAt != null }
      : null,
    serviceOffering: row.serviceOffering
      ? {
          id: row.serviceOffering.id,
          title: row.serviceOffering.title,
          deleted: row.serviceOffering.deletedAt != null,
        }
      : null,
    disputeCaseId: row.disputeCases?.[0]?.id ?? null,
    payments: row.payments.map(toPaymentAttempt),
  };
}

type InvoiceAttemptRow = {
  id: string;
  invoiceNumber: string;
  status: string;
  currency: string;
  total: { toFixed(digits: number): string } | string;
  provider: string;
  issuedAt: Date | null;
  documentMediaAssetId: string | null;
};

type PaymentAttemptRow = PaymentSummaryRow & {
  id: string;
  createdAt: Date;
  invoice: InvoiceAttemptRow | null;
};

export type StaffPaymentAttempt = {
  id: string;
  amount: string;
  currency: string;
  status: string;
  simulated: boolean;
  createdAt: string;
  invoice: {
    id: string;
    invoiceNumber: string;
    issuedAt: string | null;
    amount: string;
    currency: string;
    status: string;
    simulated: boolean;
    hasDocument: boolean;
  } | null;
};

export type StaffEngagementInvoices = {
  id: string;
  title: string;
  status: string;
  deleted: boolean;
  client: StaffParty | null;
  provider: StaffParty | null;
  payments: StaffPaymentAttempt[];
};

function toPaymentAttempt(row: PaymentAttemptRow): StaffPaymentAttempt {
  const summary = toPaymentSummary(row);
  return {
    id: row.id,
    amount: summary?.amount ?? money(row.amount) ?? '0.00',
    currency: (summary?.currency ?? row.currency).trim(),
    status: summary?.status ?? String(row.status),
    simulated: summary?.simulated ?? row.provider === 'mock',
    createdAt: row.createdAt.toISOString(),
    invoice: row.invoice
      ? {
          id: row.invoice.id,
          invoiceNumber: row.invoice.invoiceNumber,
          issuedAt: iso(row.invoice.issuedAt),
          amount: money(row.invoice.total) ?? '0.00',
          currency: row.invoice.currency.trim(),
          status: row.invoice.status,
          simulated: row.invoice.provider === 'mock',
          hasDocument:
            row.invoice.status === 'generated' && row.invoice.documentMediaAssetId != null,
        }
      : null,
  };
}

export function toEngagementInvoices(row: {
  id: string;
  title: string;
  status: string;
  deletedAt: Date | null;
  client: PartyRow | null;
  provider: PartyRow | null;
  payments: PaymentAttemptRow[];
}): StaffEngagementInvoices {
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    deleted: row.deletedAt != null,
    client: party(row.client),
    provider: party(row.provider),
    payments: row.payments.map(toPaymentAttempt),
  };
}
