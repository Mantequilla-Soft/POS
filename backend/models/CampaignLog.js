const mongoose = require('mongoose');

const campaignLogSchema = new mongoose.Schema({
  storeId:          { type: mongoose.Schema.Types.ObjectId, ref: 'Store', required: true },
  subject:          { type: String, required: true },
  previewText:      { type: String, default: '' },
  body:             { type: String, default: '' },
  filters:          { type: mongoose.Schema.Types.Mixed, default: {} },
  targetedCount:    { type: Number, default: 0 },
  skippedNoEmail:   { type: Number, default: 0 },
  skippedOptOut:    { type: Number, default: 0 },
  sentCount:        { type: Number, default: 0 },
  errorCount:       { type: Number, default: 0 },
  sentBy:           { type: String, default: '' },
  sentAt:           { type: Date,   default: Date.now },
}, { timestamps: true });

campaignLogSchema.index({ storeId: 1, sentAt: -1 });

module.exports = mongoose.model('CampaignLog', campaignLogSchema);
