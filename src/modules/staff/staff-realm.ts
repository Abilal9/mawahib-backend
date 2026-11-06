import { StaffMembershipStatus, StaffRole } from '@prisma/client';

/**
 * Staff issuer and JWKS come only from server configuration.
 * Membership admission is intentionally not decided here.
 *
 * Lost-factor and last-operator scripts are not part of token separation.
 * When they are added: disable membership and write the audit row before
 * any provider factor or session call, and reactivate only after a verified
 * factor exists again. A failed provider call must leave membership inactive.
 * Ordinary removal must refuse to leave zero active operators. Emergency
 * removal of the last operator stays a separate audited command.
 */

export type StaffRealmConfig = {
  issuer: string;
  jwksUrl: string;
};

type RealmInput = {
  staffUrl?: string;
  staffJwksUrl?: string;
  productUrl?: string;
  productJwksUrl?: string;
};

export function assertCompatibleStaffRealm(input: RealmInput): void {
  const staffUrl = normalizeOrigin(input.staffUrl);
  const staffJwks = input.staffJwksUrl?.trim();
  if (!staffUrl && !staffJwks) return;
  if (!staffUrl) {
    throw new Error(
      'Partial staff auth config: set STAFF_SUPABASE_URL together with any staff JWKS URL.',
    );
  }
  const issuer = `${staffUrl}/auth/v1`;
  const jwksUrl = staffJwks
    ? stripTrailingSlash(staffJwks)
    : `${issuer}/.well-known/jwks.json`;
  const productUrl = normalizeOrigin(input.productUrl);
  if (!productUrl) return;
  const productIssuer = `${productUrl}/auth/v1`;
  const productJwks = input.productJwksUrl?.trim()
    ? stripTrailingSlash(input.productJwksUrl)
    : `${productIssuer}/.well-known/jwks.json`;
  if (issuer === productIssuer || jwksUrl === productJwks) {
    throw new Error(
      'Staff auth realm must use a different issuer and JWKS URL from the product realm.',
    );
  }
}

export function readStaffRealm(input: RealmInput): StaffRealmConfig | null {
  const staffUrl = normalizeOrigin(input.staffUrl);
  const staffJwks = input.staffJwksUrl?.trim();
  if (!staffUrl && !staffJwks) return null;
  if (!staffUrl) return null;
  const issuer = `${staffUrl}/auth/v1`;
  const jwksUrl = staffJwks
    ? stripTrailingSlash(staffJwks)
    : `${issuer}/.well-known/jwks.json`;
  const productUrl = normalizeOrigin(input.productUrl);
  if (productUrl) {
    const productIssuer = `${productUrl}/auth/v1`;
    const productJwks = input.productJwksUrl?.trim()
      ? stripTrailingSlash(input.productJwksUrl)
      : `${productIssuer}/.well-known/jwks.json`;
    if (issuer === productIssuer || jwksUrl === productJwks) return null;
  }
  return { issuer, jwksUrl };
}

export type StaffMembershipView = {
  status: StaffMembershipStatus;
  role: StaffRole;
  issuer: string;
};

/** Issuer-aware decision. A row without the expected issuer is not staff. */
export function evaluateStaffMembership(
  member: StaffMembershipView | null,
  required: StaffRole,
  expectedIssuer: string,
): 'admit' | 'deny' {
  if (!member || member.issuer !== expectedIssuer) return 'deny';
  if (member.status !== StaffMembershipStatus.active) return 'deny';
  if (member.role !== required) return 'deny';
  return 'admit';
}

function normalizeOrigin(value: string | undefined): string | null {
  if (!value?.trim()) return null;
  return stripTrailingSlash(value.trim());
}

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}
