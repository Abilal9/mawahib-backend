import { StaffAuditAction, StaffMembershipStatus } from '@prisma/client';

/**
 * Operator commands for staff invitation and membership.
 * Provider calls stay outside the database transaction.
 * A local command records unverifiedProcessUser.
 * Possession of database and staff-project credentials is not a portal actor.
 * These functions do not connect by themselves.
 */

export type LifecycleOperator = {
  /** Local process label. Not a verified portal staff actor. */
  unverifiedProcessUser: string;
};

export type ProviderIdentity = { id: string; email: string };

export type StaffDirectory = {
  findByEmail(email: string): Promise<{ id: string } | null | 'unavailable'>;
  invite(email: string): Promise<{ id: string } | 'already-exists' | 'unavailable' | 'uncertain'>;
  readIdentity(subjectId: string): Promise<ProviderIdentity | 'missing' | 'unavailable'>;
  hasVerifiedTotp(subjectId: string): Promise<boolean | 'unavailable'>;
  /** This installed SDK cannot revoke sessions by subject. Callers must report that honestly. */
  revokeAccess(subjectId: string): Promise<'not-revoked'>;
  removeVerifiedTotp(subjectId: string): Promise<'ok' | 'unavailable'>;
  /** Sends a recovery email. The result never includes the link or token. */
  sendPasswordRecovery(email: string): Promise<'sent' | 'uncertain' | 'unavailable'>;
};

export type MembershipRow = {
  id: string;
  issuer: string;
  subjectId: string;
  status: StaffMembershipStatus;
  invitedEmail: string | null;
};

export type MembershipStore = {
  find(issuer: string, subjectId: string): Promise<MembershipRow | null>;
  changeStatus(input: {
    issuer: string;
    subjectId: string;
    next: StaffMembershipStatus;
    action: StaffAuditAction;
    operator: LifecycleOperator;
    emergency: boolean;
    onlyFrom?: StaffMembershipStatus;
    /** Already at `next` is success without a second audit. */
    allowUnchanged?: boolean;
    reason?: string;
  }): Promise<'changed' | 'unchanged' | 'missing' | 'blocked' | 'last-operator' | 'audit-failed'>;
  recordPending(input: {
    issuer: string;
    subjectId: string;
    email: string;
    operator: LifecycleOperator;
  }): Promise<'created' | 'exists'>;
  latestAction(subjectId: string): Promise<StaffAuditAction | null>;
};

export function normalizeInvitationEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Both targets must match the operator's explicit expectation. A mismatch refuses the command. */
export function assertLifecycleTargets(input: {
  databaseHost: string;
  expectedDatabaseHost: string;
  staffProjectRef: string;
  expectedStaffProjectRef: string;
}) {
  const host = input.databaseHost.trim().toLowerCase();
  const expectedHost = input.expectedDatabaseHost.trim().toLowerCase();
  if (!host || host !== expectedHost) {
    throw new Error('Staff lifecycle commands refuse this application database target.');
  }
  if (!input.staffProjectRef || input.staffProjectRef !== input.expectedStaffProjectRef) {
    throw new Error('Staff lifecycle commands refuse this staff-auth project.');
  }
}

export type InviteOutcome =
  | { outcome: 'pending-recorded'; subjectId: string; invited: boolean }
  | { outcome: 'membership-exists'; subjectId: string; status: StaffMembershipStatus }
  | { outcome: 'identity-conflict'; subjectId: string; status: StaffMembershipStatus }
  | { outcome: 'provider-created-membership-missing'; subjectId: string }
  | { outcome: 'uncertain' }
  | { outcome: 'unresolved' }
  | { outcome: 'unavailable' }
  | { outcome: 'resent'; subjectId: string }
  | { outcome: 'not-delivered'; subjectId: string }
  | { outcome: 'not-pending'; subjectId: string; status: StaffMembershipStatus };

export async function inviteStaff(input: {
  issuer: string;
  email: string;
  knownSubjectId?: string;
  /** False looks up and binds only. It does not send mail. */
  send: boolean;
  operator: LifecycleOperator;
  directory: StaffDirectory;
  store: MembershipStore;
}): Promise<InviteOutcome> {
  let subjectId = input.knownSubjectId ?? null;
  let invited = false;
  if (!subjectId) {
    const existing = await input.directory.findByEmail(input.email);
    if (existing === 'unavailable') return { outcome: 'unavailable' };
    subjectId = existing?.id ?? null;
  }
  if (!subjectId && !input.send) return { outcome: 'unresolved' };
  if (!subjectId) {
    const created = await input.directory.invite(input.email);
    if (created === 'uncertain') return { outcome: 'uncertain' };
    if (created === 'unavailable') return { outcome: 'unavailable' };
    if (created === 'already-exists') {
      const again = await input.directory.findByEmail(input.email);
      if (again === 'unavailable') return { outcome: 'uncertain' };
      if (!again) return { outcome: 'uncertain' };
      subjectId = again.id;
    } else {
      subjectId = created.id;
      invited = true;
    }
  }
  return bindPending({ ...input, subjectId, invited });
}

