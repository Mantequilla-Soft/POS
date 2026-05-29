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

// POST /api/sales — record a completed sale (store_owner or superadmin)
router.post('/', async (req, res) => {
  try {
    const { items, total, currency, paymentMethod, paymentNotes, hiveFrom, hiveTransactionId } = req.body;
    const cashier = req.user.username || '';
    if (!items?.length || total == null || !paymentMethod) {
      return res.status(400).json({ error: 'items, total, and paymentMethod are required' });
    }
    const sale = await Sale.create({
      storeId: req.user.storeId,
      items,
      total,
      currency: currency || 'USD',
      paymentMethod,
      paymentNotes: paymentNotes || '',
      hiveFrom,
      hiveTransactionId,
      cashier,
    });
    res.status(201).json(sale);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/sales — list sales with filters (store_owner only)
router.get('/', requireRole('store_owner', 'superadmin'), async (req, res) => {
  try {
    const { from, to, method, page = 1, limit = 50 } = req.query;
    const filter = { storeId: req.user.storeId };
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
    const match = { storeId: new mongoose.Types.ObjectId(req.user.storeId) };
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

module.exports = router;
