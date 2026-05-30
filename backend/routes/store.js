const router = require('express').Router();
const jwt    = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { authenticate, requireRole, roleOnly } = require('../middleware/auth');
const Store        = require('../models/Store');
const Subscription = require('../models/Subscription');
const { getOrCreateConfig } = require('./pricing');
const { computePlanPrice }  = require('../utils/pricing');

function freshToken(user, storeId) {
  return jwt.sign(
    { userId: user.userId, role: user.role, storeId },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRY || '7d' }
  );
}

// Strip server-only fields (secrets) from pluginConfigs before sending to frontend.
// Fields matching /secret|private|password/i are replaced with `${key}_saved: bool`.
function safePluginConfigs(configs) {
  if (!configs || typeof configs !== 'object') return {};
  const result = {};
  for (const [pluginId, cfg] of Object.entries(configs)) {
    if (!cfg || typeof cfg !== 'object') { result[pluginId] = cfg; continue; }
    const safe = {};
    for (const [k, v] of Object.entries(cfg)) {
      if (/secret|private|password/i.test(k)) {
        safe[`${k}_saved`] = !!v;
      } else {
        safe[k] = v;
      }
    }
    result[pluginId] = safe;
  }
  return result;
}

// Merge incoming pluginConfigs with existing ones, preserving secrets if not re-sent.
function mergePluginConfigs(existing, incoming) {
  const merged = { ...(existing || {}) };
  for (const [pluginId, cfg] of Object.entries(incoming || {})) {
    if (!merged[pluginId]) merged[pluginId] = {};
    for (const [k, v] of Object.entries(cfg)) {
      // Don't overwrite a saved secret with an empty string
      if (/secret|private|password/i.test(k) && !v && merged[pluginId][k]) continue;
      merged[pluginId][k] = v;
    }
  }
  return merged;
}

router.use(authenticate);

