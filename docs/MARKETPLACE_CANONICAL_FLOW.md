# Marketplace Canonical Flow

**Status:** Canonical · frozen for future phases (v0.3.3)  
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

**Do not use in UI:** Awaiting Payment, Withdrawn, Withdraw, Accept Original Terms,
Accepted (as a status), Completed History, Finished Jobs.

### Jobs sections

| Tab | Sections |
|-----|----------|
| Received | Requests · Pending Payment · In Progress · History |
| Sent | Requests · Pending Payment · In Progress · Posted Jobs · History |

**History** is the only archive term. It contains Completed, Rejected, and
Cancelled. History is read-only.

---

## 2. Work Request lifecycle

```
Pending
  → Changes Requested
      → Changes Declined  (negotiation continues)
      → Pending Payment   (accept / accept changes)
  → Pending Payment       (accept from Pending or Changes Declined)
  → In Progress           (Phase 5 — payment settled)
  → Delivered
  → Completed
  → History
```

**Terminal exits into History**

- Rejected
- Cancelled

---

## 3. Canonical buttons

Use exactly these labels:

| Button | Meaning |
|--------|---------|
| Accept | Recipient accepts current terms (no open counter-offer) |
| Accept Changes | Sender accepts a counter-offer |
| Request Changes | Recipient proposes new terms |
| Decline Changes | Sender rejects a counter-offer; negotiation continues |
| Cancel Change Request | Proposer retracts their counter-offer |
| Cancel Request | Sender ends the open request → Cancelled / History |
| Reject Request | End the request → Rejected / History |
| Mark as Delivered | Provider marks delivery |
| Complete Job | Client confirms completion → History |
| Apply | Apply to a job listing |
| Send Request | Create service or direct work request |
| Publish | Publish a job listing |
| Archive | Temporarily hide listing (reopenable); closes open negotiations |
| Close | Hiring finished; closes open negotiations |
| Reopen | Listing returns to Open |
| Delete | Soft-delete listing; closes open negotiations |

---

## 4. Actor matrices

### Sender (initiator)

| Status | Actions |
|--------|---------|
| Pending | Cancel Request |
| Changes Requested | Accept Changes · Decline Changes · Reject Request · Cancel Request |
| Changes Declined | Cancel Request |
| Pending Payment+ | Engagement actions by commercial role (client/provider) |
| Rejected / Cancelled / Completed | None (History) |

### Recipient

| Status | Actions |
|--------|---------|
| Pending / Changes Declined | Accept · Request Changes · Reject Request |
| Changes Requested | Cancel Change Request · Reject Request |
| Pending Payment+ | Engagement actions by commercial role |
| Rejected / Cancelled / Completed | None (History) |

### Client / Provider (after accept)

| Role | Allowed (when engagement status allows) |
|------|----------------------------------------|
| Provider | Mark as Delivered (`in_progress` → `delivered`) |
| Client | Complete Job (`delivered` → `completed`); cancel engagement only via API before work starts (Phase 5 productizes Pay) |

Payment transitions remain server-only (Phase 5).

---

## 5. Listing lifecycle

| Action | User meaning |
|--------|----------------|
| Publish | Listing becomes Open |
| Archive | Hidden; can Reopen; open negotiations rejected |
| Close | Hiring finished; open negotiations rejected |
| Reopen | Back to Open (does not revive rejected requests) |
| Delete | Soft-delete; removed from UI; open negotiations rejected |

---

## 6. Engagement lifecycle (post-accept)

```
Pending Payment → (Phase 5 payment) → In Progress → Delivered → Completed → History
```

Client may cancel an engagement before work starts (API). Disputes / payment
failed are server-only and not productized yet.

---

## 7. Timeline event labels (user-facing)

| Event | Label |
|-------|-------|
| created | Request Sent |
| changes_requested | Changes Requested |
| changes_accepted | Changes Accepted |
| changes_declined | Changes Declined |
| changes_cancelled | Change Request Cancelled |
| accepted | Request Accepted |
| rejected | Request Rejected |
| withdrawn | Request Cancelled |
| listing_closed | Listing Closed |

---

## 8. Confirmations

Every important Marketplace action uses `ConfirmActionModal` (same design
language), including optional comment where needed (Reject Request, Decline
Changes):

Accept · Accept Changes · Request Changes · Decline Changes · Cancel Request ·
Cancel Change Request · Reject Request · Mark as Delivered · Complete Job ·
Archive · Close · Delete · Reopen · Apply · Send Request · Publish

Success modals then land on the correct Jobs tab/section.

---

## 9. Notifications wording

Inline actions on request notifications:

- **Accept**
- **Reject Request**

Never label a reject action as **Decline**. **Decline Changes** is only used
when declining a counter-offer on the work request detail screen.

---

## 10. Deferred (placeholders only)

- **Reviews** — placeholder UI; no submit; later Reviews phase
- **Supporting Documents** — reference files on a work request; not deliverables;
  no real upload/preview yet
- **Payments / Deliverables / Messaging** — later phases; must use this
  terminology when they ship

---

## 11. Source badges

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
