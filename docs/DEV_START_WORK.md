# DEV-ONLY: Start work without payment

**Temporary until Phase 5 (Payments).**

## Why

Engagements enter `pending_payment` after a work request is accepted. Production
flow must wait for a settled payment before `in_progress` (and before the work
chat opens). Until Phase 5 ships, local/dev clients need a safe bypass to exercise
messaging and delivery flows.

## Gate

`POST /api/v1/engagements/:id/dev-start-work` is allowed only when **both** are true:

1. `NODE_ENV` is **not** `production`
2. `ENABLE_DEV_START_WORK=true`

Otherwise the endpoint returns `403 Forbidden`.

## Behavior

- Caller must be the engagement client or provider
- Engagement must be `pending_payment`
- Transitions to `in_progress` (same repository path as normal transitions)
- Creates/opens the work conversation + system message via `MessagingService.onEngagementBecameInProgress`
- Notifies the other party (`engagement_status`)

## Local setup

In `.env`:

```bash
ENABLE_DEV_START_WORK=true
```

Never enable this on Railway/production.

## Remove when

Phase 5 payment webhook / settle path advances `pending_payment → in_progress`
server-side and opens work chat. Delete this endpoint, `devStartWork`, the env
flag, and this doc.

---

## Related: messaging archive

Completed work chats stay in the inbox (read-only) until the user rates.
Per-user archive / soft-delete is documented in [MESSAGING_ARCHIVE.md](./MESSAGING_ARCHIVE.md).
