'use strict';
const mongoose = require('mongoose');

const inventoryItemSchema = new mongoose.Schema({
  storeId:      { type: mongoose.Schema.Types.ObjectId, ref: 'Store', required: true },
  name:         { type: String, required: true, trim: true },
  unit:         { type: String, default: 'each', trim: true },
  category:     { type: String, default: '', trim: true },
  reorderPoint: { type: Number, default: 0 },
  active:       { type: Boolean, default: true },
}, { timestamps: true });

inventoryItemSchema.index({ storeId: 1, active: 1 });

module.exports = mongoose.model('InventoryItem', inventoryItemSchema);
