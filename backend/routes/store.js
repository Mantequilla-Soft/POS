const router = require('express').Router();
const { requireRole } = require('../middleware/auth');
const Store = require('../models/Store');

router.use(requireRole('store_owner', 'superadmin'));

// GET own store (also used as /api/config equivalent by frontend)
router.get('/', async (req, res) => {
  try {
    const query = req.user.role === 'superadmin'
      ? { _id: req.query.storeId }
      : { ownerId: req.user.userId };
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
    const store = await Store.findOne({ ownerId: req.user.userId });
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
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create store (once per owner)
router.post('/', async (req, res) => {
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
    res.status(201).json(store);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update store
router.put('/', async (req, res) => {
  try {
    const { settings, items, published, features, ...rest } = req.body;

    const update = { ...rest };
    if (published !== undefined) update.published = published;
    if (features) update.features = features;
    if (items) update.items = items;

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
    res.json(store);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Legacy PUT /stores/:id used by existing frontend
router.put('/:id', async (req, res) => {
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