/** Deliberate second email for a pending membership whose password setup was interrupted. */
export async function resendInvitation(input: {
  issuer: string;
  email: string;
  subjectId: string;
  acknowledgeIdentityChange: boolean;
  operator: LifecycleOperator;
  directory: StaffDirectory;
  store: MembershipStore;
}): Promise<InviteOutcome> {
  const member = await input.store.find(input.issuer, input.subjectId);
  if (!member) return { outcome: 'unresolved' };
  if (member.status !== StaffMembershipStatus.pending) {
    return { outcome: 'not-pending', subjectId: input.subjectId, status: member.status };
  }
  const identity = await input.directory.readIdentity(input.subjectId);
  if (identity === 'unavailable') return { outcome: 'unavailable' };
  if (identity === 'missing' || identity.id !== input.subjectId) return { outcome: 'unresolved' };
  const invited = member.invitedEmail ? normalizeInvitationEmail(member.invitedEmail) : null;
  const current = normalizeInvitationEmail(identity.email);
  const requested = normalizeInvitationEmail(input.email);
  if (!invited || requested !== invited) return { outcome: 'identity-conflict', subjectId: input.subjectId, status: member.status };
  if (current !== invited && !input.acknowledgeIdentityChange) {
    return { outcome: 'identity-conflict', subjectId: input.subjectId, status: member.status };
  }
  const sent = await input.directory.invite(input.email);
  if (sent === 'uncertain') return { outcome: 'uncertain' };
  if (sent === 'unavailable') return { outcome: 'unavailable' };
  if (sent === 'already-exists') return { outcome: 'not-delivered', subjectId: input.subjectId };
  if (sent.id !== input.subjectId) {
    return { outcome: 'identity-conflict', subjectId: input.subjectId, status: member.status };
  }
  return { outcome: 'resent', subjectId: input.subjectId };
}

async function bindPending(input: {
  issuer: string;
  email: string;
  subjectId: string;
  invited: boolean;
  operator: LifecycleOperator;
  store: MembershipStore;
}): Promise<InviteOutcome> {
  let recorded: 'created' | 'exists';
  try {
    recorded = await input.store.recordPending({
      issuer: input.issuer,
      subjectId: input.subjectId,
      email: normalizeInvitationEmail(input.email),
      operator: input.operator,
    });
  } catch {
    return { outcome: 'provider-created-membership-missing', subjectId: input.subjectId };
  }
  if (recorded === 'exists') {
    const row = await input.store.find(input.issuer, input.subjectId);
    if (!row) return { outcome: 'provider-created-membership-missing', subjectId: input.subjectId };
    const invited = row.invitedEmail ? normalizeInvitationEmail(row.invitedEmail) : null;
    if (invited && invited !== normalizeInvitationEmail(input.email)) {
      return { outcome: 'identity-conflict', subjectId: input.subjectId, status: row.status };
    }
    if (row.status !== StaffMembershipStatus.pending) {
      return { outcome: 'membership-exists', subjectId: input.subjectId, status: row.status };
    }
  }
  return { outcome: 'pending-recorded', subjectId: input.subjectId, invited: input.invited };
}

type IdentityCheck =
  | { outcome: 'match'; email: string }
  | { outcome: 'acknowledged'; email: string }
  | { outcome: 'identity-missing' | 'identity-changed' | 'identity-unbound' | 'unavailable' };

async function checkInvitedIdentity(input: {
  member: MembershipRow;
  subjectId: string;
  acknowledgeIdentityChange: boolean;
  directory: StaffDirectory;
}): Promise<IdentityCheck> {
  if (!input.member.invitedEmail) return { outcome: 'identity-unbound' };
  const identity = await input.directory.readIdentity(input.subjectId);
  if (identity === 'unavailable') return { outcome: 'unavailable' };
  if (identity === 'missing' || identity.id !== input.subjectId) return { outcome: 'identity-missing' };
  const sameEmail = normalizeInvitationEmail(identity.email) === normalizeInvitationEmail(input.member.invitedEmail);
  if (!sameEmail && !input.acknowledgeIdentityChange) return { outcome: 'identity-changed' };
  if (sameEmail) return { outcome: 'match', email: identity.email };
  return { outcome: 'acknowledged', email: identity.email };
}

