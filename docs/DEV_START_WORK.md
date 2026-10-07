# DEV-ONLY: Start work without payment (deprecated)

> **Deprecated.** The normal path from `pending_payment` to `in_progress` is now
> `POST /api/v1/payments` backed by `MockPaymentProvider` (see below). Prefer it —
> it exercises the real settlement code (idempotency, chargeable-total amount,
> invoice generation). `dev-start-work` is a gated escape hatch. Leave
> `ENABLE_DEV_START_WORK=false`. Mock payment is the normal local path.

## Preferred path: mock payments

Engagements enter `pending_payment` after the work request is accepted (for job
postings: the poster selects the applicant, then the talent accepts). The client
(payer) then calls:

```http
POST /api/v1/payments
{
  "engagementId": "<uuid>",
  "method": "card" | "apple_pay",
  "mockMethodToken": "mock_visa_success",
  "idempotencyKey": "<client-generated, 8-128 chars>"
}
```

- The amount and currency are **always** the engagement's chargeable total
  (package + add-ons). Any client-sent amount is rejected by validation.
- No card number / CVV fields exist; the API only accepts an opaque mock token.
- Tokens: `mock_visa_success`, `mock_mastercard_success`, `mock_card_declined`
  (all `card`), `mock_apple_pay_success`, `mock_apple_pay_declined`
  (both `apple_pay`).
- Success: payment `succeeded`, engagement → `in_progress` (server-side), work chat
  opens, and a watermarked **TEST INVOICE** PDF is generated asynchronously
  (`GET /engagements/:id/invoices`, `GET /invoices/:id/document`).
- Decline: payment `failed`, engagement stays `pending_payment`; retry with a new
  idempotency key.
- Reusing an idempotency key returns the same payment and does not call the
  provider again. If that payment is still `pending` or `processing`, the API
  re-reads it briefly and may return that in-flight status. The app polls the
  same payment and keeps the key. A declined payment is retried with a **new**
  key. A new key after success is rejected.
- **Required before real money:** a second, different idempotency key must be
  blocked or attached while another payment for the same engagement is still
  `pending` or `processing`. Do not treat the current mock settlement lock as
  enough for a live provider.

Env: `PAYMENT_PROVIDER=mock` / `INVOICE_PROVIDER=mock` (the defaults). The app
**refuses to boot** when `NODE_ENV=production` and `PAYMENT_PROVIDER=mock`.

## Legacy bypass: `dev-start-work`

`POST /api/v1/engagements/:id/dev-start-work` is allowed only when **both** are true:

1. `NODE_ENV` is **not** `production`
2. `ENABLE_DEV_START_WORK=true`

Otherwise the endpoint returns `403 Forbidden`.

### Behavior

- Caller must be the engagement client or provider
- Engagement must be `pending_payment`
- Transitions to `in_progress` **without** recording a payment or invoice
- Creates/opens the work conversation + system message via `MessagingService.onEngagementBecameInProgress`
- Notifies the other party (`engagement_status`)

### Local setup

In `.env` (leave it `false`/unset unless you really need the bypass):

```bash
ENABLE_DEV_START_WORK=true
```

Never enable this on Railway/production.

## Remove when

All clients pay through `POST /payments`. Delete this endpoint, `devStartWork`,
the env flag, and this doc.

---

## Related: messaging archive

Completed work chats stay in the inbox (read-only) until the user rates.
Per-user archive / soft-delete is documented in [MESSAGING_ARCHIVE.md](./MESSAGING_ARCHIVE.md).