// GET own store
router.get('/', async (req, res) => {
  try {
    let query;
    if (req.user.role === 'superadmin')     query = { _id: req.query.storeId };
    else if (req.user.role === 'cashier')   query = { _id: req.user.storeId };
    else                                    query = { ownerId: req.user.userId };
    const store = await Store.findOne(query);
    if (!store) return res.status(404).json({ error: 'Store not found' });
    res.json(store);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /config — frontend-safe shape consumed by POS, dashboard, etc.
router.get('/config', async (req, res) => {
  try {
    const query = req.user.role === 'cashier'
      ? { _id: req.user.storeId }
      : { ownerId: req.user.userId };
    const store = await Store.findOne(query);
    if (!store) return res.status(404).json({ error: 'Store not found' });

    const pc = store.pluginConfigs || {};

    // Backward-compat: hive plugin auto-enabled if hiveAccount is set and no explicit config yet
    if (!pc.hive && store.hiveAccount) {
      pc.hive = { enabled: true, hiveAccount: store.hiveAccount };
    }

    res.json({
      _id:      store._id,
      items:    store.items,
      settings: {
        businessName:           store.businessName,
        bannerUrl:              store.bannerUrl,
        categories:             store.categories,
        hiveAccount:            store.hiveAccount,
        // legacy fields kept for older POS clients
        bitcoinLightningEnabled: !!(pc.lightning?.enabled),
        bitcoinLightningConfig:  pc.lightning
          ? (({ enabled, ...rest }) => rest)(pc.lightning)
          : null,
      },
      published:     store.published,
      features:      store.features,
      pluginConfigs: safePluginConfigs(pc),
      emailSettings: store.emailSettings,
      ownerEmail:    store.ownerEmail,
      backupEmail:   store.backupEmail,
      language:      store.language,
      tax:           store.tax,
      tables:        store.tables || [],
      hasKitchenPin: !!store.kitchenPin,
      theme:         store.theme || null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST / — create store (once per owner)
router.post('/', roleOnly('store_owner', 'superadmin'), async (req, res) => {
  try {
    const existing = await Store.findOne({ ownerId: req.user.userId });
    if (existing) return res.status(409).json({ error: 'Store already exists for this account' });

    const { settings, items, published, features, pluginConfigs, ...rest } = req.body;
    const data = { ...rest, ownerId: req.user.userId };

    if (published !== undefined)  data.published = published;
    if (features)                 data.features  = features;
    if (items)                    data.items      = items;
    if (pluginConfigs)            data.pluginConfigs = pluginConfigs;

    if (settings) {
      if (settings.businessName !== undefined)  data.businessName = settings.businessName;
      if (settings.bannerUrl    !== undefined)  data.bannerUrl    = settings.bannerUrl;
      if (settings.categories   !== undefined)  data.categories   = settings.categories;
      if (settings.hiveAccount  !== undefined)  data.hiveAccount  = settings.hiveAccount;
    }

    const store = await Store.create(data);

    if (process.env.BILLING_ENABLED !== 'false') {
      const trialDays = parseInt(process.env.BILLING_TRIAL_DAYS || '30');
      await Subscription.create({
        storeId:          store._id,
        status:           'trial',
        planPrice:        parseFloat(process.env.BILLING_PLAN_PRICE || '5'),
        trialEndsAt:      new Date(Date.now() + trialDays * 86400000),
        currentPeriodEnd: new Date(Date.now() + trialDays * 86400000),
      });
    }

    const token = freshToken(req.user, store._id);
    res.status(201).json({ store, token });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT / — update store
router.put('/', roleOnly('store_owner', 'superadmin'), async (req, res) => {
  try {
    const { settings, items, published, features, pluginConfigs: incomingPlugins, kitchenPin: rawPin, tables, theme, ...rest } = req.body;

    const update = { ...rest };
    if (published !== undefined) update.published = published;
    if (features)                update.features  = features;
    if (items)                   update.items     = items;
    if (tables !== undefined)    update.tables    = tables;
    if (theme !== undefined)     update.theme     = theme;

    if (rawPin) {
      update.kitchenPin = await bcrypt.hash(String(rawPin), 10);
    }

    if (settings) {
      if (settings.businessName !== undefined) update.businessName = settings.businessName;
      if (settings.bannerUrl    !== undefined) update.bannerUrl    = settings.bannerUrl;
      if (settings.categories   !== undefined) update.categories   = settings.categories;
      if (settings.hiveAccount  !== undefined) update.hiveAccount  = settings.hiveAccount;
    }

    if (incomingPlugins) {
      const existing = await Store.findOne({ ownerId: req.user.userId }, 'pluginConfigs');
      update.pluginConfigs = mergePluginConfigs(existing?.pluginConfigs, incomingPlugins);
    }

    const store = await Store.findOneAndUpdate(
      { ownerId: req.user.userId },
      { $set: update },
      { new: true, upsert: true }
    );

    // Reprice subscription when features change.
    // planPrice always tracks current features; periodHighPrice is the billing
    // floor for this period and only moves up — never down mid-period.
    if (features) {
      try {
        const cfg = await getOrCreateConfig();
        const newPrice = computePlanPrice(store.features || {}, cfg);
        const sub = await Subscription.findOne({ storeId: store._id, priceOverride: { $ne: true } });
        if (sub) {
          sub.planPrice = newPrice;
          if (newPrice > (sub.periodHighPrice || 0)) sub.periodHighPrice = newPrice;
          await sub.save();
        }
      } catch (_) {}
    }

    const payload = { store };
    if (!req.user.storeId) payload.token = freshToken(req.user, store._id);
    res.json(payload);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Legacy PUT /stores/:id
router.put('/:id', roleOnly('store_owner', 'superadmin'), async (req, res) => {
  try {
    const { settings, items, published, features, pluginConfigs: incomingPlugins, ...rest } = req.body;
    const update = { ...rest };
    if (published !== undefined) update.published = published;
    if (features)                update.features  = features;
    if (items)                   update.items     = items;
    if (settings) {
      if (settings.businessName !== undefined) update.businessName = settings.businessName;
      if (settings.bannerUrl    !== undefined) update.bannerUrl    = settings.bannerUrl;
      if (settings.categories   !== undefined) update.categories   = settings.categories;
      if (settings.hiveAccount  !== undefined) update.hiveAccount  = settings.hiveAccount;
    }
    if (incomingPlugins) {
      const existing = await Store.findOne({ _id: req.params.id, ownerId: req.user.userId }, 'pluginConfigs');
      update.pluginConfigs = mergePluginConfigs(existing?.pluginConfigs, incomingPlugins);
    }
    const store = await Store.findOneAndUpdate(
      { _id: req.params.id, ownerId: req.user.userId },
      { $set: update },
      { new: true }
    );
    if (!store) return res.status(404).json({ error: 'Store not found' });
    res.json(store);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
