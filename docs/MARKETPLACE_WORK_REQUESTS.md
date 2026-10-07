# Work requests — the unified Jobs inbox

> **User-facing terminology and workflow are defined in
> [`MARKETPLACE_CANONICAL_FLOW.md`](./MARKETPLACE_CANONICAL_FLOW.md).**  
> **Money, currency snapshots, `termsTotal` / `chargeableTotal`, and package vs
> add-on rules are defined in [`COMMERCIAL_MODEL.md`](./COMMERCIAL_MODEL.md).**
> This file documents technical API, schema, and state-machine details.
> Prefer canonical labels in product UI (`Pending Payment`, `Cancel Request`,
> `Cancelled`, never `Awaiting Payment` / `Withdraw` / `Withdrawn`).

A **work request** is the single negotiation entity behind every deal in the
marketplace, whatever the entry point: a job application, a service booking, or
a cold direct request. Job listings, applications, and engagements still exist —
they are the *source links* around the request, not parallel inboxes.

```
JobListing ─┐
            ├─ WorkRequest ──(accepted)──> WorkEngagement ──> delivery / completion
ServiceOffering ─┤
(direct) ───┘
```

## Roles on a request

| Field | Meaning |
|-------|---------|
| `senderUserId` | Who initiated. Drives the **Sent** tab. |
| `recipientUserId` | Who received. Drives the **Received** tab. |
| `clientUserId` | Who pays. |
| `providerUserId` | Who delivers. |

Direction and commercial roles are deliberately separate: when talent applies to
a listing the applicant is the *sender* but the *provider*, while the poster is
the *recipient* and the *client*. For service and direct requests the sender is
the client.

| Source | Sender | Recipient | Client | Provider |
|--------|--------|-----------|--------|----------|
| `job_posting` | applicant | listing poster | listing poster | applicant |
| `service_request` | requester | service owner | requester | service owner |
| `direct_request` | requester | recipient | requester | recipient |

## State machine

```
                  ┌──────────────── withdrawn (sender Cancel Request)
                  │
   pending ───────┼──────────────── rejected (recipient)
      │           │
      │ (recipient proposes)          ← turn moves to sender
      ▼           │
changes_requested ┼──────────────── withdrawn (sender Cancel Request)
      │
      │ (sender Decline Changes — turn returns to recipient)
      ▼
changes_declined ─┼──────────────── rejected (recipient)
      │           ├──────────────── withdrawn (sender Cancel Request)
      │           └──────────────── changes_requested (recipient proposes again)
      │
      ▼ (recipient Accept Original Terms)  (sender Accept Changes)
   pending_payment ◄──────────────────── changes_requested
      ▲
      └────────── also from pending (recipient Accept)
      │
      └── creates WorkEngagement at `pending_payment`
```

Negotiation is **strictly turn-based**: one decision maker at a time. See
`MARKETPLACE_CANONICAL_FLOW.md` §2–5.

Allowed transitions:

| From | To | Who |
|------|----|-----|
| `pending` | `pending_payment` | recipient (accept) |
| `pending` | `changes_requested` | recipient (request changes) |
| `pending` | `rejected` | recipient |
| `pending` | `withdrawn` | sender (Cancel Request) |
| `changes_requested` | `pending_payment` | sender (accept changes) |
| `changes_requested` | `changes_declined` | sender (decline changes — not terminal) |
| `changes_requested` | `pending` (or prior `changes_declined`) | recipient (Withdraw Change Request via overflow) |
| `changes_requested` | `withdrawn` | sender (Cancel Request) |
| `changes_declined` | `pending_payment` | recipient (accept original terms) |
| `changes_declined` | `changes_requested` | recipient (propose again) |
| `changes_declined` | `rejected` | recipient |
| `changes_declined` | `withdrawn` | sender (Cancel Request) |
| `pending_payment` | `withdrawn` | sender (Cancel Request before work starts) |
| `pending_payment` / `rejected` / `withdrawn` | — | terminal (except cancel above) |

