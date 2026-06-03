'use strict';
const mongoose = require('mongoose');

const stockMovementSchema = new mongoose.Schema({
  storeId:    { type: mongoose.Schema.Types.ObjectId, ref: 'Store',         required: true },
  itemId:     { type: mongoose.Schema.Types.ObjectId, ref: 'InventoryItem', required: true },
  type:       { type: String, enum: ['opening', 'purchase', 'adjustment'],  required: true },
  qty:        { type: Number, required: true },       // positive = in, negative = out/loss
  unitCost:   { type: Number, default: 0 },           // cost per unit; meaningful for purchases
  supplier:   { type: String, default: '', trim: true },
  date:       { type: Date,   default: Date.now },
  notes:      { type: String, default: '', trim: true },
  createdBy:  { type: String, default: '' },          // username of whoever logged the entry
}, { timestamps: true });

stockMovementSchema.index({ storeId: 1, itemId: 1, date: -1 });

module.exports = mongoose.model('StockMovement', stockMovementSchema);
