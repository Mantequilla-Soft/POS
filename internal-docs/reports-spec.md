# Reports Page — Feature Spec

## Goal
A dedicated `reports.html` page for store owners to analyze sales, operations,
and membership health. Designed to serve retail stores, gyms, and restaurants.

---

## Charting Library
**Chart.js** — loaded from CDN, no build step required, consistent with the
rest of the app's zero-dependency frontend approach.

Chart types used:
- **Bar** — revenue over time, sales by category, busiest days
- **Line** — trends and moving averages overlaid on bar charts
- **Doughnut** — payment method split, member status snapshot
- **Horizontal bar** — top items, cashier activity (ranked lists)

---

## Page Layout

### Visual Hierarchy
```
┌─────────────────────────────────────────────────┐
│  Date range picker   [This Week ▾]  [Custom]    │
├──────────┬──────────┬──────────┬────────────────┤
│ KPI Card │ KPI Card │ KPI Card │    KPI Card    │  ← big numbers, instant read
├──────────┴──────────┴──────────┴────────────────┤
│         Revenue Over Time (bar + trend line)    │  ← primary chart
├─────────────────────┬───────────────────────────┤
│  Top Items (h-bar)  │  Payment Method (donut)   │  ← secondary charts
├─────────────────────┴───────────────────────────┤
│         Membership section (if enabled)         │
├─────────────────────┬───────────────────────────┤
│  Active Members/mo  │  Member Status (donut)    │
├─────────────────────┴───────────────────────────┤
│         Detail Tables (collapsible)             │
└─────────────────────────────────────────────────┘
```

### Date Range Presets
- Today
- This Week
- This Month
- Last Month
- Last 3 Months
- Custom (date pickers)

---

## Section 1 — Sales KPI Cards

Four cards always visible at the top of the page.

| Card | Value | Sub-label |
|------|-------|-----------|
| Total Revenue | Sum of all sales in range | vs previous period (↑↓%) |
| Transactions | Count of sales | avg per day |
| Average Order Value | Revenue ÷ transactions | vs previous period |
| Tax Collected | Sum of taxAmount | Hidden if tax not enabled |

---

## Section 2 — Sales Charts

### Revenue Over Time
- Bar chart — one bar per day (or per week for ranges > 30 days)
- Line overlay — 7-day moving average to smooth noise
- X-axis: date, Y-axis: revenue in store currency

### Top Items
- Horizontal bar chart — top 10 items by units sold
- Toggle: sort by **units sold** or **revenue**
- Date range respects global filter
- Data source: `$unwind` items array, `$group` by item name

### Sales by Category
- Horizontal bar chart — revenue per category
- Same toggle: units vs revenue

### Payment Method Split
- Doughnut chart — cash / HBD / card / bank transfer / other
- Shows % and absolute value in tooltip

### Busiest Days & Hours *(restaurant-relevant)*
- Busiest Days: bar chart by day of week (Mon–Sun)
- Peak Hours: bar chart by hour of day (0–23)
- Both show transaction count, not revenue

---

## Section 3 — Operations

### Cashier Activity
- Horizontal bar chart — transactions and revenue per cashier
- Table below: cashier name / transactions / revenue / avg order value

### Tax Collected *(hidden if tax not enabled)*
- Total tax collected in period
- Daily breakdown line chart
- Useful for remittance calculations

---

## Section 4 — Membership *(hidden if store.features.memberships = false)*

### Membership KPI Cards

| Card | Value |
|------|-------|
| Active Members | Current count (not date-filtered) |
| New This Period | Members who activated in date range |
| Churned This Period | Members who went overdue or expired in range |
| Pass Sales | Count of passes sold in range |

### Active Members Over Time
- Line chart — total active member count sampled at end of each month
- Shows growth or decline trend across months
- Different from "new members" — this is the running total

### New vs Churned Members
- Grouped bar chart — new members (green) vs churned (red) per month
- Gives a clear picture of net growth

### Membership Revenue
- Bar chart — revenue by membership type per month
- Stacked bars: each plan type is a different color
- Passes shown as a separate stack segment

### Member Status Snapshot
- Doughnut chart — active / overdue / pending / suspended / expired
- Current counts, not date-filtered (reflects right now)

### Pass Analytics *(hidden if no isPass membership types exist)*
- Pass sales over time — bar chart
- Conversion rate — % of pass holders who converted to full membership
- Top pass types by volume

---

## Section 5 — Detail Tables *(collapsible)*

All charts have an expandable table below showing the raw data.
Tables are exportable to CSV.

---

## Backend — New Aggregation Endpoints

All endpoints require `store_owner` or `superadmin` role.
All scoped to `req.user.storeId`.

### Existing (already in sales.js)
- `GET /api/sales/summary` — revenue, count, byMethod, byDay ✓

### New endpoints needed

| Method | Path | Returns |
|--------|------|---------|
| GET | `/api/reports/top-items` | Items ranked by qty and revenue |
| GET | `/api/reports/by-category` | Revenue/qty grouped by category |
| GET | `/api/reports/by-hour` | Transaction count grouped by hour |
| GET | `/api/reports/by-weekday` | Transaction count grouped by day of week |
| GET | `/api/reports/cashiers` | Revenue and count per cashier |
| GET | `/api/reports/members/over-time` | Active member count per month |
| GET | `/api/reports/members/churn` | New vs churned per month |
| GET | `/api/reports/members/by-type` | Revenue per membership type per month |
| GET | `/api/reports/passes` | Pass sales count + conversion rate |

All accept `?from=ISO&to=ISO` query params except member snapshot (current state).

---

## Frontend — `reports.html`

- New page added to app shell and service worker cache
- Linked from `dashboard.html` sidebar/nav
- Accessible to `store_owner` and `superadmin` roles only
- Membership section conditionally rendered based on feature flag
- All charts destroy and re-render on date range change
- Mobile: charts stack vertically, KPI cards wrap to 2×2 grid

---

## Out of Scope (for now)
- Inventory / stock tracking (needs new schema)
- Customer lifetime value on regular POS sales (needs customer tracking)
- Table turn time / covers reporting (needs table management built first)
- Scheduled report emails
- PDF export (CSV only for now)
