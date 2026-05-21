const mongoose = require('mongoose');

const cashierSchema = new mongoose.Schema({
  storeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Store', required: true },
  username: { type: String, required: true, lowercase: true, trim: true },
  password: { type: String, required: true },
  active: { type: Boolean, default: true },
}, { timestamps: true });

cashierSchema.index({ storeId: 1, username: 1 }, { unique: true });

module.exports = mongoose.model('Cashier', cashierSchema);
