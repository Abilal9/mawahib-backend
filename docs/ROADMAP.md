# Mawahib roadmap (current)

**Status:** Living status document — prefer this over phase tables in older blueprints  
**Last reviewed:** 2026-10-07

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
| **Profile completion** | `PATCH /users/me` persists displayName/title/location/avatar/cover + structured `about` → `aboutJson`; `MediaPurpose.cover` + `covers` bucket; null avatar/cover = UI defaults; public DTO keeps cover/About, omits email/phone |
| Media | Nest-owned `media_assets` + signed uploads (`avatars`, `covers`, portfolio, services, posts, messages) |
| Portfolio / services | CRUD + visitor reads |
| Marketplace | Listings, applications, work requests, engagements, explore lists |
| **Jobs / Work Requests / Engagements** | **Frozen pre-real-payment core.** Selection does not create an engagement. Explicit acceptance creates `pending_payment`. Delivery, Request Changes, redelivery, and Dispute are distinct. |
| **Mock Payments** | **Frozen development foundation.** `PAYMENT_PROVIDER=mock`. Charges `chargeableTotal`. Same-key replay does not call the provider again. Production boot refuses mock. |
| **Mock Invoices** | **Frozen development foundation.** Watermarked test PDF after a successful mock payment. Not fiscal invoicing. Invoice failure does not reverse payment. |
| **Reviews** | **Frozen.** Both parties, completed engagements only, unique per reviewer, 0–4 JPEG/PNG, `reviewState`, reviewee aggregates. |
| Messaging foundation | Conversations, messages, attachments, unread |
| Connections | Requests + accepted graph |
| Notifications foundation | List / unread / mark read / routing payloads |
| Money + location model | SA→SAR / AE→AED; commercial snapshots; negotiation freezes currency |
| Commercial Model | Frozen in `COMMERCIAL_MODEL.md` |
| **Posts + Hybrid Home Feed** | Nest `PostsModule`; hybrid 70/30 feed; dual cursor; likes/comments/saves; likes list; `MediaPurpose.post`; social notifs `post_liked`/`post_commented`; comment delete (author\|owner); comment report UI deferred backend — see [`POSTS_FEED.md`](./POSTS_FEED.md). **API E2E pass; Expo/Railway E2E pending freeze gate.** |
| Public visitor profile | `GET /users/:id` + `/public` omit email/phone; `/users/me` remains private |

Marketplace commercial semantics and messaging/notifications foundations must not be redesigned casually. New surfaces must conform to the canonical docs above. **Do not redesign the Auth contract** without an explicit unfreeze.

---

## Current focus (ordered)

1. **Manual Profile Expo E2E** + residual polish
2. **Real payment provider** — only after the in-flight second-key rule below and Account Lifecycle hardening
3. **Explore** polish
4. **Notifications** polish (grouping / push; `post_liked`/`post_commented` already wired in-app)
5. **Settings**
6. **Stories** decision (still deferred unless product forces it)
7. **Stabilization / QA** (concurrency, empty/error states, authz edges)
8. **Account Lifecycle / User Deletion Hardening** — **HARD PREREQUISITE** before real-money payments (see below; **do not implement now**)
9. **Wallet / escrow / payouts** — blocked until (8) and a real provider
10. **Admin Panel Dashboard**
11. **Guest browsing**
12. **Production hardening** (rate limits, observability, SMS/OTP production, etc.)
13. **Advanced media lifecycle GC** (orphaned uploads / replaced avatar-cover cleanup)

### Required before a real payment provider / real money

Block or attach a **second different idempotency key** while another Payment on the same Engagement is `pending` or `processing`.

The mock provider prevents two successful settlements. A live provider must also prevent two charge attempts. Do not implement this until the real provider is scheduled.

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
| Account Lifecycle / production Delete Account | Soft-delete + anonymize + retain commercial/financial history; **required before real-money payments** — see section above |
| Real payment provider, native Apple Pay, Wallet, payouts | Mock provider is the development foundation only |
| Second idempotency key while a payment is in flight | **Required before real money.** Not required to keep the mock provider |
| Real fiscal invoicing | Mock PDFs are watermarked test documents |
| Guest browsing | Not built |
| Admin Panel | Not built |
| Commercial time-of-day scheduling | Deadlines are dates only |
| Android in-app PDF renderer | Android opens the signed PDF URL externally |
| Broader UI polish, clickable chat links, Connections audit | Later |
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
