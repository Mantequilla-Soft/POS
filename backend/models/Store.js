const mongoose = require('mongoose');

const itemSchema = new mongoose.Schema({
  id: String,
  name: String,
  category: String,
  image: String,
  price: Number,
}, { _id: false });

const storeSchema = new mongoose.Schema({
  ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  businessName: { type: String, default: '' },
  hiveAccount: { type: String, default: '' },
  bannerUrl: { type: String, default: '' },
  categories: { type: [String], default: [] },
  currency: { type: String, default: 'HBD' },
  features: {
    memberships:      { type: Boolean, default: false },
    bitcoinLightning: { type: Boolean, default: false },
    emailReminders:   { type: Boolean, default: false },
    emailCampaigns:   { type: Boolean, default: false },
    hive:             { type: Boolean, default: false },
    tabs:             { type: Boolean, default: false },
    kitchenDisplay:   { type: Boolean, default: false },
    stripe:           { type: Boolean, default: false },
  },
  stripeConfig: {
    secretKey:      { type: String, default: '' },
    publishableKey: { type: String, default: '' },
  },
  kitchenPin: { type: String, default: '' },
  tables: {
    type: [{
      _id: false,
      id:     { type: String, required: true },
      label:  { type: String, required: true },
      active: { type: Boolean, default: true },
    }],
    default: [],
  },
  tax: {
    enabled:   { type: Boolean, default: false },
    rate:      { type: Number,  default: 0 },
    name:      { type: String,  default: 'Tax' },
    inclusive: { type: Boolean, default: false },
  },
  language: { type: String, default: 'en' },
  emailSettings: {
    reminderSubject: { type: String, default: '' },
    reminderBody:    { type: String, default: '' },
  },
  ownerEmail:   { type: String,  default: '' },
  backupEmail:  { type: Boolean, default: true },
  bitcoinLightningConfig: { type: mongoose.Schema.Types.Mixed, default: null },
  published: { type: Boolean, default: false },
  items: { type: [itemSchema], default: [] },
}, { timestamps: true });

module.exports = mongoose.model('Store', storeSchema);
