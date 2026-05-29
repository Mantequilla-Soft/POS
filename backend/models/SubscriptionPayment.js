const mongoose = require('mongoose');

const subPaymentSchema = new mongoose.Schema({
  storeId:               { type: mongoose.Schema.Types.ObjectId, ref: 'Store', required: true },
  subscriptionId:        { type: mongoose.Schema.Types.ObjectId, ref: 'Subscription', required: true },
  amount:                { type: Number, required: true },
  currency:              { type: String, default: 'HBD' },
  method:                { type: String, enum: ['hbd', 'stripe', 'manual'], required: true },
  hiveFrom:              { type: String, default: '' },
  hiveTxMemo:            { type: String, default: '' },
  hiveTxId:              { type: String, default: '' },
  stripePaymentIntentId: { type: String, default: '' },
  periodStart:           { type: Date, required: true },
  periodEnd:             { type: Date, required: true },
  paidAt:                { type: Date, default: Date.now },
  recordedBy:            { type: String, default: 'auto' },
}, { timestamps: true });

module.exports = mongoose.model('SubscriptionPayment', subPaymentSchema);
