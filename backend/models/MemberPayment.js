const mongoose = require('mongoose');

const memberPaymentSchema = new mongoose.Schema({
  memberId: { type: mongoose.Schema.Types.ObjectId, ref: 'Member', required: true },
  storeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Store', required: true },
  membershipTypeId: { type: mongoose.Schema.Types.ObjectId, ref: 'MembershipType' },
  amount: { type: Number, required: true },
  currency: { type: String, default: 'HBD' },
  method: { type: String, enum: ['hbd', 'cash', 'bank_transfer', 'card', 'check', 'other'], required: true },
  paymentNotes: { type: String, default: '' },
  hiveTransactionMemo: { type: String, default: '' },
  hiveFrom: { type: String, default: '' },
  paidDate: { type: Date, required: true },
  periodStart: { type: Date, required: true },
  periodEnd: { type: Date, required: true },
  notes: { type: String, default: '' },
  recordedBy: { type: String, default: '' },
}, { timestamps: true });

memberPaymentSchema.index({ memberId: 1, paidDate: -1 });

module.exports = mongoose.model('MemberPayment', memberPaymentSchema);
