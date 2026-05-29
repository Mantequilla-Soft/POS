const mongoose = require('mongoose');

const saleItemSchema = new mongoose.Schema({
  id:            String,
  name:          { type: String, required: true },
  category:      String,
  price:         { type: Number, required: true },
  qty:           { type: Number, required: true },
  notes:         { type: String, default: '' },
  kitchenStatus: { type: String, enum: ['pending', 'ready'], default: 'pending' },
}, { _id: false });

const saleSchema = new mongoose.Schema({
  storeId:          { type: mongoose.Schema.Types.ObjectId, ref: 'Store', required: true, index: true },
  items:            [saleItemSchema],
  subtotal:         { type: Number, default: 0 },
  taxAmount:        { type: Number, default: 0 },
  total:            { type: Number, default: 0 },
  currency:         { type: String, default: 'USD' },
  paymentMethod:    { type: String, enum: ['hbd', 'hive', 'cash', 'lightning', 'bank_transfer', 'card', 'check', 'other'], default: null },
  paymentNotes:     { type: String, default: '' },
  hiveFrom:         String,
  hiveTransactionId:String,
  cashier:          String,
  status:           { type: String, enum: ['open', 'closed'], default: 'closed', index: true },
  tableId:          { type: String, default: '' },
  tableLabel:       { type: String, default: '' },
  openedAt:         Date,
  closedAt:         Date,
  discountCode:     { type: String, default: '' },
  discountAmount:   { type: Number, default: 0 },
}, { timestamps: true });

module.exports = mongoose.model('Sale', saleSchema);
