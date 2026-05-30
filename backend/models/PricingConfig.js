const mongoose = require('mongoose');

const pricingConfigSchema = new mongoose.Schema({
  _id: { type: String, default: 'global' },
  basePrice: { type: Number, default: 5 },
  currency:  { type: String, default: 'HBD' },
  addons: {
    restaurantFeatures: { type: Number, default: 0 },
    memberships:        { type: Number, default: 0 },
    emailCampaigns:     { type: Number, default: 0 },
    discountCodes:      { type: Number, default: 0 },
    reservations:       { type: Number, default: 0 },
    hotel:              { type: Number, default: 0 },
  },
}, { timestamps: true });

module.exports = mongoose.model('PricingConfig', pricingConfigSchema);
