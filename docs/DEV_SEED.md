# Development seed users

Idempotent script that creates **two** complete Mawahib development users through the real stack:

Supabase Auth (admin, email pre-confirmed) → Prisma `users` / `profiles` → portfolio / services / media.

## Run

From `mawahib-backend` (with `.env` loaded locally):

```bash
npm run seed:dev
```

Optional env:

| Variable | Purpose |
|----------|---------|
| `DEV_SEED_PASSWORD` | Shared password for both users (must meet app policy). Default used only if unset — do not commit real passwords. |
| `ALLOW_DEV_SEED=true` | Required to run when `NODE_ENV=production`. |

## Safety

- Refuses production unless `ALLOW_DEV_SEED=true`
- Only touches known `@mawahib.dev` accounts
- Portfolio/services titles are prefixed with `[DEV]` and replaced on each run
- Does **not** delete unrelated users or data

## OTP / email / SMS

Full OTP delivery, SMTP, and Twilio/SMS configuration are **intentionally deferred**. These seed users are email-confirmed via the Auth admin API for local development only. Production signup verification is unchanged.

See `docs/AUTH.md` for the later checklist.
