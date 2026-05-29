# Data Export & Backup — Feature Spec

## Goal
Give store owners full ownership of their member data. Three complementary
mechanisms: on-demand CSV, on-demand PDF, and automatic monthly email backup.
A store owner should never feel locked in or at risk of losing their client list.

---

## Export 1 — CSV (On-Demand)

### Where
`members.html` — "Export CSV" button in the page header, visible to
`store_owner` and `superadmin` roles only.

### What's included

| Field | Notes |
|-------|-------|
| Name | |
| Email | |
| Phone | |
| Hive Account | |
| Membership Type | Plan name, not ID |
| Is Pass | Yes / No |
| Status | active / overdue / pending / suspended / expired |
| Start Date | formatted YYYY-MM-DD |
| Next Due Date | formatted YYYY-MM-DD, blank if pending |
| Gender | |
| Age Group | |
| Notes | |
| Created Date | |

### Filters respected
Export respects whatever filter is currently active on the member list
(status filter, search query). A "Export All" option bypasses filters.

### Implementation
- Backend: `GET /api/members/export?format=csv` — streams CSV response
  with `Content-Disposition: attachment; filename="members-YYYY-MM-DD.csv"`
- No third-party library needed — CSV is plain text, hand-built on the server
- Frontend: anchor tag with the API URL, token passed as query param or
  via a short-lived signed URL

---

## Export 2 — PDF (On-Demand)

### Where
Same header area as CSV — "Export PDF" button alongside CSV.

### What's included
A formatted member roster — clean, printable, professional.

```
┌─────────────────────────────────────────┐
│  [Store Logo]   Member Roster           │
│  Generated: May 28, 2026                │
│  Total Members: 47 active, 3 overdue    │
├────────┬──────────┬────────┬────────────┤
│ Name   │ Email    │ Plan   │ Next Due   │
├────────┼──────────┼────────┼────────────┤
│ ...    │ ...      │ ...    │ ...        │
└────────┴──────────┴────────┴────────────┘
```

Notes field omitted — too verbose for print layout.
Members sorted alphabetically by name.
Status shown as a text label (not color — prints on B&W printers).

### Implementation
- **Library: `pdfkit`** — Node.js PDF generation, no browser dependency
- Backend: `GET /api/members/export?format=pdf` — streams PDF response
- Separate endpoint handler but same auth/filter logic as CSV

---

## Export 3 — Scheduled Monthly Email Backup

### What it does
On the 1st of every month, the system automatically emails the store owner
a CSV attachment of their complete member list — all members, no filters.

No action required from the store owner. It just arrives in their inbox.

### Who receives it
The store owner's registered email address (stored on User record — needs
to be added to the User model if not already present).

### Email content
```
Subject: [Store Name] — Member List Backup — May 2026

Hi [Owner Name],

Attached is your complete member list as of June 1, 2026.
47 active members, 3 overdue, 2 pending.

This is your monthly automatic backup. Keep it somewhere safe.

— POSHIVE
```

Attachment: `members-backup-2026-06.csv`

### Implementation
- **Library: `node-cron`** — lightweight cron scheduler, already a natural
  fit for the existing Node.js backend
- Cron expression: `0 8 1 * *` — 8am on the 1st of every month
  (store owner wakes up to it in their inbox)
- Uses the existing SMTP/email config already in `.env`
- Only runs for stores that have memberships enabled AND have a valid owner email
- Logs sent/failed per store for debugging

### Schema Changes

#### User model
```js
email: { type: String, default: '' }   // owner's contact email for system messages
```

#### Store model
```js
backupEmail: { type: Boolean, default: true }   // opt-out toggle in admin panel
```

Default is `true` — store owners get the backup unless they explicitly turn it off.
Opt-out (not opt-in) because the backup protects them whether or not they think
to enable it.

---

## Admin Panel Changes (`admin.html`)

- **Owner Email** field in store settings (used for backup emails and future
  system notifications)
- **Monthly backup email** toggle — on by default, can be disabled
- **Export buttons** not in admin — they live on `members.html`

---

## `members.html` Changes

- "Export CSV" button in page header (respects active filters + "Export All" option)
- "Export PDF" button in page header
- Both hidden from cashier role — store_owner and superadmin only

---

## Backend — New Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/members/export` | store_owner | `?format=csv` or `?format=pdf`, optional filter params |

---

## Future Considerations
- Scheduled export of sales data (not just members)
- Weekly backup option for high-turnover stores
- Export filtered to overdue members only (useful for follow-up campaigns)
- GDPR/data deletion request handling (members requesting their data removed)
