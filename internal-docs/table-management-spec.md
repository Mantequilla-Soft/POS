# Table Management — Feature Spec

## Goal
Give restaurant staff a persistent, at-a-glance view of all tables — which are
open, which are free — without the complexity of a drag-and-drop floor plan.
Tables are defined once by the store owner and always visible in the POS.

## Feature Flag
`store.features.tabs = true`

Table management is part of the tabs feature — no separate flag needed.
Requires the store owner to define at least one table in admin settings.

---

## Store Setup (admin.html)

Store owner defines their table list once in the Tables section of store settings.
Each table has:

| Field | Type | Description |
|-------|------|-------------|
| `id` | UUID | Stable internal identifier |
| `name` | String | Display name: "1", "2", "Bar", "Patio", "Takeout" |
| `capacity` | Number | Optional — seats count, useful for future covers reporting |
| `active` | Boolean | Inactive tables are hidden from POS (e.g. seasonal patio) |

Simple list editor: add, rename, remove, toggle active. No coordinates, no layout.

### Schema (Store model)
```js
tables: [{
  id:       { type: String, required: true },   // uuid generated on creation
  name:     { type: String, required: true },
  capacity: { type: Number, default: null },
  active:   { type: Boolean, default: true },
}]
```

---

## POS Tables View

When `tabs` is enabled and tables are defined, the POS shows a tile grid instead
of a "New Tab" button. One tile per active table, always visible, fixed positions.

### Tile States

| State | Color | Meaning |
|-------|-------|---------|
| Empty | Gray | No open tab — tap to start a new order |
| Occupied | Green | Open tab exists — shows running total + time open |
| Attention | Amber | All kitchen items marked ready — reserved for future use |

### Tile Contents (when occupied)
- Table name (large)
- Number of items
- Running total
- Time open ("23 min")

### Tile Contents (when empty)
- Table name (large)
- Capacity if set ("4 seats")

---

## Flows

### Starting an order
1. Waiter taps an empty (gray) tile
2. Goes directly into item selection — table is already known, no typing required
3. Adds items → taps "Send to Table"
4. Tile turns green

### Adding items to an open table
1. Waiter taps an occupied (green) tile
2. Sees current order summary
3. Taps "Add Items" → item selection → "Send to Table"
4. Items appended to existing tab

### Closing a table
1. Waiter taps an occupied (green) tile
2. Taps "Close & Pay"
3. Normal payment flow (cash, card, HBD, etc.)
4. Tab saved as closed Sale record
5. Tile returns to gray

### Quick Sale (takeout / walk-up)
Always available alongside the table grid via a "Quick Sale" button.
Bypasses table assignment entirely — same flow as today.

---

## Schema Changes

### Sale model
```js
tableId:     { type: String, default: '' }   // references Store.tables[].id
tableNumber: { type: String, default: '' }   // denormalized name for display/history
```

Both fields stored so receipts and history still show the table name even if the
store later renames or removes the table.

---

## API Changes

No new endpoints required. Existing open tabs endpoint already returns all open
sales — the POS matches them against the store's table list by `tableId`.

`GET /api/sales/open` — returns open tabs, now includes `tableId` and `tableNumber`.

Store tables are returned as part of `GET /api/store` — already loaded by the POS
on startup.

---

## Frontend Changes

### `pos.html`
- When tabs enabled + tables defined: show tile grid as default view
- "Quick Sale" button always accessible (top corner or dedicated tile)
- Tile grid is responsive: 2 columns on mobile, 3-4 on tablet, up to 6 on desktop
- If tabs enabled but no tables defined: show a prompt to set up tables in admin

### `admin.html`
- New "Tables" section inside the Tabs feature panel (shown when tabs are enabled)
- List editor: add table (name + capacity), reorder, toggle active, delete
- Warning if deleting a table that has an open tab

### `kitchen.html`
- Table name displayed prominently on each kitchen ticket card
- Tickets sorted by table name when opened at same time

---

## Build Order
1. Open Tabs must be built first
2. Store model: add `tables` array
3. Admin panel: table list editor
4. POS: tile grid replaces "New Tab" button
5. Backend: `GET /api/sales/open` includes tableId/tableNumber
6. Kitchen display: update to show table name

---

## Out of Scope (for now)
- Visual floor plan with drag-and-drop table positioning
- Seat assignments within a table
- Reservation system (link a reservation to a table)
- Automatic table status from kitchen (attention state)
- Covers tracking (number of guests per table for reporting)
