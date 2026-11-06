import type { StaffDirectory } from './staff-lifecycle';

type ListedUser = { id: string; email?: string | null };
type ListedFactor = { id: string; factor_type?: string; status?: string };

export type StaffAdminApi = {
  listUsers(params: { page: number; perPage: number }): Promise<{
    data: { users: ListedUser[] };
    error: { message: string } | null;
  }>;
  inviteUserByEmail(
    email: string,
    options: { redirectTo: string },
  ): Promise<{ data: { user: { id: string } | null }; error: { message: string; status?: number; name?: string } | null }>;
  getUserById(uid: string): Promise<{
    data: { user: { id: string; email?: string | null } | null };
    error: { status?: number } | null;
  }>;
  mfa: {
    listFactors(params: { userId: string }): Promise<
      { data: { factors: ListedFactor[] } | null; error: { message: string } | null }
    >;
    deleteFactor(params: { userId: string; id: string }): Promise<{ error: { message: string } | null }>;
  };
};

const pageSize = 200;
const pageCap = 20;

/**
 * Provider half of an operator command.
 * Returns ids and outcomes only. It does not return invitation links, tokens, or factor secrets.
 * This module does not create a client or send an invitation by itself.
 */
export function createStaffDirectory(
  admin: StaffAdminApi,
  redirectTo: string,
  recover?: (email: string) => Promise<{ error: { status?: number; message: string; name?: string } | null }>,
): StaffDirectory {
  return {
    async findByEmail(email) {
      const wanted = email.trim().toLowerCase();
      for (let page = 1; page <= pageCap; page += 1) {
        const listed = await admin.listUsers({ page, perPage: pageSize });
        if (listed.error) return 'unavailable';
        const found = listed.data.users.find((user) => user.email?.trim().toLowerCase() === wanted);
        if (found) return { id: found.id };
        if (listed.data.users.length < pageSize) return null;
      }
      return 'unavailable';
    },
    async invite(email) {
      const invited = await admin.inviteUserByEmail(email, { redirectTo });
      if (invited.error) {
        const message = invited.error.message.toLowerCase();
        if (message.includes('already') || message.includes('registered')) return 'already-exists';
        if (isUncertain(invited.error)) return 'uncertain';
        return 'unavailable';
      }
      const id = invited.data.user?.id;
      return id ? { id } : 'uncertain';
    },
    async readIdentity(subjectId) {
      const loaded = await admin.getUserById(subjectId);
      if (loaded.error) return loaded.error.status === 404 ? 'missing' : 'unavailable';
      const user = loaded.data.user;
      if (!user || user.id !== subjectId || !user.email) return 'missing';
      return { id: user.id, email: user.email };
    },
    async hasVerifiedTotp(subjectId) {
      const listed = await admin.mfa.listFactors({ userId: subjectId });
      if (listed.error || !listed.data) return 'unavailable';
      return listed.data.factors.some((factor) => factor.factor_type === 'totp' && factor.status === 'verified');
    },
    async revokeAccess() {
      return 'not-revoked';
    },
    async removeVerifiedTotp(subjectId) {
      const listed = await admin.mfa.listFactors({ userId: subjectId });
      if (listed.error || !listed.data) return 'unavailable';
      for (const factor of listed.data.factors) {
        if (factor.factor_type !== 'totp') continue;
        const removed = await admin.mfa.deleteFactor({ userId: subjectId, id: factor.id });
        if (removed.error) return 'unavailable';
      }
      return 'ok';
    },
    async sendPasswordRecovery(email) {
      if (!recover) return 'unavailable';
      try {
        const result = await recover(email);
        if (!result.error) return 'sent';
        return isUncertain(result.error) ? 'uncertain' : 'unavailable';
      } catch {
        return 'uncertain';
      }
    },
  };
}

function isUncertain(error: { status?: number; name?: string; message: string }): boolean {
  if (error.name === 'AuthRetryableFetchError') return true;
  if (error.status && error.status >= 500) return true;
  if (!error.status && /timeout|network|fetch/i.test(error.message)) return true;
  return false;
}
