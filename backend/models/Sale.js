const mongoose = require('mongoose');

const saleItemSchema = new mongoose.Schema({
  id:       String,
  name:     { type: String, required: true },
  category: String,
  price:    { type: Number, required: true },
  qty:      { type: Number, required: true },
}, { _id: false });

const saleSchema = new mongoose.Schema({
  storeId:          { type: mongoose.Schema.Types.ObjectId, ref: 'Store', required: true, index: true },
  items:            [saleItemSchema],
  subtotal:         { type: Number, default: 0 },
  taxAmount:        { type: Number, default: 0 },
  total:            { type: Number, required: true },
  currency:         { type: String, default: 'USD' },
  paymentMethod:    { type: String, enum: ['hbd', 'hive', 'cash', 'lightning', 'bank_transfer', 'card', 'check', 'other'], required: true },
  paymentNotes:     { type: String, default: '' },
  hiveFrom:         String,
  hiveTransactionId:String,
  cashier:          String,
}, { timestamps: true });

module.exports = mongoose.model('Sale', saleSchema);
