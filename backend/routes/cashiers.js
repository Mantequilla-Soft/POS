const router = require('express').Router();
const bcrypt = require('bcryptjs');
const { requireRole } = require('../middleware/auth');
const Cashier = require('../models/Cashier');

router.use(requireRole('store_owner', 'superadmin'));

router.use((req, res, next) => {
  if (!req.user.storeId) return res.status(400).json({ error: 'No store found. Please create and publish your store first.' });
  next();
});

router.get('/', async (req, res) => {
  try {
    const cashiers = await Cashier.find({ storeId: req.user.storeId }).select('-password');
    res.json(cashiers);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'username and password required' });
    const hash = await bcrypt.hash(password, 10);
    const cashier = await Cashier.create({ storeId: req.user.storeId, username, password: hash });
    res.status(201).json({ id: cashier._id, username: cashier.username, active: cashier.active });
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ error: 'Username already exists in this store' });
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const update = {};
    if (req.body.username) update.username = req.body.username;
    if (req.body.active !== undefined) update.active = req.body.active;
    if (req.body.password) update.password = await bcrypt.hash(req.body.password, 10);

    const cashier = await Cashier.findOneAndUpdate(
      { _id: req.params.id, storeId: req.user.storeId },
      { $set: update },
      { new: true }
    ).select('-password');
    if (!cashier) return res.status(404).json({ error: 'Cashier not found' });
    res.json(cashier);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    await Cashier.findOneAndDelete({ _id: req.params.id, storeId: req.user.storeId });
    res.json({ message: 'Cashier deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
