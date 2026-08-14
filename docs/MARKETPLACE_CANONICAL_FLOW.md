# Marketplace Canonical Flow

**Status:** Canonical · frozen for future phases (v0.3.5)  
**Audience:** Product, design, frontend, backend, messaging, payments, reviews

This document is the single source of truth for Marketplace terminology,
workflow, and UX. Future phases (Messaging, Notifications, Payments, Reviews,
Admin) must conform to it. Do not introduce duplicate Marketplace concepts or
alternate labels for the same action.

Internal API/enum names may differ (e.g. `withdrawn`); **users never see those
names**. Implementation details live in `MARKETPLACE_WORK_REQUESTS.md`.

---

## 1. Terminology

### Work Request statuses (user-facing)

| Label | Internal (if different) |
|-------|-------------------------|
| Pending | `pending` |
| Changes Requested | `changes_requested` |
| Changes Declined | `changes_declined` |
| Pending Payment | `pending_payment` |
| In Progress | engagement `in_progress` |
| Delivered | engagement `delivered` |
| Completed | engagement `completed` |
| Rejected | `rejected` |
| Cancelled | `withdrawn` |

**Do not use in UI:** Awaiting Payment, Withdrawn, Withdraw (alone), Accepted (as a
status), Completed History, Finished Jobs, Cancel Change Request.

### Jobs sections

| Tab | Sections |
|-----|----------|
| Received | Requests · Pending Payment · In Progress · History |
| Sent | Requests · Pending Payment · In Progress · Posted Jobs · History |

**History** is the only archive term. It contains Completed, Rejected, and
Cancelled. History is read-only.

---

## 2. Turn-based negotiation (canonical rule)

At every point during negotiation there is **exactly one decision maker**.

- Never both parties with negotiation actions at once.
- The user who submitted the last proposal is waiting.
- The other user is the only one allowed to respond.
- When it is not a user’s turn: show a short waiting message — **no** disabled
  or hidden action buttons.
- Frontend ownership must come from a single helper (`getNegotiationTurn`); do
  not scatter turn logic across screens.

**Cancel Request** is a sender-only escape hatch through
`pending` / `changes_requested` / `changes_declined` / `pending_payment`.
It ends the whole request → Cancelled / History. It lives in the header
**⋯ overflow menu**, not the footer. It is not a negotiation counter-move.

Once the engagement enters **In Progress** (work started after payment),
Cancel Request disappears from the ⋯ menu. Later disputes/refunds belong to
the Payments phase — do not productize them here.

**Withdraw Change Request** is a secondary overflow action for the waiting
proposer (recipient, while `changes_requested`). It restores the prior open
status and clears the outstanding proposal. It is **not** a primary footer
button and does not give both parties simultaneous negotiation actions.

---

## 3. Primary vs secondary actions

### Primary (footer)

Primary decision actions stay at the bottom of Job Details:

| Status | Decision maker | Footer |
|--------|----------------|--------|
| Pending | Recipient | Accept · Request Changes · Reject Request |
| Changes Requested | Sender | Accept Changes · Decline Changes |
| Changes Requested | Recipient | Waiting message only (no buttons) |
| Changes Declined | Recipient | Accept Original Terms · Request Changes Again · Reject Request |
| Pending Payment+ | Client / Provider | Engagement actions unchanged |

When it is not the viewer’s turn: show the waiting message only — no disabled
buttons.

### Secondary (⋯ overflow menu)

Destructive and administrative actions live in the top-right **⋯** menu only.

| Phase | Menu items |
|-------|------------|
| Open negotiation (`pending` / `changes_requested` / `changes_declined`) | **Cancel Request** (sender) · **Report** |
| Waiting proposer (`changes_requested`, recipient who proposed) | **Withdraw Change Request** · **Cancel Request** (if sender) · **Report** |
| Pending Payment (engagement not started) | **Cancel Request** (sender) · **Report** |
| In Progress / Delivered / Completed | **Report** only |

Frontend ownership for menu items comes from `getWorkRequestOverflowMenu`.

---

## 4. Work Request lifecycle

```
Pending
  → Changes Requested
      → Changes Declined  (negotiation continues; turn returns to recipient)
      → Pending Payment   (sender Accept Changes)
  → Pending Payment       (recipient Accept / Accept Original Terms)
  → In Progress           (Phase 5 — payment settled)
  → Delivered
  → Completed
  → History
```

**Terminal exits into History**

- Rejected
- Cancelled

---

## 5. Canonical buttons

Use exactly these labels:

| Button | Where | Meaning |
|--------|-------|---------|
| Accept | Footer | Recipient accepts current terms from Pending |
| Accept Original Terms | Footer | Recipient accepts after Changes Declined |
| Accept Changes | Footer | Sender accepts a counter-offer |
| Request Changes | Footer | Recipient proposes new terms (from Pending) |
| Request Changes Again | Footer | Recipient proposes again (from Changes Declined) |
| Decline Changes | Footer | Sender rejects a counter-offer; negotiation continues |
| Reject Request | Footer | Recipient ends the request on their turn → Rejected / History |
| Withdraw Change Request | ⋯ menu | Waiting proposer retracts outstanding proposal |
| Cancel Request | ⋯ menu | Sender ends the open request → Cancelled / History |
| Report | ⋯ menu | Opens report sheet (does not change Marketplace state) |
| Mark as Delivered | Footer | Provider marks delivery |
| Complete Job | Footer | Client confirms completion → History |
| Apply | — | Apply to a job listing |
| Send Request | — | Create service or direct work request |
| Publish | — | Publish a job listing |
| Archive | — | Temporarily hide listing (reopenable); closes open negotiations |
| Close | — | Hiring finished; closes open negotiations |
| Reopen | — | Listing returns to Open |
| Delete | — | Soft-delete listing; closes open negotiations |

