const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const Store = require('../models/Store');
const Sale = require('../models/Sale');

// POST /api/kitchen/auth — verify kitchen PIN, return short-lived token
router.post('/auth', async (req, res) => {
  try {
    const { pin, storeId } = req.body;
    if (!pin || !storeId) return res.status(400).json({ error: 'pin and storeId are required' });
    const store = await Store.findById(storeId);
    if (!store) return res.status(404).json({ error: 'Store not found' });
    if (!store.kitchenPin) return res.status(400).json({ error: 'Kitchen PIN not configured' });
    const match = await bcrypt.compare(String(pin), store.kitchenPin);
    if (!match) return res.status(401).json({ error: 'Invalid PIN' });
    const token = jwt.sign(
      { role: 'kitchen', storeId: store._id },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );
    res.json({ token, storeName: store.businessName });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function kitchenAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : req.query.token;
  if (!token) return res.status(401).json({ error: 'No token' });
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (!['kitchen', 'cashier', 'store_owner', 'superadmin'].includes(decoded.role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    req.user = decoded;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// GET /api/kitchen/orders — open tabs for kitchen view
router.get('/orders', kitchenAuth, async (req, res) => {
  try {
    const orders = await Sale.find({ storeId: req.user.storeId, status: 'open' }).sort({ openedAt: 1 });
    res.json(orders);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/kitchen/orders/:saleId/items/:itemIdx — mark item ready/pending
router.patch('/orders/:saleId/items/:itemIdx', kitchenAuth, async (req, res) => {
  try {
    const { kitchenStatus } = req.body;
    if (!['pending', 'ready'].includes(kitchenStatus)) {
      return res.status(400).json({ error: 'kitchenStatus must be pending or ready' });
    }
    const sale = await Sale.findOne({ _id: req.params.saleId, storeId: req.user.storeId, status: 'open' });
    if (!sale) return res.status(404).json({ error: 'Order not found' });
    const idx = Number(req.params.itemIdx);
    if (isNaN(idx) || idx < 0 || idx >= sale.items.length) {
      return res.status(400).json({ error: 'Invalid item index' });
    }
    sale.items[idx].kitchenStatus = kitchenStatus;
    sale.markModified('items');
    await sale.save();
    res.json(sale);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