export type PasswordSetupOutcome =
  | { outcome: 'sent'; subjectId: string }
  | { outcome: 'not-sent' }
  | { outcome: 'not-pending'; subjectId: string; status: StaffMembershipStatus }
  | { outcome: 'identity-missing' | 'identity-changed' | 'identity-unbound' | 'unavailable' | 'uncertain' | 'unresolved' };

/**
 * Sends one password-recovery email for an existing pending staff identity.
 * Verification uses type=recovery, which is separate from invitation acceptance.
 * The membership stays pending.
 */
export async function sendPasswordSetup(input: {
  issuer: string;
  email: string;
  subjectId: string;
  send: boolean;
  acknowledgeIdentityChange: boolean;
  operator: LifecycleOperator;
  directory: StaffDirectory;
  store: MembershipStore;
}): Promise<PasswordSetupOutcome> {
  if (!input.send) return { outcome: 'not-sent' };
  const member = await input.store.find(input.issuer, input.subjectId);
  if (!member || member.issuer !== input.issuer) return { outcome: 'unresolved' };
  if (member.status !== StaffMembershipStatus.pending) {
    return { outcome: 'not-pending', subjectId: input.subjectId, status: member.status };
  }
  const requested = normalizeInvitationEmail(input.email);
  const invited = member.invitedEmail ? normalizeInvitationEmail(member.invitedEmail) : null;
  if (!invited || requested !== invited) return { outcome: 'identity-changed' };
  const identity = await checkInvitedIdentity({
    member,
    subjectId: input.subjectId,
    acknowledgeIdentityChange: input.acknowledgeIdentityChange,
    directory: input.directory,
  });
  if (identity.outcome !== 'match' && identity.outcome !== 'acknowledged') return identity;
  const sent = await input.directory.sendPasswordRecovery(identity.email);
  if (sent === 'sent') return { outcome: 'sent', subjectId: input.subjectId };
  return { outcome: sent };
}

export type ActivationOutcome =
  | { outcome: 'activated'; subjectId: string }
  | { outcome: 'not-confirmed' }
  | { outcome: 'factor-missing' }
  | { outcome: 'identity-missing' }
  | { outcome: 'identity-changed' }
  | { outcome: 'identity-unbound' }
  | { outcome: 'not-pending' }
  | { outcome: 'unavailable' };

export async function activateStaff(input: {
  issuer: string;
  subjectId: string;
  confirmed: boolean;
  acknowledgeIdentityChange: boolean;
  operator: LifecycleOperator;
  directory: StaffDirectory;
  store: MembershipStore;
}): Promise<ActivationOutcome> {
  if (input.confirmed !== true) return { outcome: 'not-confirmed' };
  const member = await input.store.find(input.issuer, input.subjectId);
  if (!member || member.issuer !== input.issuer) return { outcome: 'identity-missing' };
  const identity = await checkInvitedIdentity({
    member,
    subjectId: input.subjectId,
    acknowledgeIdentityChange: input.acknowledgeIdentityChange,
    directory: input.directory,
  });
  if (identity.outcome !== 'match' && identity.outcome !== 'acknowledged') return identity;
  const factor = await input.directory.hasVerifiedTotp(input.subjectId);
  if (factor === 'unavailable') return { outcome: 'unavailable' };
  if (!factor) return { outcome: 'factor-missing' };
  const changed = await input.store.changeStatus({
    issuer: input.issuer,
    subjectId: input.subjectId,
    next: StaffMembershipStatus.active,
    action: StaffAuditAction.membership_activated,
    operator: input.operator,
    emergency: false,
    onlyFrom: StaffMembershipStatus.pending,
    allowUnchanged: true,
    reason: identity.outcome === 'acknowledged' ? 'identity-change-acknowledged' : undefined,
  });
  if (changed === 'audit-failed') throw new Error('activation audit failed');
  if (changed === 'blocked') return { outcome: 'not-pending' };
  if (changed === 'missing') return { outcome: 'identity-missing' };
  if (changed !== 'changed' && changed !== 'unchanged') return { outcome: 'identity-missing' };
  return { outcome: 'activated', subjectId: input.subjectId };
}

export type AccessCleanup = {
  access: 'removed' | 'unchanged';
  providerSession: 'not-revoked';
  factorCleanup: 'unchanged' | 'removed' | 'incomplete';
};

