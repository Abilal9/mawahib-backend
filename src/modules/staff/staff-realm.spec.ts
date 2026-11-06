import { StaffMembershipStatus, StaffRole } from '@prisma/client';
import {
  assertCompatibleStaffRealm,
  evaluateStaffMembership,
} from './staff-realm';

describe('staff realm configuration', () => {
  const product = {
    productUrl: 'https://product.supabase.co',
    productJwksUrl: 'https://product.supabase.co/auth/v1/.well-known/jwks.json',
  };

  it('allows product startup when staff settings are absent', () => {
    expect(() => assertCompatibleStaffRealm(product)).not.toThrow();
  });

  it('rejects a partial staff setting', () => {
    expect(() =>
      assertCompatibleStaffRealm({
        ...product,
        staffJwksUrl: 'https://staff.supabase.co/auth/v1/.well-known/jwks.json',
      }),
    ).toThrow(/STAFF_SUPABASE_URL/);
  });

  it('rejects a staff JWKS URL from the product realm', () => {
    expect(() =>
      assertCompatibleStaffRealm({
        ...product,
        staffUrl: 'https://staff.supabase.co/',
        staffJwksUrl: 'https://product.supabase.co/auth/v1/.well-known/jwks.json',
      }),
    ).toThrow(/different issuer and JWKS/);
  });

  it('rejects a staff realm that matches the product realm', () => {
    expect(() =>
      assertCompatibleStaffRealm({
        ...product,
        staffUrl: 'https://product.supabase.co/',
      }),
    ).toThrow(/different issuer and JWKS/);
  });
});

describe('issuer-aware staff membership', () => {
  const issuer = 'https://staff.supabase.co/auth/v1';

  it('denies a pending or inactive membership', () => {
    for (const status of [
      StaffMembershipStatus.pending,
      StaffMembershipStatus.inactive,
    ]) {
      expect(
        evaluateStaffMembership(
          { status, role: StaffRole.operator, issuer },
          StaffRole.operator,
          issuer,
        ),
      ).toBe('deny');
    }
  });

  it('denies a matching subject whose issuer is the product realm or missing', () => {
    expect(
      evaluateStaffMembership(
        {
          status: StaffMembershipStatus.active,
          role: StaffRole.operator,
          issuer: 'https://product.supabase.co/auth/v1',
        },
        StaffRole.operator,
        issuer,
      ),
    ).toBe('deny');
    expect(
      evaluateStaffMembership(
        {
          status: StaffMembershipStatus.active,
          role: StaffRole.operator,
          issuer: '',
        },
        StaffRole.operator,
        issuer,
      ),
    ).toBe('deny');
  });

  it('admits only an active operator for the configured staff issuer', () => {
    expect(
      evaluateStaffMembership(
        {
          status: StaffMembershipStatus.active,
          role: StaffRole.operator,
          issuer,
        },
        StaffRole.operator,
        issuer,
      ),
    ).toBe('admit');
  });
});
