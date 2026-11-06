import { StaffMembershipStatus, StaffRole } from '@prisma/client';

/**
 * Staff issuer and JWKS come only from server configuration.
 * Membership admission is intentionally not decided here.
 *
 * Lost-factor and last-operator scripts are not part of token separation.
 * Lost-factor recovery moves active membership, or an emergency-deactivated
 * membership, into recovery before factor cleanup. Re-enrollment is a
 * separate audited step back to pending. Ordinary inactive membership
 * returns only through explicit re-admission, which also lands on pending.
 * A failed provider call must leave membership disabled.
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
): 'admit' | 'pending' | 'deny' {
  if (!member || member.issuer !== expectedIssuer) return 'deny';
  if (member.role !== required) return 'deny';
  if (member.status === StaffMembershipStatus.pending) return 'pending';
  if (member.status !== StaffMembershipStatus.active) return 'deny';
  return 'admit';
}

function normalizeOrigin(value: string | undefined): string | null {
  if (!value?.trim()) return null;
  return stripTrailingSlash(value.trim());
}

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}
