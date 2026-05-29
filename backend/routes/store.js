const router = require('express').Router();
const jwt    = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { authenticate, requireRole, roleOnly } = require('../middleware/auth');
const Store = require('../models/Store');

function freshToken(user, storeId) {
  return jwt.sign(
    { userId: user.userId, role: user.role, storeId },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRY || '7d' }
  );
}

// All store routes require authentication
router.use(authenticate);

// GET routes are open to any authenticated role (cashiers need item list too).
// Write routes are gated per-handler with roleOnly().

// GET own store — works for store_owner, superadmin, and cashier
router.get('/', async (req, res) => {
  try {
    let query;
    if (req.user.role === 'superadmin') {
      query = { _id: req.query.storeId };
    } else if (req.user.role === 'cashier') {
      query = { _id: req.user.storeId };
    } else {
      query = { ownerId: req.user.userId };
    }
    const store = await Store.findOne(query);
    if (!store) return res.status(404).json({ error: 'Store not found' });
    res.json(store);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Legacy alias used by existing frontend
router.get('/config', async (req, res) => {
  try {
    const query = req.user.role === 'cashier'
      ? { _id: req.user.storeId }
      : { ownerId: req.user.userId };
    const store = await Store.findOne(query);
    if (!store) return res.status(404).json({ error: 'Store not found' });
    // Return shape compatible with existing frontend
    res.json({
      _id: store._id,
      items: store.items,
      settings: {
        businessName: store.businessName,
        bannerUrl: store.bannerUrl,
        categories: store.categories,
        hiveAccount: store.hiveAccount,
        bitcoinLightningEnabled: store.features.bitcoinLightning,
        bitcoinLightningConfig: store.bitcoinLightningConfig,
      },
      published: store.published,
      features: store.features,
      emailSettings: store.emailSettings,
      ownerEmail: store.ownerEmail,
      backupEmail: store.backupEmail,
      language: store.language,
      tax: store.tax,
      tables: store.tables || [],
      hasKitchenPin: !!store.kitchenPin,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create store (once per owner)
router.post('/', roleOnly('store_owner', 'superadmin'), async (req, res) => {
  try {
    const existing = await Store.findOne({ ownerId: req.user.userId });
    if (existing) return res.status(409).json({ error: 'Store already exists for this account' });

    const { settings, items, published, features, ...rest } = req.body;
    const data = { ...rest, ownerId: req.user.userId };

    if (published !== undefined) data.published = published;
    if (features) data.features = features;
    if (items) data.items = items;

    if (settings) {
      if (settings.businessName !== undefined) data.businessName = settings.businessName;
      if (settings.bannerUrl !== undefined) data.bannerUrl = settings.bannerUrl;
      if (settings.categories !== undefined) data.categories = settings.categories;
      if (settings.hiveAccount !== undefined) data.hiveAccount = settings.hiveAccount;
      if (settings.bitcoinLightningEnabled !== undefined) {
        if (!data.features) data.features = {};
        data.features.bitcoinLightning = settings.bitcoinLightningEnabled;
      }
      if (settings.bitcoinLightningConfig !== undefined) {
        data.bitcoinLightningConfig = settings.bitcoinLightningConfig;
      }
    }

    const store = await Store.create(data);
    // Return a refreshed token with the new storeId so the frontend
    // doesn't need to log out/in before using cashiers, sales, etc.
    const token = freshToken(req.user, store._id);
    res.status(201).json({ store, token });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update store
router.put('/', roleOnly('store_owner', 'superadmin'), async (req, res) => {
  try {
    const { settings, items, published, features, kitchenPin: rawPin, tables, ...rest } = req.body;

    const update = { ...rest };
    if (published !== undefined) update.published = published;
    if (features) update.features = features;
    if (items) update.items = items;
    if (tables !== undefined) update.tables = tables;

    // Hash kitchen PIN if provided
    if (rawPin) {
      update.kitchenPin = await bcrypt.hash(String(rawPin), 10);
    }

    // Flatten legacy settings shape from existing frontend
    if (settings) {
      if (settings.businessName !== undefined) update.businessName = settings.businessName;
      if (settings.bannerUrl !== undefined) update.bannerUrl = settings.bannerUrl;
      if (settings.categories !== undefined) update.categories = settings.categories;
      if (settings.hiveAccount !== undefined) update.hiveAccount = settings.hiveAccount;
      if (settings.bitcoinLightningEnabled !== undefined) {
        update['features.bitcoinLightning'] = settings.bitcoinLightningEnabled;
      }
      if (settings.bitcoinLightningConfig !== undefined) {
        update.bitcoinLightningConfig = settings.bitcoinLightningConfig;
      }
    }

    const store = await Store.findOneAndUpdate(
      { ownerId: req.user.userId },
      { $set: update },
      { new: true, upsert: true }
    );
    // If the JWT was missing storeId (first-time upsert), return a fresh token
    const payload = { store };
    if (!req.user.storeId) payload.token = freshToken(req.user, store._id);
    res.json(payload);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Legacy PUT /stores/:id used by existing frontend
router.put('/:id', roleOnly('store_owner', 'superadmin'), async (req, res) => {
  try {
    const { settings, items, published, features, ...rest } = req.body;
    const update = { ...rest };
    if (published !== undefined) update.published = published;
    if (features) update.features = features;
    if (items) update.items = items;
    if (settings) {
      if (settings.businessName !== undefined) update.businessName = settings.businessName;
      if (settings.bannerUrl !== undefined) update.bannerUrl = settings.bannerUrl;
      if (settings.categories !== undefined) update.categories = settings.categories;
      if (settings.hiveAccount !== undefined) update.hiveAccount = settings.hiveAccount;
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
