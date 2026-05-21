const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true, lowercase: true, trim: true },
  password: { type: String, required: true },
  hiveAccount: { type: String, trim: true, default: '' },
  role: { type: String, enum: ['superadmin', 'store_owner'], default: 'store_owner' },
  approved: { type: Boolean, default: false },
}, { timestamps: true });

module.exports = mongoose.model('User', userSchema);
