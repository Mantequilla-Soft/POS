const mongoose = require('mongoose');

const memberSchema = new mongoose.Schema({
  storeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Store', required: true },
  name: { type: String, required: true, trim: true },
  phone: { type: String, default: '' },
  email: { type: String, default: '' },
  hiveAccount: { type: String, default: '' },
  membershipTypeId: { type: mongoose.Schema.Types.ObjectId, ref: 'MembershipType', required: true },
  startDate: { type: Date, default: null },
  nextDueDate: { type: Date, default: null },
  status: { type: String, enum: ['pending', 'active', 'overdue', 'suspended', 'expired'], default: 'pending' },
  gender:   { type: String, enum: ['male', 'female', 'other', 'unspecified'], default: 'unspecified' },
  ageGroup: { type: String, enum: ['under_18', '18_25', '26_35', '36_45', '46_55', '56_plus', 'unspecified'], default: 'unspecified' },
  createdBy: { type: String, default: '' },
  notes: { type: String, default: '' },
  lastReminderSent: { type: Date, default: null },
}, { timestamps: true });

memberSchema.index({ storeId: 1, status: 1 });
memberSchema.index({ storeId: 1, name: 'text', phone: 'text', hiveAccount: 'text' });

module.exports = mongoose.model('Member', memberSchema);
