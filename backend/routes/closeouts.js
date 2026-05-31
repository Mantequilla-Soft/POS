'use strict';
const router     = require('express').Router();
const mongoose   = require('mongoose');
const { authenticate, roleOnly } = require('../middleware/auth');
const Closeout   = require('../models/Closeout');
const Sale       = require('../models/Sale');

function toObjectId(id) {
  return mongoose.Types.ObjectId.isValid(id) ? new mongoose.Types.ObjectId(id) : id;
}

router.use(authenticate);

function getStoreId(req) { return req.user.storeId; }

// Methods treated as non-cash (transfer/digital)
const TRANSFER_METHODS = new Set([
  'bank_transfer', 'hive', 'hbd', 'lightning', 'card', 'stripe', 'check', 'other',
]);

function computeTotals(closeout) {
  let totalTipsCash = 0, totalTipsTransfer = 0, totalDeductions = 0;

  (closeout.shifts || []).forEach(shift => {
    (shift.staff || []).forEach(s => {
      totalTipsCash     += Number(s.tipCash)     || 0;
      totalTipsTransfer += Number(s.tipTransfer) || 0;
    });
  });

  (closeout.deductions || []).forEach(d => {
    totalDeductions += Number(d.amount) || 0;
  });

  const cashSales     = Number(closeout.cashSales)      || 0;
  const transferAmt   = Number(closeout.transferAmount)  || 0;
  const cashDelivered = cashSales + totalTipsCash - totalDeductions;
  const bankTotal     = transferAmt + totalTipsTransfer;

  return { totalTipsCash, totalTipsTransfer, totalDeductions, cashDelivered, bankTotal };
}

