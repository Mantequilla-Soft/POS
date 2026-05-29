const mongoose = require('mongoose');

const emailTemplateSchema = new mongoose.Schema({
  storeId:     { type: mongoose.Schema.Types.ObjectId, ref: 'Store', required: true },
  name:        { type: String, required: true, trim: true },
  subject:     { type: String, default: '' },
  previewText: { type: String, default: '' },
  body:        { type: String, default: '' },
  createdBy:   { type: String, default: '' },
}, { timestamps: true });

emailTemplateSchema.index({ storeId: 1 });

module.exports = mongoose.model('EmailTemplate', emailTemplateSchema);