**Deprecated:** Reject is forbidden while `changes_requested`. Primary
negotiation remains turn-based; **Withdraw Change Request** is a secondary
overflow action for the waiting proposer (`POST …/cancel-changes`).

**Decline Changes ≠ Reject Request.** Declining returns the negotiation to the
recipient with an optional message; the request stays open under
`changes_declined`. Rejecting ends the request.

`pending_payment` is the accepted terminal state. There is no `accepted` status:
acceptance is the act of creating the engagement, and money is what moves it
forward.

### Terms

Terms are **structured** — no free-text money or deadline labels:

```ts
type WorkRequestTerms = {
  title: string;
  scope: string;
  money: { amount: number; currency: string } | null; // currency: SAR|AED snapshot; see COMMERCIAL_MODEL.md
  deadline:
    | { type: 'exact_date'; startDate: string }               // YYYY-MM-DD
    | { type: 'date_range'; startDate: string; endDate: string }
    | { type: 'duration'; durationValue: number; durationUnit: 'days' | 'weeks' | 'months' }
    | { type: 'flexible' };
  notes: string;
  location?: string | null;
  employmentType?: string | null;
  packageTier?: string | null;
  packageName?: string | null;
  addons?: Array<{ id: string; title: string; money: { amount: number; currency: string } }>;
};
```

`money` is `null` when no amount is agreed yet (e.g. a listing whose salary
label carries no number). Display strings are derived, never stored:
`formatMoney` → `SAR 3,500`, `formatDeadline` → `May 9, 2027` | `May 6 – May 9` |
`3 days` | `Flexible`. `work-request-terms.ts` owns the shape, the legacy
`{ price, currency, deadlineLabel }` reader, `validateDeadline`, and both
formatters; `validateDeadline` is what the DTO validator and the service share.

`termsJson` is the **immutable** original snapshot — it is never overwritten.
Requesting changes writes `proposedTermsJson` (deep-merged on top of the
original: a partial `money` may change **amount** but **currency is frozen**
from the original snapshot — clients cannot switch SAR↔AED via negotiation;
a same-type
`deadline` patch merges field by field, a new `deadline.type` replaces it) and
records `proposedByUserId` / `proposalComment`. The `changes_requested` and
`changes_declined` events both carry `{ previousTerms, proposedTerms }` so every
round is auditable from the timeline alone. Declining clears the active
proposal columns (history remains on events) and moves to `changes_declined`.
Accepting freezes `agreedTermsJson`, which is what the engagement is built from
(its detail row takes `money.amount` / `money.currency` and the formatted
deadline label).

Money moves only through `POST /api/v1/payments`. The party API cannot start work.

Rows written before the structured migration keep working: `parseTerms` accepts
the legacy shape, mapping the first number in a price label to `money.amount`
and only turning `"<n> days|weeks|months"` labels into a duration (no dates are
invented — anything else becomes `flexible`). Migration
`20260813170000_work_request_terms_structured` normalises existing rows in place;
the JSON columns themselves are unchanged.

## Engagements and payment

Selecting a job applicant does **not** create an engagement. The engagement is
created only when the party who may accept the work request explicitly accepts
the final terms (original terms, or proposed terms via accept-changes).

- Job posting: the listing owner selects the applicant. The applicant (sender)
  accepts.
- Service request and direct request: the recipient accepts.

Acceptance creates one `WorkEngagement` at **`pending_payment`**. It does not
start work and does not move the listing to `in_progress`.

The accept write is one interactive transaction: lock the work request, require
the status the service already authorized, refuse a second engagement, create
the engagement, and link it. The large response graph is loaded **after**
commit. A concurrent accept cannot create two engagements: one call succeeds
and the other receives a conflict. A failed write rolls back; a failed read
after commit does not.

