'use strict';
const mongoose = require('mongoose');

const staffTipsSchema = new mongoose.Schema({
  staffId:      { type: String, default: '' },
  staffName:    { type: String, required: true },
  tipCash:      { type: Number, default: 0 },
  tipTransfer:  { type: Number, default: 0 },
}, { _id: false });

const shiftEntrySchema = new mongoose.Schema({
  shiftId:    { type: String, default: '' },
  shiftLabel: { type: String, required: true },
  staff:      { type: [staffTipsSchema], default: [] },
}, { _id: false });

const deductionSchema = new mongoose.Schema({
  categoryId: { type: String, default: 'custom' },
  label:      { type: String, required: true },
  amount:     { type: Number, default: 0 },
  note:       { type: String, default: '' },
}, { _id: false });

const closeoutSchema = new mongoose.Schema({
  storeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Store', required: true, index: true },

  // YYYY-MM-DD business date string — avoids UTC/TZ drift
  date: { type: String, required: true },

  // Sales figures — auto-filled from Sale collection but cashier-editable
  totalSales:     { type: Number, default: 0 },
  transferAmount: { type: Number, default: 0 },
  cashSales:      { type: Number, default: 0 },

  // Physical cash drawer reconciliation — null means "not counted yet",
  // distinct from a counted value of 0.
  actualCashCounted: { type: Number, default: null },
  cashVariance:      { type: Number, default: 0 },
  cashVarianceNote:  { type: String, default: '' },

  shifts:     { type: [shiftEntrySchema],  default: [] },
  deductions: { type: [deductionSchema],   default: [] },

  // Computed totals stored at save/submit time
  totalTipsCash:     { type: Number, default: 0 },
  totalTipsTransfer: { type: Number, default: 0 },
  totalDeductions:   { type: Number, default: 0 },
  cashDelivered:     { type: Number, default: 0 },
  bankTotal:         { type: Number, default: 0 },

  notes:       { type: String, default: '' },
  submittedBy: { type: String, default: '' },
  submittedAt: { type: Date,   default: null },

  status: {
    type: String,
    enum: ['draft', 'submitted', 'reviewed'],
    default: 'draft',
    index: true,
  },

  reviewedBy:      { type: String, default: '' },
  reviewedAt:      { type: Date,   default: null },
  reviewComment:   { type: String, default: '' },

}, { timestamps: true });

closeoutSchema.index({ storeId: 1, date: 1 }, { unique: true });
closeoutSchema.index({ storeId: 1, createdAt: -1 });

module.exports = mongoose.model('Closeout', closeoutSchema);
