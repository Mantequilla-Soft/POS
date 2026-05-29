# Payment Methods — Feature Spec

## Goal
Expand the payment method field beyond `cash` and `hbd` to cover external payment
methods the app doesn't process — it just records them. Applies to both regular
sales and membership payments.

## Supported Methods

| Value | Label | Notes |
|-------|-------|-------|
| `cash` | Cash | Physical currency |
| `hbd` | HBD | Hive blockchain payment (existing QR flow) |
| `bank_transfer` | Bank Transfer | Wire, ACH, SINPE, etc. |
| `card` | Credit / Debit Card | External terminal — app does not process |
| `check` | Check | Less common but used by some businesses |
| `other` | Other | Free-text notes field required when selected |

## Design Decisions
- **Fixed list, not store-configurable.** Covers 95% of real-world cases without
  added complexity. The `other` + notes field serves as the escape hatch.
- **Notes field** — optional on all methods, required when `other` is selected.
  Stored as `paymentNotes` on the Sale and MemberPayment records.

## Schema Changes Required

### Sale model
```js
paymentMethod: { type: String, enum: ['cash','hbd','bank_transfer','card','check','other'], required: true }
paymentNotes:  { type: String, default: '' }
```

### MemberPayment model
```js
method:        { type: String, enum: ['cash','hbd','bank_transfer','card','check','other'], required: true }
paymentNotes:  { type: String, default: '' }
```

## Frontend Changes
- POS payment method selector: add new options with friendly labels
- Members payment modal: same expansion
- `reviewreceipts.html` filter: add new methods to the method dropdown
- Reports payment split: automatically reflects all methods (no change needed)
