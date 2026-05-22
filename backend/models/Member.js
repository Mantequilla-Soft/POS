const mongoose = require('mongoose');

const memberSchema = new mongoose.Schema({
  storeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Store', required: true },
  name: { type: String, required: true, trim: true },
  phone: { type: String, default: '' },
  email: { type: String, default: '' },
  hiveAccount: { type: String, default: '' },
  membershipTypeId: { type: mongoose.Schema.Types.ObjectId, ref: 'MembershipType', required: true },
  startDate: { type: Date, required: true },
  nextDueDate: { type: Date, required: true },
  status: { type: String, enum: ['active', 'overdue', 'suspended', 'expired'], default: 'active' },
  notes: { type: String, default: '' },
  lastReminderSent: { type: Date, default: null },
}, { timestamps: true });

memberSchema.index({ storeId: 1, status: 1 });
memberSchema.index({ storeId: 1, name: 'text', phone: 'text', hiveAccount: 'text' });

module.exports = mongoose.model('Member', memberSchema);