// GET /api/closeouts/sales-summary?from=ISO&to=ISO  (preferred — respects client timezone)
// GET /api/closeouts/sales-summary?date=YYYY-MM-DD  (legacy fallback — UTC midnight)
router.get('/sales-summary', roleOnly('store_owner', 'cashier'), async (req, res) => {
  try {
    const sid = getStoreId(req);
    if (!sid) return res.status(400).json({ error: 'No store' });

    let start, end;
    if (req.query.from && req.query.to) {
      start = new Date(req.query.from);
      end   = new Date(req.query.to);
    } else {
      const dateStr = req.query.date || new Date().toISOString().slice(0, 10);
      const d = new Date(dateStr);
      start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
      end   = new Date(start.getTime() + 86400000);
    }

    const sales = await Sale.find({
      storeId:   sid,
      status:    { $ne: 'open' },
      createdAt: { $gte: start, $lt: end },
    }).select('total paymentMethod');

    let totalSales = 0, transferAmount = 0;
    sales.forEach(s => {
      const amt = Number(s.total) || 0;
      totalSales += amt;
      if (TRANSFER_METHODS.has(s.paymentMethod)) transferAmount += amt;
    });

    const cashSales = totalSales - transferAmount;
    res.json({ totalSales, transferAmount, cashSales });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/closeouts/report?from=YYYY-MM-DD&to=YYYY-MM-DD
router.get('/report', roleOnly('store_owner'), async (req, res) => {
  try {
    const sid = getStoreId(req);
    if (!sid) return res.status(400).json({ error: 'No store' });
    const { from, to } = req.query;
    if (!from || !to) return res.status(400).json({ error: 'from and to required' });

    const match = {
      storeId: toObjectId(sid),
      status:  { $in: ['submitted', 'reviewed'] },
      date:    { $gte: from, $lte: to },
    };

    const [agg] = await Closeout.aggregate([
      { $match: match },
      { $group: {
        _id:           null,
        count:         { $sum: 1 },
        totalSales:    { $sum: '$totalSales' },
        cashDelivered: { $sum: '$cashDelivered' },
        bankTotal:     { $sum: '$bankTotal' },
        tipsCash:      { $sum: '$totalTipsCash' },
        tipsTransfer:  { $sum: '$totalTipsTransfer' },
        deductions:    { $sum: '$totalDeductions' },
        transferSales: { $sum: '$transferAmount' },
        cashSales:     { $sum: '$cashSales' },
      }},
    ]);

    res.json(agg || { count: 0, totalSales: 0, cashDelivered: 0, bankTotal: 0, tipsCash: 0, tipsTransfer: 0, deductions: 0, transferSales: 0, cashSales: 0 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/closeouts/by-date/:date — must come before /:id
router.get('/by-date/:date', roleOnly('store_owner', 'cashier'), async (req, res) => {
  try {
    const sid = getStoreId(req);
    if (!sid) return res.status(400).json({ error: 'No store' });
    const closeout = await Closeout.findOne({ storeId: sid, date: req.params.date });
    if (!closeout) return res.status(404).json({ error: 'Not found' });
    res.json(closeout);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/closeouts — paginated list (owner only)
router.get('/', roleOnly('store_owner'), async (req, res) => {
  try {
    const sid    = getStoreId(req);
    if (!sid) return res.status(400).json({ error: 'No store' });
    const page   = Math.max(1, parseInt(req.query.page  || '1'));
    const limit  = Math.min(50, parseInt(req.query.limit || '10'));
    const filter = { storeId: sid };
    if (req.query.status) filter.status = req.query.status;
    if (req.query.from || req.query.to) {
      filter.date = {};
      if (req.query.from) filter.date.$gte = req.query.from;
      if (req.query.to)   filter.date.$lte = req.query.to;
    }
    const [closeouts, total] = await Promise.all([
      Closeout.find(filter).sort({ date: -1 }).skip((page - 1) * limit).limit(limit),
      Closeout.countDocuments(filter),
    ]);
    res.json({ closeouts, total, page, pages: Math.ceil(total / limit) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/closeouts/:id
router.get('/:id', roleOnly('store_owner', 'cashier'), async (req, res) => {
  try {
    const sid = getStoreId(req);
    const closeout = await Closeout.findOne({ _id: req.params.id, storeId: sid });
    if (!closeout) return res.status(404).json({ error: 'Not found' });
    res.json(closeout);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/closeouts — create
router.post('/', roleOnly('store_owner', 'cashier'), async (req, res) => {
  try {
    const sid = getStoreId(req);
    if (!sid) return res.status(400).json({ error: 'No store' });

    const { date, totalSales, transferAmount, cashSales, shifts, deductions, notes, status } = req.body;
    if (!date) return res.status(400).json({ error: 'date required' });

    const existing = await Closeout.findOne({ storeId: sid, date });
    if (existing) return res.status(409).json({ error: 'duplicate', message: 'A closeout for this date already exists.' });

    const doc = { storeId: sid, date, totalSales, transferAmount, cashSales, shifts, deductions, notes };
    const totals = computeTotals(doc);
    Object.assign(doc, totals);

    doc.status      = status || 'draft';
    doc.submittedBy = req.user.username || req.user.userId;
    if (doc.status === 'submitted') doc.submittedAt = new Date();

    const closeout = await Closeout.create(doc);
    res.status(201).json(closeout);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/closeouts/:id — update (draft only; owner can always edit)
router.put('/:id', roleOnly('store_owner', 'cashier'), async (req, res) => {
  try {
    const sid = getStoreId(req);
    const closeout = await Closeout.findOne({ _id: req.params.id, storeId: sid });
    if (!closeout) return res.status(404).json({ error: 'Not found' });
    if (closeout.status !== 'draft' && req.user.role !== 'store_owner') {
      return res.status(409).json({ error: 'Cannot edit a submitted closeout.' });
    }

    const { totalSales, transferAmount, cashSales, shifts, deductions, notes } = req.body;
    const patch = { totalSales, transferAmount, cashSales, shifts, deductions, notes };
    const totals = computeTotals({ ...closeout.toObject(), ...patch });
    Object.assign(patch, totals);

    const updated = await Closeout.findByIdAndUpdate(req.params.id, { $set: patch }, { new: true });
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/closeouts/:id/submit
router.patch('/:id/submit', roleOnly('store_owner', 'cashier'), async (req, res) => {
  try {
    const sid = getStoreId(req);
    const closeout = await Closeout.findOne({ _id: req.params.id, storeId: sid });
    if (!closeout) return res.status(404).json({ error: 'Not found' });
    if (closeout.status !== 'draft') {
      return res.status(409).json({ error: 'Already submitted.' });
    }
    closeout.status      = 'submitted';
    closeout.submittedBy = req.user.username || req.user.userId;
    closeout.submittedAt = new Date();
    await closeout.save();
    res.json(closeout);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/closeouts/:id/review (owner only)
router.patch('/:id/review', roleOnly('store_owner'), async (req, res) => {
  try {
    const sid = getStoreId(req);
    const closeout = await Closeout.findOne({ _id: req.params.id, storeId: sid });
    if (!closeout) return res.status(404).json({ error: 'Not found' });
    if (closeout.status === 'draft') {
      return res.status(409).json({ error: 'Cannot review a draft closeout.' });
    }
    closeout.status        = 'reviewed';
    closeout.reviewedBy    = req.user.username || req.user.userId;
    closeout.reviewedAt    = new Date();
    closeout.reviewComment = req.body.reviewComment || '';
    await closeout.save();
    res.json(closeout);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/closeouts/:id (owner only)
router.delete('/:id', roleOnly('store_owner'), async (req, res) => {
  try {
    const sid = getStoreId(req);
    const result = await Closeout.deleteOne({ _id: req.params.id, storeId: sid });
    if (!result.deletedCount) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
