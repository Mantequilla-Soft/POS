const mongoose = require('mongoose');

const discountCodeSchema = new mongoose.Schema({
  storeId:       { type: mongoose.Schema.Types.ObjectId, ref: 'Store', required: true, index: true },
  code:          { type: String, required: true, uppercase: true, trim: true },
  type:          { type: String, enum: ['percent', 'fixed'], required: true },
  value:         { type: Number, required: true },
  minCartAmount: { type: Number, default: 0 },
  maxUses:       { type: Number, default: 0 },   // 0 = unlimited
  usedCount:     { type: Number, default: 0 },
  expiresAt:     { type: Date, default: null },
  active:        { type: Boolean, default: true },
}, { timestamps: true });

discountCodeSchema.index({ storeId: 1, code: 1 }, { unique: true });

module.exports = mongoose.model('DiscountCode', discountCodeSchema);
