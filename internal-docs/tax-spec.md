# Sales Tax — Feature Spec

## Goal
Allow stores to optionally enable a flat sales tax rate. The app calculates and
displays tax on receipts and tracks it in sale records for reporting.

## Store Settings (per store, optional)

| Field | Type | Description |
|-------|------|-------------|
| `taxEnabled` | Boolean | Master switch — default false |
| `taxRate` | Number | Percentage, e.g. `13` for 13% |
| `taxName` | String | Display name: "IVA", "Sales Tax", "VAT", etc. |
| `taxInclusive` | Boolean | See models below |

## Tax Models

### Tax-Exclusive (taxInclusive = false)
Prices do not include tax. Tax is calculated and added at checkout.
Common in the US.
```
Item total:  $10.00
IVA (13%):    $1.30
Total:       $11.30
```

### Tax-Inclusive (taxInclusive = true)
Prices already include tax. The receipt shows what portion of the total was tax.
Common in Latin America and Europe.
```
Total:       $11.30
Includes IVA (13%): $1.30
```

> For most small restaurants in LatAm, tax-inclusive is the right default.

## Sale Record Changes

When tax is enabled, the Sale document stores:

```js
subtotal:   { type: Number, default: 0 }   // pre-tax amount
taxAmount:  { type: Number, default: 0 }   // tax collected
total:      { type: Number, required: true } // always the amount the customer pays
```

For tax-exclusive: `total = subtotal + taxAmount`
For tax-inclusive: `total = subtotal + taxAmount` (same formula, different display)

The `taxAmount` field enables a future "Tax Collected" report.

## Frontend Changes
- `admin.html` — new Tax section in store settings: enable toggle, rate input,
  name input, inclusive/exclusive toggle
- `pos.html` — receipt breakdown shows subtotal + tax line when enabled
- `quick-sale.html` — same receipt breakdown
- Reports — "Tax Collected" added to Sales Performance section when tax is enabled

## Out of Scope (for now)
- Per-item taxability (e.g. food exempt, alcohol taxed) — flat rate on everything
- Multi-rate tax (e.g. different rates per category)
- Tax remittance / filing — this is a recording tool, not an accounting system
