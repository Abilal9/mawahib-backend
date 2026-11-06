import {
  resetStaffMembershipSchemaCache,
  staffMembershipSchemaReady,
} from './staff-schema';

describe('staff membership schema readiness', () => {
  beforeEach(() => {
    resetStaffMembershipSchemaCache();
  });

  it('requires the issuer, link, audit actor, uniqueness, and foreign keys together', async () => {
    let sql = '';
    const ready = await staffMembershipSchemaReady({
      $queryRaw: async (strings: TemplateStringsArray) => {
        sql = Array.from(strings).join(' ');
        return [{ ok: true }];
      },
    } as never);
    expect(ready).toBe(true);
    expect(sql).toContain('indisunique');
    expect(sql).toContain('convalidated');
    expect(sql).toContain('staff_members_issuer_subject_id_key');
    expect(sql).toContain('staff_members_linked_product_user_id_key');
    expect(sql).toContain('staff_members_linked_product_user_id_fkey');
    expect(sql).toContain('staff_audit_events_actor_staff_member_id_fkey');
    expect(sql).toContain("ARRAY['issuer', 'subject_id']");
    expect(sql).toContain("ARRAY['linked_product_user_id']");
    expect(sql).toContain("ARRAY['actor_staff_member_id']");
  });

  it('does not treat a failed catalog read as a stored not-ready result', async () => {
    const query = jest.fn(async () => {
      throw new Error('catalog unavailable');
    });
    await expect(staffMembershipSchemaReady({ $queryRaw: query } as never)).rejects.toThrow(
      'catalog unavailable',
    );
    await expect(staffMembershipSchemaReady({ $queryRaw: query } as never)).rejects.toThrow(
      'catalog unavailable',
    );
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('reuses a not-ready result briefly, then checks again', async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce([{ ok: false }])
      .mockResolvedValueOnce([{ ok: true }]);
    await expect(staffMembershipSchemaReady({ $queryRaw: query } as never)).resolves.toBe(false);
    await expect(staffMembershipSchemaReady({ $queryRaw: query } as never)).resolves.toBe(false);
    resetStaffMembershipSchemaCache();
    await expect(staffMembershipSchemaReady({ $queryRaw: query } as never)).resolves.toBe(true);
    expect(query).toHaveBeenCalledTimes(2);
  });
});
