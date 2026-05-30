const mongoose = require('mongoose');

const subscriptionSchema = new mongoose.Schema({
  storeId:          { type: mongoose.Schema.Types.ObjectId, ref: 'Store', required: true, unique: true },
  status:           { type: String, enum: ['trial', 'active', 'overdue', 'comped', 'suspended'], default: 'trial' },
  planPrice:        { type: Number, default: 5 },
  planCurrency:     { type: String, default: 'HBD' },
  trialEndsAt:      { type: Date },
  currentPeriodEnd: { type: Date },
  compedUntil:      { type: Date, default: null },
  stripeCustomerId: { type: String, default: '' },
  notes:            { type: String, default: '' },
  priceOverride:    { type: Boolean, default: false },
  periodHighPrice:  { type: Number, default: 0 },
}, { timestamps: true });

module.exports = mongoose.model('Subscription', subscriptionSchema);
