# Work requests — the unified Jobs inbox

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
changes_requested ┼──────────────── rejected (sender declines changes)
      │           │
      │           └──────────────── withdrawn (sender)
      │
      ▼ (sender accepts changes)          (recipient accepts)
   pending_payment ◄──────────────────────── pending
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
| `changes_requested` | `rejected` | sender (decline changes) or recipient |
| `changes_requested` | `withdrawn` | sender |
| `pending_payment` / `rejected` / `withdrawn` | — | terminal |

`pending_payment` is the accepted terminal state. There is no `accepted` status:
acceptance is the act of creating the engagement, and money is what moves it
forward.

### Terms

`termsJson` is the original snapshot (title, scope, price label, currency,
deadline label, notes, plus source extras such as package tier and add-ons).
Requesting changes writes `proposedTermsJson` (merged on top of the original) and
records `proposedByUserId` / `proposalComment`. Accepting freezes
`agreedTermsJson`, which is what the engagement is built from. Declined
proposals stay on the row so both parties can still read what was offered.

Prices are free-text labels (e.g. `SAR 12,000 project`) — the marketplace does
not compute or move money yet.

## Engagements and payment

Accepting a request creates a `WorkEngagement` at **`pending_payment`**, never at
`in_progress`. The API refuses `pending_payment → in_progress`; that transition
belongs to **Phase 5**, where a settled payment will advance the engagement.
Delivery is only possible from `in_progress`, and only by the provider.

Accepting does *not*:

- move the listing to `in_progress`
- auto-reject other applicants

A listing owner can accept several applicants; each accepted request becomes its
own engagement awaiting payment.

## Closing a listing

Transitioning a listing to `closed` rejects every `pending` /
`changes_requested` work request on it, each with a `listing_closed` event.
Existing engagements are untouched, and the listing no longer accepts
applications.

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
| `POST` | `/work-requests/service` | `serviceOfferingId`, `packageTier?`, `addonIds?`, `notes?`, `deadlineLabel?`, `price?` |
| `POST` | `/work-requests/direct` | `recipientUserId`, `title`, `scope?`, `price?`, `currency?`, `deadlineLabel?`, `message?` |
| `GET` | `/work-requests/:id` | Either party |
| `POST` | `/work-requests/:id/view` | Marks the viewer's side read |
| `POST` | `/work-requests/:id/accept` | Recipient; returns request + engagement |
| `POST` | `/work-requests/:id/request-changes` | Recipient; `proposedTerms`, `comment?` |
| `POST` | `/work-requests/:id/accept-changes` | Sender; returns request + engagement |
| `POST` | `/work-requests/:id/decline-changes` | Sender; `comment?` |
| `POST` | `/work-requests/:id/reject` | Recipient; `comment?` |
| `POST` | `/work-requests/:id/withdraw` | Sender; `comment?` |
| `GET` | `/users/me/work-requests?direction=sent\|received&status=` | Inbox list |
| `GET` | `/users/me/work-requests/unread-summary` | `{ sentUnread, receivedUnread }` |

All routes sit behind the JWT guard and the `api/v1` global prefix.

Legacy paths still work: `PATCH /applications/:id` with `accepted` accepts the
linked work request (creating one on the fly for pre-migration rows), and
`rejected` / `withdrawn` keep the request in sync.

## Data model

- `work_requests` — the negotiation, with optional links to `job_listings`,
  `job_applications` (unique), `service_offerings`, and `work_engagements`
  (unique). The engagement link lives only here, so there is no dual FK.
- `work_request_events` — append-only timeline (`created`, `changes_requested`,
  `changes_accepted`, `changes_declined`, `accepted`, `rejected`, `withdrawn`,
  `viewed`, `listing_closed`, `note`).

Both tables follow the phase 3 Supabase posture: privileges revoked from `anon`
and `authenticated`, RLS enabled, all access through the Nest service role.

Migration `20260813160000_work_requests` creates the tables and backfills every
existing application and engagement, so no marketplace history is lost.
