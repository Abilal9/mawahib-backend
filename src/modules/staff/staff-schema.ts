import type { PrismaService } from '../../infrastructure/database/prisma.service';

/** Recheck the catalog at this interval. A ready result is not kept for the process lifetime. */
const SCHEMA_RECHECK_MS = 30_000;

let cached: { ready: boolean; checkedAt: number } | null = null;

/** Test hook. Production code clears this only after an undefined-column error. */
export function resetStaffMembershipSchemaCache(): void {
  cached = null;
}

/**
 * One catalog query for the issuer-aware contract. It checks the columns,
 * the exact unique indexes, and the validated foreign keys, not only names.
 * A thrown catalog read is not cached and is not a membership denial.
 * A result is reused for 30 seconds, then checked again. An undefined-column
 * error on a later membership read clears that cache.
 */
export async function staffMembershipSchemaReady(
  db: Pick<PrismaService, '$queryRaw'>,
): Promise<boolean> {
  const now = Date.now();
  if (cached && now - cached.checkedAt < SCHEMA_RECHECK_MS) {
    return cached.ready;
  }
  const rows = await db.$queryRaw<Array<{ ok: boolean }>>`
    SELECT (
      EXISTS (
        SELECT 1
        FROM pg_attribute a
        JOIN pg_class c ON c.oid = a.attrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relname = 'staff_members'
          AND a.attname = 'issuer'
          AND a.attnum > 0
          AND NOT a.attisdropped
      )
      AND EXISTS (
        SELECT 1
        FROM pg_attribute a
        JOIN pg_class c ON c.oid = a.attrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relname = 'staff_members'
          AND a.attname = 'linked_product_user_id'
          AND a.attnum > 0
          AND NOT a.attisdropped
      )
      AND EXISTS (
        SELECT 1
        FROM pg_attribute a
        JOIN pg_class c ON c.oid = a.attrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relname = 'staff_audit_events'
          AND a.attname = 'actor_staff_member_id'
          AND a.attnum > 0
          AND NOT a.attisdropped
      )
      AND EXISTS (
        SELECT 1
        FROM pg_index i
        JOIN pg_class idx ON idx.oid = i.indexrelid
        JOIN pg_class tbl ON tbl.oid = i.indrelid
        JOIN pg_namespace n ON n.oid = tbl.relnamespace
        WHERE n.nspname = 'public'
          AND tbl.relname = 'staff_members'
          AND idx.relname = 'staff_members_issuer_subject_id_key'
          AND i.indisunique
          AND i.indisvalid
          AND (
            SELECT array_agg(attr.attname::text ORDER BY cols.ord)
            FROM unnest(i.indkey) WITH ORDINALITY AS cols(attnum, ord)
            JOIN pg_attribute attr
              ON attr.attrelid = tbl.oid
             AND attr.attnum = cols.attnum
          ) = ARRAY['issuer', 'subject_id']::text[]
      )
      AND EXISTS (
        SELECT 1
        FROM pg_index i
        JOIN pg_class idx ON idx.oid = i.indexrelid
        JOIN pg_class tbl ON tbl.oid = i.indrelid
        JOIN pg_namespace n ON n.oid = tbl.relnamespace
        WHERE n.nspname = 'public'
          AND tbl.relname = 'staff_members'
          AND idx.relname = 'staff_members_linked_product_user_id_key'
          AND i.indisunique
          AND i.indisvalid
          AND (
            SELECT array_agg(attr.attname::text ORDER BY cols.ord)
            FROM unnest(i.indkey) WITH ORDINALITY AS cols(attnum, ord)
            JOIN pg_attribute attr
              ON attr.attrelid = tbl.oid
             AND attr.attnum = cols.attnum
          ) = ARRAY['linked_product_user_id']::text[]
      )
      AND EXISTS (
        SELECT 1
        FROM pg_constraint con
        JOIN pg_class rel ON rel.oid = con.conrelid
        JOIN pg_namespace n ON n.oid = rel.relnamespace
        JOIN pg_class frel ON frel.oid = con.confrelid
        WHERE n.nspname = 'public'
          AND con.conname = 'staff_members_linked_product_user_id_fkey'
          AND con.contype = 'f'
          AND con.convalidated
          AND rel.relname = 'staff_members'
          AND frel.relname = 'users'
          AND con.confdeltype = 'n'
          AND (
            SELECT array_agg(attr.attname::text ORDER BY cols.ord)
            FROM unnest(con.conkey) WITH ORDINALITY AS cols(attnum, ord)
            JOIN pg_attribute attr
              ON attr.attrelid = rel.oid
             AND attr.attnum = cols.attnum
          ) = ARRAY['linked_product_user_id']::text[]
      )
      AND EXISTS (
        SELECT 1
        FROM pg_constraint con
        JOIN pg_class rel ON rel.oid = con.conrelid
        JOIN pg_namespace n ON n.oid = rel.relnamespace
        JOIN pg_class frel ON frel.oid = con.confrelid
        WHERE n.nspname = 'public'
          AND con.conname = 'staff_audit_events_actor_staff_member_id_fkey'
          AND con.contype = 'f'
          AND con.convalidated
          AND rel.relname = 'staff_audit_events'
          AND frel.relname = 'staff_members'
          AND con.confdeltype = 'r'
          AND (
            SELECT array_agg(attr.attname::text ORDER BY cols.ord)
            FROM unnest(con.conkey) WITH ORDINALITY AS cols(attnum, ord)
            JOIN pg_attribute attr
              ON attr.attrelid = rel.oid
             AND attr.attnum = cols.attnum
          ) = ARRAY['actor_staff_member_id']::text[]
      )
    ) AS ok
  `;
  const ready = rows[0]?.ok === true;
  cached = { ready, checkedAt: now };
  return ready;
}

export function isUndefinedColumnError(error: unknown): boolean {
  const text = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  return text.includes('42703') || /column ["']?[\w.]+["']? does not exist/i.test(text);
}
