# Development seed environment

Idempotent script that populates a **profiles + media + marketplace (Phase 1–3) demo** through the real stack:

Supabase Auth (admin, email pre-confirmed) → Prisma domain tables → Storage media → marketplace (listings, applications, engagements / work requests).

After one run you can sign in as Layla or Najd and exercise profiles, portfolio, services, Explore, jobs, applications, and engagements without creating data by hand.

**Not seeded:** messaging threads, connection graph, or notification history (those modules are live in Nest but not part of this seed). Currency/location on seed users follows [`COMMERCIAL_MODEL.md`](./COMMERCIAL_MODEL.md) (Layla SA/SAR, Najd AE/AED). Marketplace UX labels: [`MARKETPLACE_CANONICAL_FLOW.md`](./MARKETPLACE_CANONICAL_FLOW.md).

## Run

From `mawahib-backend` (with local `.env`):

```bash
# Required safety flag
export ALLOW_DEV_SEED=true

npm run seed:dev
```

Or set in `.env`:

```env
ALLOW_DEV_SEED=true
# Optional override (defaults to MawahibDev1!)
# DEV_SEED_PASSWORD=MawahibDev1!
```

Then:

```bash
npm run seed:dev
```

## Reset / reseed

1. Ensure migrations are applied:

```bash
npx prisma migrate deploy
```

2. Re-run the seed (safe to repeat):

```bash
ALLOW_DEV_SEED=true npm run seed:dev
```

The seed **replaces** content owned by the two known `@mawahib.dev` users (portfolio, services, `dev-seed/` media, listings/applications/engagements involving them). It does **not** wipe unrelated users.

To fully wipe the remote database, use your Supabase project reset / SQL tools — never point this seed at production.

## Safety

| Guard | Behavior |
|-------|----------|
| `ALLOW_DEV_SEED=true` | **Required** or the script exits |
| Known emails only | `layla.talent@mawahib.dev`, `najd.studio@mawahib.dev` |
| Deterministic IDs | Re-runs upsert/replace instead of duplicating |
| Production | Allowed only if you deliberately set `ALLOW_DEV_SEED=true` (prints a warning) |

Never enable `ALLOW_DEV_SEED` in a real production deployment.

## Default users

| Role | Name | Email | Username | Password |
|------|------|-------|----------|----------|
| Talent | Layla AlHarbi | `layla.talent@mawahib.dev` | `layla_talent_dev` | `DEV_SEED_PASSWORD` or `MawahibDev1!` |
| Business | Najd Creative Studio | `najd.studio@mawahib.dev` | `najd_studio_dev` | same |

| User | Location | Country code | Default currency | UI money prefix |
|------|----------|--------------|------------------|-----------------|
| Layla | Riyadh, Saudi Arabia | `SA` | `SAR` | `SAR` |
| Najd | Dubai, United Arab Emirates | `AE` | `AED` | `Dhs` |

Currency is derived from country (`SA` → `SAR`, `AE` → `AED`). Seeded services, job listings, and commercial snapshots use each account’s default currency (Layla → SAR, Najd → AED).

Both accounts are email-confirmed via the Auth admin API. OTP/SMS delivery is not required for these users.

## What gets created

### Profiles

- Bio, title, location, skills, verification flags
- Avatar + cover uploaded to the public `avatars` Storage bucket
- Stats (followers / following / posts / rating)
- Structured **about** JSON: languages, education, experience, certifications

### Portfolio & services

- **Layla:** 4 portfolio projects, 3 published services (Basic / Standard / Premium + add-ons)
- **Najd:** 4 portfolio projects, 3 published services (packages + add-ons)
- Images uploaded to private `portfolio` / `services` buckets with `media_assets` rows (`ready`)

### Marketplace

- **9 job listings** across draft / open / archived / closed / in_progress / completed
- **7 applications** from Layla (submitted, under_review, accepted, rejected)
- **19 work requests** — the unified Jobs inbox — covering all three sources
  (job posting, service request, direct request) in `pending`,
  `changes_requested`, `rejected`, and `pending_payment`, in both directions
  (Sent and Received) for each user
- **9 work engagements** (pending_payment, in_progress, delivered, completed)
  with event timelines, linked back to their work request

Accepted requests sit at `pending_payment`; the seed only advances older
engagements past it, because real payments arrive in Phase 5. See
`docs/MARKETPLACE_WORK_REQUESTS.md` for the state machine.

### Explore

Backend endpoints (JWT):

- `GET /api/v1/explore/talents`
- `GET /api/v1/explore/businesses`
- `GET /api/v1/explore/services`
- Open jobs via `GET /api/v1/job-listings?status=open`

The mobile Explore/Home screens load these — not marketplace mocks.

## Manual test checklist

After seeding and signing in:

- [ ] Login works (Layla and Najd)
- [ ] Own profile / about / stats load
- [ ] Portfolio + services load (own + visitor)
- [ ] Explore shows real jobs, talents, businesses, services
- [ ] Layla can apply to remaining open jobs
- [ ] Najd can review applications and see engagements
- [ ] Jobs inbox shows Sent and Received work requests with unread badges
- [ ] Accepting a request creates an engagement at `pending_payment`
- [ ] Session restore still returns Nest `/users/me`
- [ ] No marketplace mock seed data appears in Jobs/Explore

## OTP / email / SMS

**Email OTP** is the canonical signup path in the app (see `mawahib-ui-prototype/docs/AUTH.md`).

Seed users remain pre-confirmed for local development so you can skip OTP when using seed accounts.

**Phone OTP / Twilio** remain optional — configure in the Supabase Dashboard before enabling `EXPO_PUBLIC_PHONE_AUTH_ENABLED`.

**Password reset** and **social/OAuth** are not implemented in the app UI (controls hidden); seed docs must not describe them as available product flows.
