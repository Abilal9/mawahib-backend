# Mawahib roadmap (current)

**Status:** Living status document — prefer this over phase tables in older blueprints  
**Last reviewed:** 2026-08-19

Canonical product rules:

- Money / currency / commercial snapshots → [`COMMERCIAL_MODEL.md`](./COMMERCIAL_MODEL.md)
- Marketplace UX → [`MARKETPLACE_CANONICAL_FLOW.md`](./MARKETPLACE_CANONICAL_FLOW.md)
- Work request technical contract → [`MARKETPLACE_WORK_REQUESTS.md`](./MARKETPLACE_WORK_REQUESTS.md)

---

## Completed / frozen

| Area | Notes |
|------|--------|
| Architecture foundation | Nest → services → repositories → Prisma → Postgres; Supabase Auth + Storage only |
| Auth / profiles | JWKS JWT, bootstrap, `/users/me` |
| Media | Nest-owned `media_assets` + signed uploads |
| Portfolio / services | CRUD + visitor reads |
| Marketplace | Listings, applications, work requests, engagements, explore lists |
| Messaging foundation | Conversations, messages, attachments, unread |
| Connections | Requests + accepted graph |
| Notifications foundation | List / unread / mark read / routing payloads |
| Money + location model | SA→SAR / AE→AED; commercial snapshots; negotiation freezes currency |
| Commercial Model | Frozen in `COMMERCIAL_MODEL.md` |

Marketplace commercial semantics and messaging/notifications foundations must not be redesigned casually. New surfaces must conform to the canonical docs above.

---

## Current focus (ordered)

1. **Home Feed**
2. **Posts** (Nest + Prisma; replace FE mock)
3. **Profile completion** (persisted about sections, polish)
4. **Reviews** (product list + aggregates beyond engagement bridge)
5. **Job editing**
6. **Request attachments** (supporting documents on work requests)
7. **Explore polish**
8. **Settings**
9. **Stabilization** (concurrency, empty/error states, authz edges)
10. **Escrow / Payments** (consume frozen `chargeableTotal` / commercial terms)
11. **Admin Panel Dashboard**
12. **Production hardening** (rate limits, observability, SMS/OTP production, etc.)

---

## Explicitly deferred

| Item | Why |
|------|-----|
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