`pending_payment → in_progress` is server-only, performed by `PaymentsService`
after a successful payment. Parties cannot call that transition.

Party-callable engagement transitions:

| From | To | Who | Meaning |
|------|----|-----|---------|
| `in_progress` | `delivered` | provider | Delivery. Repeatable after Request Changes. |
| `delivered` | `completed` | client | Complete / accept the work |
| `delivered` | `in_progress` | client | Request Changes. A note is required. Not a dispute. |
| `delivered` | `disputed` | client | Dispute. A reason is required. |
| `disputed` | `completed` | client | Client may still complete |

Provider cannot pay, complete, request changes, or dispute. Client cannot
deliver. Attachments stay editable through `pending_payment` and `in_progress`.
Once the engagement is `delivered`, `disputed`, or `completed`, attachments
remain viewable and cannot be added or removed.

`WorkEngagementStatus` also contains legacy values (`requested`, `accepted`,
`declined`, `cancelled`, `payment_failed`). New commercial work is created at
`pending_payment`.

The amount charged is `chargeableTotal`: the accepted package/base snapshot
plus selected add-on snapshots. It is computed from `EngagementDetail`, not
copied from the live service. A later catalog price edit does not rewrite it.

## Closing / archiving / deleting a listing

Transitioning a listing to `closed` or `archived`, or soft-deleting it, rejects
every still-open work request (`pending`, `changes_requested`,
`changes_declined`) with a `listing_closed` event and syncs linked applications
to `rejected`. Existing engagements are untouched. Reopen does not resurrect
rejected requests.

## Unread / inbox badge

Each side has its own read marker (`senderLastViewedAt`, `recipientLastViewedAt`).
A request is unread for a viewer when `updatedAt > lastViewedAt` (a null marker
counts as unread). To keep this honest:

- creating a request sets `senderLastViewedAt = now`, leaving
  `recipientLastViewedAt` null
- acting on a request (accept, reject, propose, withdraw) sets the *actor's*
  marker, so only the other party sees it as new
- `POST /work-requests/:id/view` updates the viewer's marker without bumping
  `updatedAt`

## Pricing, payments, reviews, and files

Initial service requests send `serviceOfferingId`, `packageTier`, and `addonIds`.
The server snapshots catalog package and add-on prices. Later negotiation uses
`proposedTerms.money` and is a different trust boundary.

`POST /payments` is `PaymentsController` → `PaymentsService` → `PaymentRepository`
→ `PaymentProvider`. Development uses `MockPaymentProvider`
(`PAYMENT_PROVIDER=mock`). Boot refuses `NODE_ENV=production` with that provider.

Payment statuses: `pending`, `processing`, `succeeded`, `failed`, `cancelled`.

The same `idempotencyKey` is one payment attempt. A replay does not call the
provider again. If the row is still `pending` or `processing`, the server
re-reads it briefly and may return that in-flight status on HTTP 201. The app
polls `GET /payments/:id` and keeps the same key. `failed` or `cancelled` is
retried with a new key. A new key after `succeeded` is rejected.

**Required before a real payment provider / real money:** block or attach a
second, different idempotency key while another payment on the same engagement
is `pending` or `processing`. The mock provider already prevents two successful
settlements. A live provider must also prevent two charge attempts.

Invoice generation is `InvoicingProvider` → `MockInvoicingProvider`. The PDF is
a watermarked test document (`InvoiceStatus`: `pending`, `generated`, `failed`).
An invoice failure does not reverse a successful payment.

Reviews belong to a completed engagement. Both parties may review the other
party once (`engagementId` + `reviewerId`). The server returns `reviewState`:
`canReview`, `myReview`, `otherPartyReview`. `canReview` is true only for a
party, after `completed`, with no review by that viewer yet. A duplicate submit
returns the original review. Up to 4 images, `image/jpeg` or `image/png`,
purpose `review`. Each new review updates the reviewee's `ratingCount` and
`ratingAvg`.

