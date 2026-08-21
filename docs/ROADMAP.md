# Mawahib roadmap (current)

**Status:** Living status document — prefer this over phase tables in older blueprints  
**Last reviewed:** 2026-08-21

Canonical product rules:

- Money / currency / commercial snapshots → [`COMMERCIAL_MODEL.md`](./COMMERCIAL_MODEL.md)
- Marketplace UX → [`MARKETPLACE_CANONICAL_FLOW.md`](./MARKETPLACE_CANONICAL_FLOW.md)
- Work request technical contract → [`MARKETPLACE_WORK_REQUESTS.md`](./MARKETPLACE_WORK_REQUESTS.md)
- Frontend Auth behavior → `mawahib-ui-prototype/docs/AUTH.md`

---

## Completed / frozen

| Area | Notes |
|------|--------|
| Architecture foundation | Nest → services → repositories → Prisma → Postgres; Supabase Auth + Storage only |
| **Auth (MVP stage freeze)** | OTP-first email verification; F1 OTP honesty; F2 phone binding; F3 trusted email; F4 hydrate coalesce; F5 Nest-down; F6 deep-link; JWKS JWT; bootstrap; MainTabsGate; session restore; SA/AE phone picker; null `avatarUrl` → FE default avatar |
| Profiles foundation | `/users/me`, visitor reads, media upload sessions |
| Media | Nest-owned `media_assets` + signed uploads |
| Portfolio / services | CRUD + visitor reads |
| Marketplace | Listings, applications, work requests, engagements, explore lists |
| Messaging foundation | Conversations, messages, attachments, unread |
| Connections | Requests + accepted graph |
| Notifications foundation | List / unread / mark read / routing payloads |
| Money + location model | SA→SAR / AE→AED; commercial snapshots; negotiation freezes currency |
| Commercial Model | Frozen in `COMMERCIAL_MODEL.md` |

Marketplace commercial semantics and messaging/notifications foundations must not be redesigned casually. New surfaces must conform to the canonical docs above. **Do not redesign the Auth contract** without an explicit unfreeze.

---

## Current focus (ordered)

1. **Home Feed**
2. **Posts** (Nest + Prisma; replace FE mock)
3. **Profile completion** (persisted about sections, polish)
4. **Reviews** (product list + aggregates beyond engagement bridge)
5. **Jobs / attachments** (editing + supporting documents on work requests)
6. **Visitor profiles / connections** polish (incl. public vs private profile DTO)
7. **Explore** polish
8. **Notifications** polish
9. **Settings**
10. **Stories** decision (still deferred unless product forces it)
11. **Stabilization / QA** (concurrency, empty/error states, authz edges)
12. **Account Lifecycle / User Deletion Hardening** — **HARD PREREQUISITE** before Payments (see below; **do not implement now**)
13. **Escrow / Payments** (consume frozen `chargeableTotal` / commercial terms) — blocked until (12)
14. **Admin Panel Dashboard**
15. **Production hardening** (rate limits, observability, SMS/OTP production, etc.)

---

## Before Payments / Escrow — Account Lifecycle (deferred, mandatory)

**Status:** Design intention **frozen**. Implementation **deliberately deferred**. Do **not** code this during Auth / Feed / Posts work.

Account Lifecycle / User Deletion Hardening is a **prerequisite for Payments/Escrow**. Current User `onDelete: Cascade` relationships are **not** safe for financial retention. Production deletion must use **soft-delete + PII anonymization + commercial/financial history retention** — not `DELETE` the User row and cascade everything.

Also see marketplace note: [`MARKETPLACE_CANONICAL_FLOW.md`](./MARKETPLACE_CANONICAL_FLOW.md) §17.

### Why (from current architecture audit)

- Supabase Auth `user.id` = JWT `sub` = `public.users.id` after `/auth/bootstrap`, but there is **no** FK from `public.users` → `auth.users`.
- Deleting a user in **Supabase Dashboard → Authentication → Users** removes Auth identity only; Nest/`public.users`/profiles/commercial rows/Storage objects can remain (ghost/stale user; email/phone uniqueness may stay blocked).
- Many Prisma User FKs use **ON DELETE CASCADE** into marketplace/commercial-adjacent data (work requests, engagements, applications, reviews, connections, etc.). Acceptable while **no** production hard-delete User API exists; **dangerous** once payments/escrow/ledger exist.

### Intended production model (not built yet)

```text
SOFT DELETE + PII ANONYMIZATION + COMMERCIAL / FINANCIAL HISTORY RETENTION
```

Not: hard-delete User + cascade all related records.

Conceptually: deletion request → managed Nest account-lifecycle process → revoke access → anonymize eligible PII → hide public profile/content as appropriate → **retain** marketplace/commercial/financial/dispute/audit history → coordinated Auth revocation → permitted Storage cleanup → audit event.

Lifecycle states (names TBD later): e.g. ACTIVE / SUSPENDED / DEACTIVATED / DELETION_REQUESTED / DELETED / ANONYMIZED. **Do not add these fields now.**

### Payments blocker checklist (confirm before Payments phase)

- [ ] No hard-delete User API can erase financial history
- [ ] Commercial FKs reclassified (Restrict / SetNull / tombstone) where retention is required — not a blind Cascade→Restrict sweep
- [ ] User deletion is soft-delete + anonymization based
- [ ] Supabase Auth cleanup coordinated with Mawahib user state (prefer Nest-originated deletion; Dashboard delete is not the product path)
- [ ] Email / phone / username reuse policy defined (anonymize/release unique constraints)
- [ ] Financial/commercial rows + audit trail survive account deletion
- [ ] Storage cleanup policy (delete vs retain vs detach) defined
- [ ] Re-registration / restore / admin suspend-vs-delete behavior defined

### Before implementing: contract required

When this work is scheduled, **first** produce an **ACCOUNT LIFECYCLE IMPLEMENTATION CONTRACT** (lifecycle states, Nest ownership, FK classification, anonymization, Auth revocation, Storage, retention, admin actions, audit, tests, migration). Review externally **before** coding. Do not implement from this roadmap note alone.

### Dev / test cleanup (not production)

- Unverified / never-bootstrapped: Auth-only delete may be enough.
- After bootstrap: Auth-only delete is **not** enough for reuse; use a fresh email/phone **or** deliberately clean Auth + `public.users` (and optional Storage) in **dev only**. Do not promote that into production deletion.

---

## Explicitly deferred

| Item | Why |
|------|-----|
| Account Lifecycle / production Delete Account | Soft-delete + anonymize + retain commercial/financial history; **required before Payments** — see section above |
| Stories | Not required to stabilize MVP social; FE entry points are stubs |
| Ranking / AI feed | Chronological / connection-based feed first |
| Automatic FX | Forbidden by commercial model |
| Premium / calendars / Elasticsearch | Later growth |

---

## Historical blueprints

| Document | How to use |
|----------|------------|
| `MVP_MASTER_BLUEPRINT.md` | Pre–Phase 3 design archive; ER ideas; **not** live roadmap |
| `BACKEND_BLUEPRINT.md` | Domain encyclopedia; **SAR-only and old FSM notes are superseded** |

When those conflict with `COMMERCIAL_MODEL.md` or marketplace canonical docs, **prefer the canonical docs**.
