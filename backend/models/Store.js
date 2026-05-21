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
    memberships: { type: Boolean, default: false },
    bitcoinLightning: { type: Boolean, default: false },
  },
  bitcoinLightningConfig: { type: mongoose.Schema.Types.Mixed, default: null },
  published: { type: Boolean, default: false },
  items: { type: [itemSchema], default: [] },
}, { timestamps: true });

module.exports = mongoose.model('Store', storeSchema);
