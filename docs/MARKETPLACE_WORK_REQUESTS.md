# Work requests — the unified Jobs inbox

> **User-facing terminology and workflow are defined in
> [`MARKETPLACE_CANONICAL_FLOW.md`](./MARKETPLACE_CANONICAL_FLOW.md).**
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
                  ┌──────────────── withdrawn (sender)
                  │
   pending ───────┼──────────────── rejected (recipient)
      │           │
      │ (recipient proposes)
      ▼           │
changes_requested ┼──────────────── rejected (sender Reject Request, or recipient)
      │           │
      │           └──────────────── withdrawn (sender)
      │
      │ (sender Decline Changes — request stays open)
      ▼
changes_declined ─┼──────────────── rejected (recipient)
      │           ├──────────────── withdrawn (sender)
      │           └──────────────── changes_requested (recipient proposes again)
      │
      ▼ (recipient accepts original)     (sender accepts changes)
   pending_payment ◄──────────────────── changes_requested
      ▲
      └────────── also from pending (recipient accepts)
      │
      └── creates WorkEngagement at `pending_payment`
```

Allowed transitions:

| From | To | Who |
|------|----|-----|
| `pending` | `pending_payment` | recipient (accept) |
| `pending` | `changes_requested` | recipient (request changes) |
| `pending` | `rejected` | recipient |
| `pending` | `withdrawn` | sender |
| `changes_requested` | `pending_payment` | sender (accept changes) |
| `changes_requested` | `changes_declined` | sender (decline changes — not terminal) |
| `changes_requested` | `pending` (or prior `changes_declined`) | recipient (cancel their own change request) |
| `changes_requested` | `rejected` | sender (Reject Request) or recipient |
| `changes_requested` | `withdrawn` | sender (API retained; negotiation UI uses Cancel Change Request instead) |
| `changes_declined` | `pending_payment` | recipient (accept original terms) |
| `changes_declined` | `changes_requested` | recipient (propose again) |
| `changes_declined` | `rejected` | recipient |
| `changes_declined` | `withdrawn` | sender |
| `pending_payment` / `rejected` / `withdrawn` | — | terminal |

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
  money: { amount: number; currency: string } | null; // currency: 3 letters, default SAR
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
original: a partial `money` inherits the original currency, a same-type
`deadline` patch merges field by field, a new `deadline.type` replaces it) and
records `proposedByUserId` / `proposalComment`. The `changes_requested` and
`changes_declined` events both carry `{ previousTerms, proposedTerms }` so every
round is auditable from the timeline alone. Declining clears the active
proposal columns (history remains on events) and moves to `changes_declined`.
Accepting freezes `agreedTermsJson`, which is what the engagement is built from
(its detail row takes `money.amount` / `money.currency` and the formatted
deadline label).

Money is still not moved — payments arrive in Phase 5.

Rows written before the structured migration keep working: `parseTerms` accepts
the legacy shape, mapping the first number in a price label to `money.amount`
and only turning `"<n> days|weeks|months"` labels into a duration (no dates are
invented — anything else becomes `flexible`). Migration
`20260813170000_work_request_terms_structured` normalises existing rows in place;
the JSON columns themselves are unchanged.

## Engagements and payment

Accepting a request creates a `WorkEngagement` at **`pending_payment`**, never at
`in_progress`. The API refuses `pending_payment → in_progress`; that transition
belongs to **Phase 5**, where a settled payment will advance the engagement.

Party-callable engagement transitions (JWT API):

| From | To | Who |
|------|----|-----|
| `in_progress` | `delivered` | provider only |
| `delivered` | `completed` | client only |
| `pending_payment` / `payment_failed` / legacy `accepted`/`requested` | `cancelled` | client only |

Everything else (`payment_failed`, `disputed`, starting work, reopening payment)
is **server-only** and must not be callable by either party.

Accepting does *not*:

- move the listing to `in_progress`
- auto-reject other applicants

A listing owner can accept several applicants; each accepted request becomes its
own engagement awaiting payment. Accept uses a row lock + conditional update so
concurrent accepts cannot create duplicate engagements.

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
| `POST` | `/work-requests/:id/cancel-changes` | Recipient (proposer); retracts outstanding proposal |
| `POST` | `/work-requests/:id/reject` | Recipient; `comment?` |
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