export type DeactivationOutcome =
  | ({ outcome: 'deactivated' } & AccessCleanup)
  | { outcome: 'last-operator'; access: 'unchanged' }
  | { outcome: 'missing'; access: 'unchanged' };

export async function deactivateStaff(input: {
  issuer: string;
  subjectId: string;
  emergency: boolean;
  operator: LifecycleOperator;
  directory: StaffDirectory;
  store: MembershipStore;
}): Promise<DeactivationOutcome> {
  const changed = await input.store.changeStatus({
    issuer: input.issuer,
    subjectId: input.subjectId,
    next: StaffMembershipStatus.inactive,
    action: input.emergency
      ? StaffAuditAction.membership_emergency_deactivated
      : StaffAuditAction.membership_deactivated,
    operator: input.operator,
    emergency: input.emergency,
    allowUnchanged: true,
  });
  if (changed === 'last-operator') return { outcome: 'last-operator', access: 'unchanged' };
  if (changed === 'missing') return { outcome: 'missing', access: 'unchanged' };
  if (changed === 'audit-failed') throw new Error('deactivation audit failed');
  await input.directory.revokeAccess(input.subjectId);
  return {
    outcome: 'deactivated',
    access: 'removed',
    providerSession: 'not-revoked',
    factorCleanup: 'unchanged',
  };
}

export type RecoveryOutcome =
  | ({ outcome: 'recovery-disabled' | 'recovery-partial' } & AccessCleanup)
  | { outcome: 'last-operator'; access: 'unchanged' }
  | { outcome: 'not-recoverable'; access: 'unchanged'; status: StaffMembershipStatus }
  | { outcome: 'missing'; access: 'unchanged' };

/**
 * Moves an active membership, or an emergency-deactivated membership, into recovery.
 * The audit row commits before factor cleanup. Recovery stays unauthorized.
 * Ordinary inactive membership is not this path.
 */
export async function recoverLostFactor(input: {
  issuer: string;
  subjectId: string;
  emergency: boolean;
  confirmed: boolean;
  operator: LifecycleOperator;
  directory: StaffDirectory;
  store: MembershipStore;
}): Promise<RecoveryOutcome> {
  const member = await input.store.find(input.issuer, input.subjectId);
  if (!member || member.issuer !== input.issuer) return { outcome: 'missing', access: 'unchanged' };
  if (member.status === StaffMembershipStatus.inactive) {
    if (input.confirmed !== true || !input.emergency) {
      return { outcome: 'not-recoverable', access: 'unchanged', status: member.status };
    }
    const latest = await input.store.latestAction(input.subjectId);
    if (latest !== StaffAuditAction.membership_emergency_deactivated) {
      return { outcome: 'not-recoverable', access: 'unchanged', status: member.status };
    }
    const changed = await input.store.changeStatus({
      issuer: input.issuer,
      subjectId: input.subjectId,
      next: StaffMembershipStatus.recovery,
      action: StaffAuditAction.membership_factor_recovery_started,
      operator: input.operator,
      emergency: true,
      onlyFrom: StaffMembershipStatus.inactive,
      reason: 'after-emergency-deactivation',
    });
    if (changed === 'audit-failed') throw new Error('recovery audit failed');
    if (changed !== 'changed') return { outcome: 'not-recoverable', access: 'unchanged', status: member.status };
  } else if (member.status === StaffMembershipStatus.active) {
    const changed = await input.store.changeStatus({
      issuer: input.issuer,
      subjectId: input.subjectId,
      next: StaffMembershipStatus.recovery,
      action: StaffAuditAction.membership_factor_recovery_started,
      operator: input.operator,
      emergency: input.emergency,
      onlyFrom: StaffMembershipStatus.active,
    });
    if (changed === 'last-operator') return { outcome: 'last-operator', access: 'unchanged' };
    if (changed === 'missing') return { outcome: 'missing', access: 'unchanged' };
    if (changed === 'blocked') return { outcome: 'not-recoverable', access: 'unchanged', status: member.status };
    if (changed === 'audit-failed') throw new Error('recovery audit failed');
  } else if (member.status !== StaffMembershipStatus.recovery) {
    return { outcome: 'not-recoverable', access: 'unchanged', status: member.status };
  }
  const factors = await input.directory.removeVerifiedTotp(input.subjectId);
  if (factors !== 'ok') {
    return {
      outcome: 'recovery-partial',
      access: 'removed',
      providerSession: 'not-revoked',
      factorCleanup: 'incomplete',
    };
  }
  return {
    outcome: 'recovery-disabled',
    access: 'removed',
    providerSession: 'not-revoked',
    factorCleanup: 'removed',
  };
}

