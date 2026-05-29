# Kitchen Display — Feature Spec

## Goal
Give kitchen staff a real-time view of open orders without needing a full POS
login. Designed to work on a cheap tablet or monitor mounted in the kitchen.
Builds on top of Open Tabs — requires `store.features.tabs = true`.

## Feature Flag
`store.features.kitchenDisplay = true`

Hidden from stores that don't need it (gyms, bakeries, retail).

---

## How It Works

1. Store owner accesses `kitchen.html` from admin panel — gets a shareable PIN-protected URL.
2. Kitchen staff open that URL on any browser/tablet. No username/password — just a store PIN.
3. Screen shows all open tabs as cards, ordered by time opened (oldest first).
4. When an item is ready, cook taps it — it grays out.
5. When all items on a ticket are ready, the card is cleared (or moved to a "done" column).
6. New orders appear automatically without refreshing.

---

## Display Layout

Each ticket card shows:
- Table number / tab name (large, easy to read across the kitchen)
- How long the ticket has been open (e.g. "14 min")
- Each item: quantity + name + any item notes ("no onions", "well done")
- Visual state: pending (white) → ready (green/strikethrough)

Cards are sorted oldest-first so the longest-waiting table is always top-left.

---

## Technical Approach

### Phase 1 — Polling (simple, no new infrastructure)
`kitchen.html` polls `GET /api/sales/open` every 10 seconds.
Pros: trivial to build, works everywhere.
Cons: up to 10s lag on new orders.

### Phase 2 — WebSockets (real-time, no lag)
Backend emits events when a tab is opened or items are added.
Kitchen screen receives updates instantly.
Requires adding `socket.io` to the backend.
Build this when polling lag becomes a real complaint.

### Item Status Tracking
Each item in an open tab gains a `status` field:
```js
{ name, price, qty, notes, status: 'pending' | 'ready' }
```
`PATCH /api/sales/:id/items/:itemIndex/ready` — marks a single item ready.

---

## Authentication
Kitchen display does not use staff JWT tokens — kitchen staff shouldn't have
access to sales data, reports, or admin functions.

Instead: a **store kitchen PIN** (4-6 digits, set in admin panel).
The PIN grants access only to `kitchen.html` for that store.
Stored hashed on the Store record.

---

## Schema Changes

### Store model
```js
features: {
  memberships:      Boolean,
  tabs:             Boolean,
  kitchenDisplay:   Boolean,   // NEW
  bitcoinLightning: Boolean,
}
kitchenPin: { type: String, default: '' }   // bcrypt hashed
```

### Sale model (items array)
Each item gains an optional status field:
```js
items: [{
  name:   String,
  price:  Number,
  qty:    Number,
  notes:  String,    // "no onions", "well done" — added with Open Tabs
  status: { type: String, enum: ['pending', 'ready'], default: 'pending' }
}]
```

---

## New API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/kitchen/auth` | Kitchen PIN | Returns short-lived kitchen token |
| GET | `/api/kitchen/orders` | Kitchen token | Open tabs for this store |
| PATCH | `/api/kitchen/orders/:id/item/:idx` | Kitchen token | Mark item ready/pending |

---

## Frontend Changes

### New: `kitchen.html`
- PIN entry screen on first load (stores kitchen token in sessionStorage)
- Full-screen card grid — optimized for touch on a mounted tablet
- Auto-refresh (polling phase 1) or WebSocket listener (phase 2)
- Minimal UI — large text, high contrast, no nav, no menus
- "Mark All Ready" button per ticket for fast clearing

### `admin.html`
- New "Kitchen Display" toggle in store features section
- PIN setup field (shown when feature is enabled)
- Link/button to open `kitchen.html` in a new tab

---

## Build Order
1. Open Tabs must exist first (kitchen display has nothing to show without tabs)
2. Add `notes` field to tab items (small addition to Open Tabs spec)
3. Kitchen PIN auth endpoint
4. `GET /api/kitchen/orders` + item status PATCH
5. `kitchen.html` UI with polling
6. Admin panel toggle + PIN setup
7. *(Future)* Upgrade polling to WebSockets

---

## Out of Scope (for now)
- ESC/POS thermal printer support (paper tickets)
- Course management (fire appetizers before mains)
- Multiple kitchen stations (bar gets drinks, kitchen gets food)
- Sound alerts for new orders
- Kitchen performance metrics (avg ticket time)
