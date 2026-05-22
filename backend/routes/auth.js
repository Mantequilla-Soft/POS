const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Store = require('../models/Store');
const Cashier = require('../models/Cashier');

router.post('/register', async (req, res) => {
  try {
    const { username, password, hiveAccount } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'username and password required' });

    const lower = username.toLowerCase();
    const exists = await User.findOne({ username: lower });
    if (exists) return res.status(409).json({ error: 'Username already taken' });

    const isSuperadmin = lower === (process.env.SUPERADMIN_USERNAME || '').toLowerCase();
    const hash = await bcrypt.hash(password, 10);
    await User.create({
      username: lower,
      password: hash,
      hiveAccount: hiveAccount || '',
      role: isSuperadmin ? 'superadmin' : 'store_owner',
      approved: isSuperadmin,
    });
    const message = isSuperadmin
      ? 'Superadmin account created. You can log in now.'
      : 'Account created. Awaiting admin approval.';
    res.status(201).json({ message });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'username and password required' });

    const user = await User.findOne({ username: username.toLowerCase() });
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

    // Auto-promote first login of superadmin username
    if (
      user.username === (process.env.SUPERADMIN_USERNAME || '').toLowerCase() &&
      user.role !== 'superadmin'
    ) {
      user.role = 'superadmin';
      user.approved = true;
      await user.save();
    }

    if (!user.approved) {
      return res.status(403).json({ error: 'Account pending admin approval' });
    }

    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(401).json({ error: 'Invalid credentials' });

    const store = user.role === 'store_owner'
      ? await Store.findOne({ ownerId: user._id }).select('_id features')
      : null;

    const token = jwt.sign(
      { userId: user._id, role: user.role, storeId: store?._id ?? null, username: user.username },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRY || '7d' }
    );

    res.json({
      token,
      user: { id: user._id, username: user.username, role: user.role },
      store: store ? { id: store._id, features: store.features } : null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Cashier login — separate from store owner login
router.post('/cashier-login', async (req, res) => {
  try {
    const { username, password, storeHiveAccount } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'username and password required' });

    // Find matching cashier(s) by username
    let cashiers = await Cashier.find({ username: username.toLowerCase(), active: true });

    // If caller gave a store hint, narrow by hiveAccount
    if (storeHiveAccount && cashiers.length > 1) {
      const stores = await Store.find({ hiveAccount: storeHiveAccount.toLowerCase() }).select('_id');
      const ids = stores.map(s => String(s._id));
      cashiers = cashiers.filter(c => ids.includes(String(c.storeId)));
    }

    if (!cashiers.length) return res.status(401).json({ error: 'Invalid credentials' });

    // Check password against all candidates (usually just one)
    let matched = null;
    for (const c of cashiers) {
      if (await bcrypt.compare(password, c.password)) { matched = c; break; }
    }
    if (!matched) return res.status(401).json({ error: 'Invalid credentials' });

    // If username is ambiguous across stores, require the store hint
    if (!matched && cashiers.length > 1) {
      return res.status(409).json({ error: 'Multiple stores found with that username. Please provide your store\'s Hive account.' });
    }

    // Load store config so the POS can work immediately after login
    const store = await Store.findById(matched.storeId).select('businessName bannerUrl categories hiveAccount currency items features bitcoinLightningConfig published');
    if (!store) return res.status(404).json({ error: 'Store not found' });

    const token = jwt.sign(
      { cashierId: matched._id, storeId: matched.storeId, role: 'cashier', username: matched.username },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRY || '7d' }
    );

    res.json({ token, cashier: { id: matched._id, username: matched.username }, store });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