Media path: the app asks Nest for an upload session, uploads to the signed
Supabase Storage URL, then Nest records `MediaAsset` and the domain link.
`MediaPurpose`: `avatar`, `portfolio`, `service`, `message`, `post`, `cover`,
`work_request`, `invoice`, `review`. Clients cannot open an `invoice` upload
session; the server writes those PDFs. Images open in-app. iOS PDFs use an
in-app WebView. Android PDFs open the signed URL in the system handler. Invoice
PDFs follow that same rule.

Deadlines are `exact_date`, `date_range`, `duration`, or `flexible`. Only the
active mode's fields are kept. The app disables past dates and does not offer a
time of day. The API rejects a past date (business calendar, Asia/Riyadh). The
visible month is the device's current month.

Location links, in order: an explicit HTTPS Google Maps URL
(`maps.app.goo.gl`, `maps.google.*`, or `google.* /maps`), then coordinates when
stored, then an encoded Maps search of the place text, otherwise no link. A
valid Maps URL is stored and opened unchanged. Other URL schemes are rejected.

## API

| Method | Path | Notes |
|--------|------|-------|
| `POST` | `/job-listings/:id/applications` | Creates application **and** work request; returns both |
| `POST` | `/work-requests/service` | `serviceOfferingId`, `packageTier?`, `addonIds?`, `notes?`, `money?`, `deadline?` |
| `POST` | `/work-requests/direct` | `recipientUserId`, `title`, `scope?`, `money?`, `deadline?`, `message?` |
| `GET` | `/work-requests/:id` | Either party |
| `POST` | `/work-requests/:id/view` | Marks the viewer's side read |
| `POST` | `/work-requests/:id/accept` | Recipient; returns request + engagement |
| `POST` | `/work-requests/:id/request-changes` | Recipient; `proposedTerms` (partial `title` / `scope` / `notes` / `money` / `deadline`), `comment?` |
| `POST` | `/work-requests/:id/accept-changes` | Sender; returns request + engagement |
| `POST` | `/work-requests/:id/decline-changes` | Sender; `comment?` |
| `POST` | `/work-requests/:id/cancel-changes` | Recipient Withdraw Change Request (overflow); restores prior open status |
| `POST` | `/work-requests/:id/reject` | Recipient on their turn (`pending` / `changes_declined`); `comment?` |
| `POST` | `/work-requests/:id/withdraw` | Sender **Cancel Request** (status `withdrawn`, UI: Cancelled); `comment?` |
| `GET` | `/users/me/work-requests?direction=sent\|received&status=` | Inbox list |
| `GET` | `/users/me/work-requests/unread-summary` | `{ sentUnread, receivedUnread }` |

All routes sit behind the JWT guard and the `api/v1` global prefix.

The create endpoints still accept the deprecated `price` / `currency` /
`deadlineLabel` strings as a fallback for older clients; structured `money` /
`deadline` always win when both are sent.

Legacy paths still work: `PATCH /applications/:id` with `accepted` accepts the
linked work request (creating one on the fly for pre-migration rows), and
`rejected` / `withdrawn` keep the request in sync.

## Data model

- `work_requests` — the negotiation, with optional links to `job_listings`,
  `job_applications` (unique), `service_offerings`, and `work_engagements`
  (unique). The engagement link lives only here, so there is no dual FK.
- `work_request_events` — append-only timeline (`created`, `changes_requested`,
  `changes_accepted`, `changes_declined`, `changes_cancelled`, `accepted`,
  `rejected`, `withdrawn`, `viewed`, `listing_closed`, `note`).

Both tables follow the phase 3 Supabase posture: privileges revoked from `anon`
and `authenticated`, RLS enabled, all access through the Nest service role.

Migration `20260813160000_work_requests` creates the tables and backfills every
existing application and engagement, so no marketplace history is lost.
