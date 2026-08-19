# Commercial Model

**Status:** Canonical · frozen for Phase 5+  
**Audience:** Product, engineering, payments, admin, analytics, AI, and future developers

This document is the **single source of truth** for Mawahib’s commercial business rules.

It defines **what** commercial concepts mean. It does not describe how they are implemented.

Every future surface — Escrow, Payments, Wallet, Invoices, Refunds, Admin Panel, reporting, and AI — must conform to these rules.

---

## Profile

A user’s profile owns:

- **country** — the user’s country
- **location** — the user’s city / emirate within that country
- **default currency** — derived from country

### Rules

- Country determines default currency:
  - Saudi Arabia → SAR
  - United Arab Emirates → AED
- Changing country updates the user’s **default currency**.
- Changing country **never** rewrites historical commercial objects.

---

## Commercial objects

A **commercial object** is any record that stores or settles money, or that freezes agreed commercial terms.

Includes:

- Services
- Service packages
- Add-ons
- Job listings
- Work requests
- Engagements
- Future payments
- Invoices
- Refunds
- Escrow / ledger entries

### Rules

- Commercial objects **snapshot currency at creation**.
- They **never** re-derive currency from the user’s current profile later.
- Amounts and currency on commercial objects are commercial history.

---

## Service

A service offering is a commercial object with:

- **Currency** — snapshotted when the service is created
- **Package / Base Price** — one or more packages, each with a base amount
- **Add-ons** — optional extras, each with its own amount
- **Totals** — computed from base + selected add-ons; never stored by baking add-ons into the base

Editing a service may change titles, media, or amounts. It does **not** change the service’s snapshotted currency.

---

## Package / Base Price

**Package / Base Price** = the base amount only.

It is **not** the total.

Labels such as “Price,” “Budget,” or “Offer” must not be treated as the payable total when add-ons exist.

---

## Add-ons

Add-ons are **independent** prices attached to a commercial deal.

They are:

- Never baked into the package / base amount
- Never omitted from the chargeable total when selected
- Never double-counted

---

## termsTotal

**termsTotal** is the canonical commercial total for agreed terms:

> **termsTotal = Package / Base Price + Σ Add-ons**

This is the total that represents what the parties agreed commercially.

---

## chargeableTotal

**chargeableTotal** is the canonical amount consumed by Payments.

Future Escrow, Wallet, Refunds, Invoices, and Admin finance views must use this value (or an equivalent derived only from frozen commercial terms).

### Rules

- Payable amounts must **never** be derived from package / base price alone when add-ons apply.
- Payable amounts must **never** be derived from the viewer’s profile, country, or default currency.

---

## Negotiation

Negotiation may edit:

- **Package / Base Price** (amount only)
- Other non-currency terms (for example deadline or notes), as product allows

Negotiation must **never** change:

- **Currency**

Currency remains the frozen commercial snapshot for that work request.

---

## Currency

- Currency is **frozen** after a commercial object is created.
- There is **no** automatic exchange-rate conversion.
- Historical objects remain exactly as originally created.
- Display must show the **object’s** currency, not the viewer’s.

A future “change currency” product action, if ever built, must require explicit confirmation and must never silently convert via FX. That feature is **not** part of the current model.

---

## Viewer

The viewer’s location and default currency **never** affect a commercial object’s currency.

Examples:

- A Saudi user viewing a UAE service still sees AED.
- A UAE user viewing a Saudi service still sees SAR.

Messaging and Jobs only **display** commercial data; they do not reinterpret it.

---

## Country change

When a user changes country:

| Updates | Does **not** update |
|---------|---------------------|
| Default currency | Existing services |
| Future commercial defaults | Existing job listings |
| | Existing work requests |
| | Existing engagements |
| | Existing history |

Only **new** commercial objects inherit the new default currency.

---

## Direct Request and Job Application (currency inheritance)

Commercial currency is determined at creation by the relevant commercial context — not by whoever happens to be viewing later:

- **Service Request** → service offering currency snapshot  
- **Job Application** → job listing currency snapshot  
- **Direct Request** → provider’s default currency at creation time (then frozen on the work request)

---

## Payments

Payments consume **chargeableTotal** (from frozen commercial terms).

Payments must never derive money from:

- Profile
- Current country
- Current default currency
- Viewer preference

Everything payable must come from **frozen commercial data**.

---

## Guiding principles

1. **Commercial history is immutable.**  
2. **Currency is snapshotted** at creation and never silently rewritten.  
3. **Package / Base Price is never the total** when add-ons exist.  
4. **Add-ons remain independent.**  
5. **termsTotal / chargeableTotal is the canonical payable amount.**  
6. **Viewer location never changes object currency.**  
7. **Profile changes affect future defaults only.**  
8. **Payments consume frozen commercial data.**  
9. **No automatic FX conversion.**  
10. **Messaging and Jobs display commercial truth; they do not redefine it.**

---

## Related docs

- Marketplace UX: [`MARKETPLACE_CANONICAL_FLOW.md`](./MARKETPLACE_CANONICAL_FLOW.md)
- Work request API / FSM: [`MARKETPLACE_WORK_REQUESTS.md`](./MARKETPLACE_WORK_REQUESTS.md)
- Current roadmap: [`ROADMAP.md`](./ROADMAP.md)

Payments, Escrow, Wallet, Invoices, Refunds, and Admin finance **must** read this document before implementation.