export type ReenrollmentOutcome =
  | { outcome: 'reenrollment-permitted'; subjectId: string }
  | { outcome: 'not-confirmed' }
  | { outcome: 'cleanup-incomplete' }
  | { outcome: 'not-in-recovery' }
  | { outcome: 'missing' }
  | { outcome: 'unavailable' };

/** recovery → pending after cleanup is still true. Does not activate and does not accept inactive. */
export async function permitReenrollment(input: {
  issuer: string;
  subjectId: string;
  confirmed: boolean;
  operator: LifecycleOperator;
  directory: StaffDirectory;
  store: MembershipStore;
}): Promise<ReenrollmentOutcome> {
  if (input.confirmed !== true) return { outcome: 'not-confirmed' };
  const member = await input.store.find(input.issuer, input.subjectId);
  if (!member) return { outcome: 'missing' };
  if (member.status !== StaffMembershipStatus.recovery) return { outcome: 'not-in-recovery' };
  const factor = await input.directory.hasVerifiedTotp(input.subjectId);
  if (factor === 'unavailable') return { outcome: 'unavailable' };
  if (factor) return { outcome: 'cleanup-incomplete' };
  const changed = await input.store.changeStatus({
    issuer: input.issuer,
    subjectId: input.subjectId,
    next: StaffMembershipStatus.pending,
    action: StaffAuditAction.membership_reenrollment_permitted,
    operator: input.operator,
    emergency: false,
    onlyFrom: StaffMembershipStatus.recovery,
  });
  if (changed === 'audit-failed') throw new Error('reenrollment audit failed');
  if (changed !== 'changed') return { outcome: 'not-in-recovery' };
  return { outcome: 'reenrollment-permitted', subjectId: input.subjectId };
}

export type ReadmitOutcome =
  | { outcome: 'readmitted'; subjectId: string }
  | { outcome: 'not-confirmed' | 'reason-required' | 'use-recovery' | 'cleanup-required' | 'not-inactive' }
  | { outcome: 'identity-missing' | 'identity-changed' | 'identity-unbound' | 'unavailable' | 'missing' };

/** inactive → pending. Does not activate and does not replace lost-factor recovery. */
export async function readmitStaff(input: {
  issuer: string;
  subjectId: string;
  confirmed: boolean;
  reason: string;
  acknowledgeIdentityChange: boolean;
  operator: LifecycleOperator;
  directory: StaffDirectory;
  store: MembershipStore;
}): Promise<ReadmitOutcome> {
  if (input.confirmed !== true) return { outcome: 'not-confirmed' };
  const reason = cleanOperatorReason(input.reason);
  if (!reason) return { outcome: 'reason-required' };
  const member = await input.store.find(input.issuer, input.subjectId);
  if (!member || member.issuer !== input.issuer) return { outcome: 'missing' };
  if (member.status === StaffMembershipStatus.recovery) return { outcome: 'use-recovery' };
  if (member.status !== StaffMembershipStatus.inactive) return { outcome: 'not-inactive' };
  const latest = await input.store.latestAction(input.subjectId);
  if (latest === StaffAuditAction.membership_emergency_deactivated) {
    const factor = await input.directory.hasVerifiedTotp(input.subjectId);
    if (factor === 'unavailable') return { outcome: 'unavailable' };
    if (factor) return { outcome: 'cleanup-required' };
  }
  const identity = await checkInvitedIdentity({
    member,
    subjectId: input.subjectId,
    acknowledgeIdentityChange: input.acknowledgeIdentityChange,
    directory: input.directory,
  });
  if (identity.outcome !== 'match' && identity.outcome !== 'acknowledged') return identity;
  const changed = await input.store.changeStatus({
    issuer: input.issuer,
    subjectId: input.subjectId,
    next: StaffMembershipStatus.pending,
    action: StaffAuditAction.membership_readmitted,
    operator: input.operator,
    emergency: false,
    onlyFrom: StaffMembershipStatus.inactive,
    reason: identity.outcome === 'acknowledged' ? `identity-change-acknowledged ${reason}` : reason,
  });
  if (changed === 'audit-failed') throw new Error('readmission audit failed');
  if (changed !== 'changed') return { outcome: 'not-inactive' };
  return { outcome: 'readmitted', subjectId: input.subjectId };
}

function cleanOperatorReason(value: string): string | null {
  const reason = value.trim().replace(/\s+/g, ' ');
  if (reason.length < 8 || reason.length > 200) return null;
  if (/:\/\/|\beyJ\b|\bsb_|\bpassword\b|\btoken\b/i.test(reason)) return null;
  return reason;
}
