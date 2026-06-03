'use strict';
const mongoose = require('mongoose');

const countLineSchema = new mongoose.Schema({
  itemId:      { type: mongoose.Schema.Types.ObjectId, ref: 'InventoryItem', required: true },
  itemName:    { type: String, default: '' },   // snapshot — item may be renamed later
  unit:        { type: String, default: '' },
  expectedQty: { type: Number, default: 0 },
  actualQty:   { type: Number, default: 0 },
  variance:    { type: Number, default: 0 },    // actualQty - expectedQty
  notes:       { type: String, default: '' },
}, { _id: false });

const stockCountSchema = new mongoose.Schema({
  storeId:     { type: mongoose.Schema.Types.ObjectId, ref: 'Store', required: true },
  periodStart: { type: Date, required: true },
  periodEnd:   { type: Date, required: true },
  status:      { type: String, enum: ['draft', 'completed'], default: 'draft' },
  lines:       { type: [countLineSchema], default: [] },
  completedAt: { type: Date, default: null },
}, { timestamps: true });

stockCountSchema.index({ storeId: 1, createdAt: -1 });

module.exports = mongoose.model('StockCount', stockCountSchema);
