# Day/Week Passes — Feature Spec

## Context
A real-world requirement from a gym client. Passes are short-duration access
products (1 day, 3 days, 1 week) sold at the POS — closer to a product sale
than a full membership enrollment, but still worth capturing contact info for
lead conversion later.

## Core Insight
Passes reuse the entire existing membership infrastructure. No new model needed.
A pass is simply a MembershipType with `isPass: true` and a short duration.
Buying a pass at the POS creates a Member in `pending` status and immediately
records the first (and likely only) payment — the same flow as a regular
first-time membership payment.

---

## The `isPass` Flag

### MembershipType model
```js
isPass: { type: Boolean, default: false }
```

### Behavior when `isPass = true`

| Behavior | Regular Membership | Pass |
|----------|--------------------|------|
| Overdue reminders | Yes (if email enabled) | **No** |
| `syncOverdueStatus` | Marks overdue | **Skips entirely** |
| Status progression | pending → active → overdue | pending → active → **expired** |
| Shows in member list | Yes | Yes |
| Convertible to full member | N/A | Yes |
| Reports | Membership revenue | Flagged separately as pass revenue |

### `syncOverdueStatus` change
```js
// Only mark overdue for non-pass membership types
await Member.updateMany(
  {
    storeId,
    status: 'active',
    nextDueDate: { $lt: new Date(), $ne: null },
    'membershipType.isPass': { $ne: true }   // exempt passes
  },
  { $set: { status: 'expired' } }   // expired, not overdue
);
```

> Note: this requires a populated membershipType or a denormalized `isPass`
> field on the Member record. See schema changes below.

---

## Typical Pass Setup (store owner configures once)

| Name | Duration | Price | Is Pass |
|------|----------|-------|---------|
| Monthly | 30 days | $40 HBD | No |
| Annual | 365 days | $400 HBD | No |
| Day Pass | 1 day | $5 HBD | Yes |
| 3-Day Pass | 3 days | $12 HBD | Yes |
| Week Pass | 7 days | $18 HBD | Yes |

---

## POS Flow (when memberships feature is enabled)

1. Cashier adds a pass item to the sale (pass membership types surfaced as
   selectable items in the POS alongside regular products)
2. Before completing the sale, a lightweight contact form appears:
   - Name (required)
   - Email (optional)
   - Phone (optional)
3. On sale completion:
   - A Member record is created (`status: pending`)
   - A MemberPayment is immediately recorded (activates the member, sets nextDueDate)
   - Member status becomes `active` for the pass duration
4. Pass expires quietly — status goes to `expired`, no reminder sent

---

## Conversion to Full Member

From the Members list, a pass holder shows a **"Convert"** button (visible when
`membershipType.isPass = true` and status is `active` or `expired`).

Tapping it opens the Add Member modal pre-filled with:
- Name, email, phone from the pass holder record
- Membership type defaulting to the store's primary recurring plan

The cashier selects the membership type, records the first payment, and the
pass holder becomes a full member. The original pass record is preserved in
history.

---

## Schema Changes

### MembershipType model
```js
isPass: { type: Boolean, default: false }
```

### Member model
Add a denormalized flag to avoid a join in `syncOverdueStatus`:
```js
isPass: { type: Boolean, default: false }   // copied from MembershipType at creation
```

This avoids a populate/join in the overdue sync query which runs on every
`GET /api/members` call.

---

## Frontend Changes

### `admin.html` — Membership Types form
- Add "Is Pass" checkbox to the membership type form
- Pass types visually distinguished in the list (badge)

### `pos.html`
- When memberships enabled: pass types appear as tappable items in the POS
  item grid (alongside regular products), visually labeled as passes
- On add-to-cart: triggers contact capture modal (name + email + phone)
- Contact info stored temporarily until sale is completed

### `members.html`
- Pass holders shown with a "Pass" badge instead of membership type name
- "Convert" button on pass holder rows
- Filter option: "Show passes" / "Show members" / "Show all"

### `reports.html`
- Membership revenue section splits: **Subscriptions** vs **Passes**
- Pass conversion rate: how many pass holders converted to full members

---

## Email Reminder Exemption
Pass holders are completely exempt from overdue/expiry reminder emails.
The email reminder system checks `member.isPass` before queuing any message.
A pass expiring is an expected, normal outcome — not a collections situation.

---

## Out of Scope (for now)
- Multi-visit passes (e.g. "10-visit punch card") — different tracking model
- Pass holder portal / self-service
- Automatic conversion prompts sent to pass holders via email
