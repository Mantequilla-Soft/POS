const router = require('express').Router();
const mongoose = require('mongoose');
const { requireRole, authenticate } = require('../middleware/auth');
const Sale = require('../models/Sale');

// All sales routes require auth + a storeId in the token
router.use(authenticate);
router.use((req, res, next) => {
  if (!req.user.storeId) return res.status(400).json({ error: 'No store found. Please create and publish your store first.' });
  next();
});

// POST /api/sales — record a completed (immediately paid) sale
router.post('/', async (req, res) => {
  try {
    const { items, total, subtotal, taxAmount, currency, paymentMethod, paymentNotes, hiveFrom, hiveTransactionId } = req.body;
    const cashier = req.user.username || '';
    if (!items?.length || total == null || !paymentMethod) {
      return res.status(400).json({ error: 'items, total, and paymentMethod are required' });
    }
    const sale = await Sale.create({
      storeId: req.user.storeId,
      items,
      subtotal: subtotal ?? total,
      taxAmount: taxAmount ?? 0,
      total,
      currency: currency || 'USD',
      paymentMethod,
      paymentNotes: paymentNotes || '',
      hiveFrom,
      hiveTransactionId,
      cashier,
      status: 'closed',
      closedAt: new Date(),
    });
    res.status(201).json(sale);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/sales/open — create an open tab (no payment yet)
router.post('/open', async (req, res) => {
  try {
    const { items, tableId, tableLabel, subtotal, taxAmount, total, currency } = req.body;
    if (!items?.length) return res.status(400).json({ error: 'items are required' });
    const tab = await Sale.create({
      storeId: req.user.storeId,
      items,
      subtotal: subtotal ?? total ?? 0,
      taxAmount: taxAmount ?? 0,
      total: total ?? 0,
      currency: currency || 'USD',
      status: 'open',
      tableId: tableId || '',
      tableLabel: tableLabel || '',
      openedAt: new Date(),
      cashier: req.user.username || '',
    });
    res.status(201).json(tab);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/sales/open — list open tabs (specific path MUST come before /:id)
router.get('/open', async (req, res) => {
  try {
    const tabs = await Sale.find({ storeId: req.user.storeId, status: 'open' }).sort({ openedAt: -1 });
    res.json(tabs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/sales — list closed sales with filters (store_owner only)
router.get('/', requireRole('store_owner', 'superadmin'), async (req, res) => {
  try {
    const { from, to, method, page = 1, limit = 50 } = req.query;
    const filter = { storeId: req.user.storeId, status: { $ne: 'open' } };
    if (from || to) {
      filter.createdAt = {};
      if (from) filter.createdAt.$gte = new Date(from);
      if (to)   filter.createdAt.$lte = new Date(to);
    }
    if (method) filter.paymentMethod = method;

    const [sales, total] = await Promise.all([
      Sale.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(Number(limit)),
      Sale.countDocuments(filter),
    ]);
    res.json({ sales, total, page: Number(page), pages: Math.ceil(total / limit) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/sales/summary — aggregated totals for a date range
router.get('/summary', requireRole('store_owner', 'superadmin'), async (req, res) => {
  try {
    const { from, to } = req.query;
    // Aggregate $match does not coerce types — must use ObjectId explicitly
    const match = { storeId: new mongoose.Types.ObjectId(req.user.storeId), status: { $ne: 'open' } };
    if (from || to) {
      match.createdAt = {};
      if (from) match.createdAt.$gte = new Date(from);
      if (to)   match.createdAt.$lte = new Date(to);
    }

    const [totals, byMethod, byDay] = await Promise.all([
      // Overall totals
      Sale.aggregate([
        { $match: match },
        { $group: { _id: null, revenue: { $sum: '$total' }, count: { $sum: 1 } } },
      ]),
      // Breakdown by payment method
      Sale.aggregate([
        { $match: match },
        { $group: { _id: '$paymentMethod', revenue: { $sum: '$total' }, count: { $sum: 1 } } },
        { $sort: { revenue: -1 } },
      ]),
      // Daily breakdown
      Sale.aggregate([
        { $match: match },
        { $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          revenue: { $sum: '$total' },
          count:   { $sum: 1 },
        }},
        { $sort: { _id: 1 } },
      ]),
    ]);

    res.json({
      revenue: totals[0]?.revenue ?? 0,
      count:   totals[0]?.count   ?? 0,
      byMethod,
      byDay,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/sales/:id — get one sale or tab (must come AFTER all specific GET paths)
router.get('/:id', async (req, res) => {
  try {
    const sale = await Sale.findOne({ _id: req.params.id, storeId: req.user.storeId });
    if (!sale) return res.status(404).json({ error: 'Not found' });
    res.json(sale);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/sales/:id/items — replace items on an open tab (preserves kitchenStatus)
router.patch('/:id/items', async (req, res) => {
  try {
    const { items, subtotal, taxAmount, total } = req.body;
    if (!items?.length) return res.status(400).json({ error: 'items are required' });
    const tab = await Sale.findOne({ _id: req.params.id, storeId: req.user.storeId, status: 'open' });
    if (!tab) return res.status(404).json({ error: 'Open tab not found' });
    // Preserve kitchen-side ready status for items that already existed (matched by id)
    const prevStatus = {};
    tab.items.forEach(i => { if (i.id) prevStatus[i.id] = i.kitchenStatus; });
    tab.items = items.map(i => ({ ...i, kitchenStatus: prevStatus[i.id] || 'pending' }));
    tab.subtotal  = subtotal ?? total ?? 0;
    tab.taxAmount = taxAmount ?? 0;
    tab.total     = total ?? 0;
    tab.markModified('items');
    await tab.save();
    res.json(tab);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/sales/:id/close — close a tab with payment
router.patch('/:id/close', async (req, res) => {
  try {
    const { paymentMethod, paymentNotes, hiveFrom, hiveTransactionId, subtotal, taxAmount, total } = req.body;
    if (!paymentMethod) return res.status(400).json({ error: 'paymentMethod is required' });
    const updates = {
      status: 'closed',
      closedAt: new Date(),
      paymentMethod,
      paymentNotes: paymentNotes || '',
      hiveFrom: hiveFrom || null,
      hiveTransactionId: hiveTransactionId || null,
    };
    if (subtotal != null) updates.subtotal = subtotal;
    if (taxAmount != null) updates.taxAmount = taxAmount;
    if (total != null) updates.total = total;
    const tab = await Sale.findOneAndUpdate(
      { _id: req.params.id, storeId: req.user.storeId, status: 'open' },
      { $set: updates },
      { new: true }
    );
    if (!tab) return res.status(404).json({ error: 'Open tab not found' });
    res.json(tab);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/sales/:id — void an open tab
router.delete('/:id', async (req, res) => {
  try {
    const tab = await Sale.findOneAndDelete({
      _id: req.params.id,
      storeId: req.user.storeId,
      status: 'open',
    });
    if (!tab) return res.status(404).json({ error: 'Open tab not found' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
