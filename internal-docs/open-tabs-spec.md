# Open Tabs — Feature Spec

## Goal
Allow restaurants and bars to keep a sale open across multiple item additions,
assigning it to a table or tab name, and close it when the customer pays.
Gyms, bakeries, and other stores are completely unaffected — the feature is
hidden behind a flag.

## Feature Flag
`store.features.tabs = true`

When disabled (default): POS works exactly as today — pick items, pay, done.
When enabled: POS gains a Tables view and the quick-sale flow becomes "New Tab."

---

## How It Works

1. Cashier opens the POS and sees two modes:
   - **Tables** — grid of open tabs (table 1, table 2, bar tab "Maria", etc.)
   - **Quick Sale** — existing flow, unchanged (for takeout or walk-up counter orders)

2. To start a tab: tap "New Tab" → enter table number or tab name → add items → 
   save without paying ("Send to Table").

3. To add more items: tap the open table card → add items → save again.

4. To close: tap the open table card → tap "Close & Pay" → existing payment flow.

5. Closed tabs become regular Sale records — no special handling in reports or
   receipts.

---

## Schema Changes

### Store model
```js
features: {
  memberships:      Boolean,
  tabs:             Boolean,   // NEW
  bitcoinLightning: Boolean,
}
```

### Sale model
```js
status:      { type: String, enum: ['open', 'closed'], default: 'closed' }
tableNumber: { type: String, default: '' }   // "4", "Bar", "Takeout", etc.
openedAt:    { type: Date, default: null }
closedAt:    { type: Date, default: null }
```

Existing sales are unaffected — they default to `status: 'closed'`.

---

## API Changes

### New endpoints
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/sales/open` | Open a new tab (no payment yet) |
| PATCH | `/api/sales/:id/items` | Add/update items on an open tab |
| PATCH | `/api/sales/:id/close` | Close tab + record payment |
| GET | `/api/sales/open` | List all currently open tabs for this store |

### Existing endpoints unchanged
`GET /api/sales`, `GET /api/sales/summary`, `POST /api/sales` — all still work.
Closed tabs appear in sales history normally.

---

## Frontend Changes

### `pos.html`
- When `tabs` feature is enabled: show two-tab toggle at top — "Tables" / "Quick Sale"
- **Tables view**: grid of cards, one per open tab. Card shows table name + item count
  + running total + how long it's been open.
- **New Tab button**: prompts for table number/name, then enters item selection.
- **Open tab detail**: shows current items, allows adding more, has "Close & Pay" button.
- Quick Sale flow: identical to today, no changes.

### `admin.html`
- New "Open Tabs" toggle in store features section (alongside Memberships).

### `reports.html` *(future)*
- Average tab duration (open → close time) useful for restaurant turn time tracking.

---

## Out of Scope (for now)
- Floor plan / visual table layout
- Seat assignments within a table
- Course management (fire appetizers before mains)
- Kitchen display system (KDS)
- Split checks
- Per-item notes ("no onions") — easy to add later once tabs exist

---

## Notes
- A tab with no payment method recorded is `open`. Closing it triggers the normal
  payment flow (cash, HBD, card, bank transfer, etc.).
- If a cashier closes the app mid-tab, the open tab persists in the database and
  can be resumed from any device logged into the same store.
- Quick Sale remains available even when tabs are enabled — useful for takeout
  or counter walk-ups at a restaurant.
