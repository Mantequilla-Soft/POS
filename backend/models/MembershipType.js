const mongoose = require('mongoose');

const membershipTypeSchema = new mongoose.Schema({
  storeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Store', required: true },
  name: { type: String, required: true, trim: true },
  price: { type: Number, required: true },
  currency: { type: String, default: 'HBD' },
  durationDays: { type: Number, required: true },
  description: { type: String, default: '' },
  active: { type: Boolean, default: true },
}, { timestamps: true });

module.exports = mongoose.model('MembershipType', membershipTypeSchema);
