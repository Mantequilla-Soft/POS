'use strict';
const router       = require('express').Router();
const { authenticate, requireRole } = require('../middleware/auth');
const PricingConfig = require('../models/PricingConfig');
const Subscription  = require('../models/Subscription');
const Store         = require('../models/Store');
const { computePlanPrice } = require('../utils/pricing');

async function getOrCreateConfig() {
  let cfg = await PricingConfig.findById('global');
  if (!cfg) {
    cfg = await PricingConfig.create({
      _id: 'global',
      basePrice: parseFloat(process.env.BILLING_PLAN_PRICE || '5'),
    });
  }
  return cfg;
}

// GET /api/pricing — public, no auth required
router.get('/', async (req, res) => {
  try {
    const cfg = await getOrCreateConfig();
    res.json(cfg);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/admin/pricing — superadmin only; updates config + reprice all non-overridden subscriptions
router.put('/', authenticate, requireRole('superadmin'), async (req, res) => {
  try {
    const { basePrice, currency, addons } = req.body;
    const update = {};
    if (basePrice  !== undefined) update.basePrice  = basePrice;
    if (currency   !== undefined) update.currency   = currency;
    if (addons     !== undefined) update.addons     = addons;

    const cfg = await PricingConfig.findByIdAndUpdate(
      'global',
      { $set: update },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    // Reprice every store that hasn't been manually overridden.
    // periodHighPrice only rises — a global price change that lowers a store's
    // price still can't undercut what was already owed this period.
    const stores = await Store.find({}, '_id features');
    await Promise.all(stores.map(async store => {
      const newPrice = computePlanPrice(store.features || {}, cfg);
      const sub = await Subscription.findOne({ storeId: store._id, priceOverride: { $ne: true } });
      if (!sub) return;
      sub.planPrice = newPrice;
      if (newPrice > (sub.periodHighPrice || 0)) sub.periodHighPrice = newPrice;
      await sub.save();
    }));

    res.json(cfg);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
module.exports.getOrCreateConfig = getOrCreateConfig;
