const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Store = require('../models/Store');

router.post('/register', async (req, res) => {
  try {
    const { username, password, hiveAccount } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'username and password required' });

    const exists = await User.findOne({ username: username.toLowerCase() });
    if (exists) return res.status(409).json({ error: 'Username already taken' });

    const hash = await bcrypt.hash(password, 10);
    const user = await User.create({ username, password: hash, hiveAccount: hiveAccount || '' });
    res.status(201).json({ message: 'Account created. Awaiting admin approval.' });
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
      { userId: user._id, role: user.role, storeId: store?._id ?? null },
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

module.exports = router;