**Do not use:** Cancel Change Request (label is **Withdraw Change Request**).

---

## 6. Actor matrices (negotiation)

### Pending — decision maker: Recipient

| Party | Footer | ⋯ menu |
|-------|--------|--------|
| Recipient | Accept · Request Changes · Reject Request | Report |
| Sender | Waiting for the other user to respond. | Cancel Request · Report |

### Changes Requested — decision maker: Sender

| Party | Footer | ⋯ menu |
|-------|--------|--------|
| Sender | Accept Changes · Decline Changes | Cancel Request · Report |
| Recipient (waiting proposer) | Waiting for the requester to respond. | Withdraw Change Request · Report |

### Changes Declined — decision maker: Recipient

| Party | Footer | ⋯ menu |
|-------|--------|--------|
| Recipient | Accept Original Terms · Request Changes Again · Reject Request | Report |
| Sender | Waiting for the other user to respond. | Cancel Request · Report |

### Pending Payment / In Progress / Delivered / Completed

| Party | Footer | ⋯ menu |
|-------|--------|--------|
| Sender at Pending Payment | — | Cancel Request · Report |
| Client / Provider (In Progress+) | Engagement actions by role | Report only |

| Role | Allowed (when engagement status allows) |
|------|----------------------------------------|
| Provider | Mark as Delivered (`in_progress` → `delivered`) |
| Client | Complete Job (`delivered` → `completed`); cancel engagement only via API before work starts (Phase 5 productizes Pay) |

Payment transitions remain server-only (Phase 5).

---

## 7. Overflow confirmations

Every ⋯ menu mutation requires confirmation before it runs.

### Withdraw Change Request

- Title: Withdraw Change Request?
- Message: This will withdraw your proposed changes and restore the previous negotiation state.
- Buttons: Cancel · Withdraw

### Cancel Request

- Title: Cancel Request?
- Message: This will permanently cancel this request and move it to History.
- Buttons: Keep Request · Cancel Request

---

## 8. Report workflow

Reporting does **not** use a simple confirm dialog.

1. User taps **Report** in the ⋯ menu.
2. A bottom sheet opens:
   - Title: Report Request
   - Description: Please describe the issue you experienced.
   - Multiline field placeholder: Describe what happened...
   - Buttons: Cancel · Send Report
3. Send requires at least **10 characters**.
4. On Send: dismiss the sheet, show success confirmation:
   - Title: Report Submitted
   - Message: Thank you for your report. Our team has received it and will review it as soon as possible. If additional information is needed, someone from our team will contact you.
   - Button: Done
5. Done returns to the **same** Job Details screen.

Report does **not** change Marketplace state, cancel the request, or navigate away.

Moderation / persistence is a later phase; the client may stub submission until then.

---

## 9. Listing lifecycle

| Action | User meaning |
|--------|----------------|
| Publish | Listing becomes Open |
| Archive | Hidden; can Reopen; open negotiations rejected |
| Close | Hiring finished; open negotiations rejected |
| Reopen | Back to Open (does not revive rejected requests) |
| Delete | Soft-delete; removed from UI; open negotiations rejected |

---

## 10. Engagement lifecycle (post-accept)

```
Pending Payment → (Phase 5 payment) → In Progress → Delivered → Completed → History
```

Client may cancel an engagement before work starts (API). Disputes / payment
failed are server-only and not productized yet.

---

## 11. Timeline event labels (user-facing)

| Event | Label |
|-------|-------|
| created | Request Sent |
| changes_requested | Changes Requested |
| changes_accepted | Changes Accepted |
| changes_declined | Changes Declined |
| changes_cancelled | Change Request Withdrawn |
| accepted | Request Accepted |
| rejected | Request Rejected |
| withdrawn | Request Cancelled |
| listing_closed | Listing Closed |

---

## 12. Confirmations

Every important Marketplace action uses `ConfirmActionModal` (same design
language), including optional comment where needed (Reject Request, Decline
Changes):

Accept · Accept Original Terms · Accept Changes · Request Changes ·
Request Changes Again · Decline Changes · Withdraw Change Request ·
Cancel Request · Reject Request · Mark as Delivered · Complete Job · Archive ·
Close · Delete · Reopen · Apply · Send Request · Publish

**Report** uses its own text-entry sheet + success confirmation (see §8), not
`ConfirmActionModal`.

Success modals for state-changing actions then land on the correct Jobs
tab/section (except Report, which stays on Job Details).

---

## 13. Notifications wording

Inline actions on request notifications:

- **Accept**
- **Reject Request**

Never label a reject action as **Decline**. **Decline Changes** is only used
when declining a counter-offer on the work request detail screen.

---

## 14. Deferred (placeholders only)

- **Reviews** — placeholder UI; no submit; later Reviews phase
- **Supporting Documents** — reference files on a work request; not deliverables;
  no real upload/preview yet
- **Report persistence / moderation** — UI ready; backend moderation later
- **Payments / Deliverables / Messaging** — later phases; must use this
  terminology when they ship

---

## 15. Source badges

| Source | Badge |
|--------|-------|
| job_posting | JOB POSTING |
| service_request | SERVICE REQUEST |
| direct_request | DIRECT REQUEST |

Negotiation after create is identical across sources; only sender/recipient vs
client/provider polarity differs (see `MARKETPLACE_WORK_REQUESTS.md`).

---

## Conformance

If a PR introduces a new Marketplace label or action name, it must update this
document in the same change — or it should not ship.
