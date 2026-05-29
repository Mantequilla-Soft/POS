# Email Campaigns — Feature Spec

## Goal
Allow membership businesses to send targeted broadcast emails to their member
base — promotions, announcements, renewal nudges, seasonal offers. Closes the
loop between having a member list and actually communicating with it.

Powered by the existing SMTP config already in `.env` (Resend or any provider).

---

## Feature Flag
`store.features.emailCampaigns = true`

Separate from `emailReminders` (automated overdue notices). This is manual,
owner-initiated broadcast email. Hidden from stores that don't use memberships.

---

## Recipient Targeting

### Filter options
| Filter | Options |
|--------|---------|
| Status | Active / Overdue / Expired / Pending / All |
| Membership Type | Any specific plan, or All plans, or Passes only |
| Combined | Status AND membership type together |

### Live recipient count
As the owner adjusts filters, a live count updates in real time:
> "This will send to **43 members** with valid email addresses."

Members with no email address are automatically excluded and shown as a
separate count:
> "12 members have no email on file and will be skipped."

### Unsubscribe respect
Members who have unsubscribed (`emailOptOut: true`) are always excluded,
regardless of filters. Count reflects this automatically.

---

## Email Composition

### Fields
| Field | Notes |
|-------|-------|
| Subject | Plain text, required |
| Body | Simple rich text — bold, italic, links, line breaks |
| Preview text | Short line shown in inbox before opening (optional) |
| Template | Load from saved templates (see below) |

### Rich text
Lightweight rich text editor — **Quill.js** loaded from CDN.
No build step, consistent with app's zero-dependency approach.
Output stored as HTML, rendered in email body.

### Personalization tokens
Tokens are inserted via **clickable buttons** displayed above the subject line
and above the body editor. Clicking a button inserts the token at the current
cursor position. Typing tokens by hand is not the intended flow — buttons
prevent typos and make the feature discoverable.

```
Insert: [ First Name ]  [ Membership Type ]  [ Due Date ]  [ Store Name ]
```

Buttons appear in both the subject field toolbar and the body editor toolbar.
Clicking while the subject field is focused inserts into the subject.
Clicking while the body editor is focused inserts into the body at the cursor.

| Button Label | Token | Replaced with |
|--------------|-------|---------------|
| First Name | `{{name}}` | Member's name |
| Membership Type | `{{membership}}` | Their plan name |
| Due Date | `{{dueDate}}` | Their next due date, formatted |
| Store Name | `{{storeName}}` | The store's business name |

Preview substitutes real values from the owner's own member record (or a
placeholder if the owner isn't a member) so they can see exactly how it renders
before sending.

---

## Templates

Owner can save and reuse email templates. Useful for recurring campaigns
(monthly promotion, seasonal offer, renewal nudge).

### Template fields
```js
{
  storeId:     ObjectId,
  name:        String,    // "Monthly Promo", "Re-engagement"
  subject:     String,
  previewText: String,
  body:        String,    // HTML
  createdBy:   String,
  createdAt:   Date,
  updatedAt:   Date,
}
```

### Template actions
- Save current draft as template
- Load template into composer
- Edit / delete saved templates

---

## Send Flow

1. Owner navigates to **Campaigns** tab in `members.html`
2. Clicks **New Campaign**
3. Sets recipient filters → sees live count
4. Writes subject + body (or loads a template)
5. Clicks **Preview** — sees a rendered preview with their own name/data substituted
6. Clicks **Send** — confirmation dialog: "Send to 43 members. This cannot be undone."
7. Emails sent one by one via SMTP (rate-limited to avoid provider throttling)
8. Campaign record saved with outcome

### Rate limiting
Emails sent with a small delay between each (e.g. 200ms) to avoid hitting
SMTP provider rate limits. For 100 members this takes ~20 seconds — a
progress indicator is shown.

---

## Unsubscribe Handling

Every broadcast email includes an unsubscribe link in the footer:
```
You're receiving this because you're a member of [Store Name].
Unsubscribe: https://pos.3speak.tv/unsubscribe?token=xxxx
```

### Unsubscribe endpoint
`GET /api/members/unsubscribe?token=xxxx`
- Token is a signed JWT containing memberId + storeId (no login required)
- Sets `member.emailOptOut = true`
- Returns a simple confirmation page: "You've been unsubscribed."

### Member model addition
```js
emailOptOut:       { type: Boolean, default: false }
unsubscribeToken:  { type: String, default: '' }   // generated on first campaign send
```

---

## Campaign History

Every sent campaign is recorded. Owner can view:
- Date sent
- Subject line
- Recipient count (targeted / skipped no-email / skipped unsubscribed / actually sent)
- Sent by (cashier/owner username)

### CampaignLog model
```js
{
  storeId:          ObjectId,
  subject:          String,
  previewText:      String,
  body:             String,
  filters:          Object,    // snapshot of filters used
  targetedCount:    Number,
  skippedNoEmail:   Number,
  skippedOptOut:    Number,
  sentCount:        Number,
  sentBy:           String,
  sentAt:           Date,
}
```

No re-send from history — owner must compose a new campaign. Prevents
accidental duplicate blasts.

---

## Schema Changes

### Store model
```js
features: {
  memberships:      Boolean,
  tabs:             Boolean,
  kitchenDisplay:   Boolean,
  emailCampaigns:   Boolean,   // NEW
  bitcoinLightning: Boolean,
}
```

### Member model
```js
emailOptOut:      { type: Boolean, default: false }
unsubscribeToken: { type: String, default: '' }
```

### New models
- `EmailTemplate` — saved reusable templates
- `CampaignLog` — sent campaign history

---

## New API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/campaigns` | store_owner | List campaign history |
| POST | `/api/campaigns/preview-count` | store_owner | Get recipient count for filters |
| POST | `/api/campaigns/send` | store_owner | Compose and send campaign |
| GET | `/api/campaigns/templates` | store_owner | List saved templates |
| POST | `/api/campaigns/templates` | store_owner | Save template |
| PUT | `/api/campaigns/templates/:id` | store_owner | Update template |
| DELETE | `/api/campaigns/templates/:id` | store_owner | Delete template |
| GET | `/api/members/unsubscribe` | none | Handle unsubscribe link (public) |

---

## Frontend Changes

### `members.html`
- New **Campaigns** tab alongside the member list
- Campaign composer: filters → recipient count → subject/body/template → preview → send
- Campaign history table below composer
- Template manager (list, edit, delete saved templates)

### `admin.html`
- New **Email Campaigns** toggle in store features section
- Owner email field (required — campaigns need a from/reply-to address)

---

## Email Footer (every campaign)
```
────────────────────────────────
[Store Name] · Powered by POSHIVE
You're receiving this because you're a member of [Store Name].
Unsubscribe · [link]
```

---

## Deliverability Notes
- From address: uses `EMAIL_FROM` from `.env` (already configured)
- Reply-to: store owner's registered email
- Subject should not use ALL CAPS or excessive punctuation (spam triggers)
- Resend (current SMTP provider) handles deliverability — good foundation
- Future: SPF/DKIM setup instructions added to `docs/` for self-hosters

---

## Out of Scope (for now)
- Scheduled / drip campaigns (send in 3 days, send in 7 days)
- Open rate / click tracking
- A/B subject line testing
- SMS campaigns
- Sending to non-member contacts
- Bounce handling and automatic opt-out on hard bounce
