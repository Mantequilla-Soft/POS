const router = require('express').Router();
const mongoose = require('mongoose');
const { requireRole } = require('../middleware/auth');
const Sale = require('../models/Sale');
const Member = require('../models/Member');
const MemberPayment = require('../models/MemberPayment');
const MembershipType = require('../models/MembershipType');

router.use(requireRole('store_owner', 'superadmin'));

function storeMatch(req, extra = {}) {
  return { storeId: new mongoose.Types.ObjectId(req.user.storeId), ...extra };
}

function dateMatch(from, to) {
  if (!from && !to) return {};
  const range = {};
  if (from) range.$gte = new Date(from);
  if (to)   range.$lte = new Date(to);
  return { createdAt: range };
}

// GET /api/reports/top-items
router.get('/top-items', async (req, res) => {
  try {
    const { from, to } = req.query;
    const match = { ...storeMatch(req), ...dateMatch(from, to) };
    const rows = await Sale.aggregate([
      { $match: match },
      { $unwind: '$items' },
      { $group: {
          _id: '$items.name',
          category: { $first: '$items.category' },
          qty:     { $sum: '$items.qty' },
          revenue: { $sum: { $multiply: ['$items.price', '$items.qty'] } },
      }},
      { $sort: { qty: -1 } },
      { $limit: 15 },
    ]);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/reports/by-category
router.get('/by-category', async (req, res) => {
  try {
    const { from, to } = req.query;
    const match = { ...storeMatch(req), ...dateMatch(from, to) };
    const rows = await Sale.aggregate([
      { $match: match },
      { $unwind: '$items' },
      { $group: {
          _id: { $ifNull: ['$items.category', 'other'] },
          qty:     { $sum: '$items.qty' },
          revenue: { $sum: { $multiply: ['$items.price', '$items.qty'] } },
      }},
      { $sort: { revenue: -1 } },
    ]);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/reports/by-hour
router.get('/by-hour', async (req, res) => {
  try {
    const { from, to } = req.query;
    const match = { ...storeMatch(req), ...dateMatch(from, to) };
    const rows = await Sale.aggregate([
      { $match: match },
      { $group: {
          _id:   { $hour: '$createdAt' },
          count: { $sum: 1 },
          revenue: { $sum: '$total' },
      }},
      { $sort: { _id: 1 } },
    ]);
    // Fill in missing hours with 0
    const map = Object.fromEntries(rows.map(r => [r._id, r]));
    const result = Array.from({ length: 24 }, (_, h) => map[h] || { _id: h, count: 0, revenue: 0 });
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/reports/by-weekday
router.get('/by-weekday', async (req, res) => {
  try {
    const { from, to } = req.query;
    const match = { ...storeMatch(req), ...dateMatch(from, to) };
    const rows = await Sale.aggregate([
      { $match: match },
      { $group: {
          _id:   { $dayOfWeek: '$createdAt' }, // 1=Sun … 7=Sat
          count: { $sum: 1 },
          revenue: { $sum: '$total' },
      }},
      { $sort: { _id: 1 } },
    ]);
    const map = Object.fromEntries(rows.map(r => [r._id, r]));
    // Return Mon–Sun order (2–7, 1)
    const order = [2,3,4,5,6,7,1];
    const result = order.map(d => map[d] || { _id: d, count: 0, revenue: 0 });
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/reports/cashiers
router.get('/cashiers', async (req, res) => {
  try {
    const { from, to } = req.query;
    const match = { ...storeMatch(req), ...dateMatch(from, to) };
    const rows = await Sale.aggregate([
      { $match: match },
      { $group: {
          _id:     { $ifNull: ['$cashier', 'Unknown'] },
          count:   { $sum: 1 },
          revenue: { $sum: '$total' },
      }},
      { $sort: { revenue: -1 } },
    ]);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/reports/revenue-by-day  (for the main chart)
router.get('/revenue-by-day', async (req, res) => {
  try {
    const { from, to } = req.query;
    const match = { ...storeMatch(req), ...dateMatch(from, to) };
    const dateRange = dateMatch(from, to).createdAt;
    const duesMatch = { ...storeMatch(req), ...(dateRange ? { paidDate: dateRange } : {}) };

    const [rows, duesRows] = await Promise.all([
      Sale.aggregate([
        { $match: match },
        { $group: {
            _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
            revenue: { $sum: '$total' },
            count:   { $sum: 1 },
            tax:     { $sum: '$taxAmount' },
        }},
      ]),
      // Membership dues, grouped the same way but keyed off paidDate
      MemberPayment.aggregate([
        { $match: duesMatch },
        { $group: {
            _id: { $dateToString: { format: '%Y-%m-%d', date: '$paidDate' } },
            duesRevenue: { $sum: '$amount' },
        }},
      ]),
    ]);

    const duesByDate = Object.fromEntries(duesRows.map(r => [r._id, r.duesRevenue]));
    const merged = rows.map(r => {
      const duesRevenue = duesByDate[r._id] || 0;
      return { ...r, duesRevenue, totalRevenue: r.revenue + duesRevenue };
    });

    // Days with dues collected but no POS sales still need to show up
    const salesDates = new Set(rows.map(r => r._id));
    for (const [date, duesRevenue] of Object.entries(duesByDate)) {
      if (!salesDates.has(date)) {
        merged.push({ _id: date, revenue: 0, count: 0, tax: 0, duesRevenue, totalRevenue: duesRevenue });
      }
    }

    merged.sort((a, b) => (a._id < b._id ? -1 : a._id > b._id ? 1 : 0));
    res.json(merged);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/reports/members/snapshot  (current counts — no date filter)
router.get('/members/snapshot', async (req, res) => {
  try {
    const storeId = req.user.storeId;
    const counts = await Member.aggregate([
      { $match: { storeId: new mongoose.Types.ObjectId(storeId) } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]);
    const result = { active: 0, overdue: 0, pending: 0, suspended: 0, expired: 0 };
    counts.forEach(c => { if (c._id in result) result[c._id] = c.count; });
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/reports/members/over-time
router.get('/members/over-time', async (req, res) => {
  try {
    const storeId = req.user.storeId;
    // Count active members per month by grouping activation dates
    const rows = await MemberPayment.aggregate([
      { $match: { storeId: new mongoose.Types.ObjectId(storeId) } },
      { $group: {
          _id: { $dateToString: { format: '%Y-%m', date: '$periodStart' } },
          payments: { $sum: 1 },
          revenue:  { $sum: '$amount' },
      }},
      { $sort: { _id: 1 } },
    ]);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/reports/members/by-type
router.get('/members/by-type', async (req, res) => {
  try {
    const { from, to } = req.query;
    const match = { storeId: new mongoose.Types.ObjectId(req.user.storeId) };
    if (from || to) {
      match.paidDate = {};
      if (from) match.paidDate.$gte = new Date(from);
      if (to)   match.paidDate.$lte = new Date(to);
    }
    const rows = await MemberPayment.aggregate([
      { $match: match },
      { $lookup: { from: 'membershiptypes', localField: 'membershipTypeId', foreignField: '_id', as: 'plan' } },
      { $unwind: { path: '$plan', preserveNullAndEmptyArrays: true } },
      { $group: {
          _id:     { $ifNull: ['$plan.name', 'Unknown'] },
          count:   { $sum: 1 },
          revenue: { $sum: '$amount' },
          isPass:  { $first: '$plan.isPass' },
      }},
      { $sort: { revenue: -1 } },
    ]);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/reports/passes
router.get('/passes', async (req, res) => {
  try {
    const { from, to } = req.query;
    const storeId = new mongoose.Types.ObjectId(req.user.storeId);

    // Pass types for this store
    const passTypes = await MembershipType.find({ storeId: req.user.storeId, isPass: true }).select('_id');
    const passTypeIds = passTypes.map(p => p._id);

    if (!passTypeIds.length) return res.json({ total: 0, converted: 0, conversionRate: 0, byType: [] });

    const payMatch = { storeId, membershipTypeId: { $in: passTypeIds } };
    if (from || to) {
      payMatch.paidDate = {};
      if (from) payMatch.paidDate.$gte = new Date(from);
      if (to)   payMatch.paidDate.$lte = new Date(to);
    }

    const [total, byType, converted] = await Promise.all([
      MemberPayment.countDocuments(payMatch),
      MemberPayment.aggregate([
        { $match: payMatch },
        { $lookup: { from: 'membershiptypes', localField: 'membershipTypeId', foreignField: '_id', as: 'plan' } },
        { $unwind: { path: '$plan', preserveNullAndEmptyArrays: true } },
        { $group: { _id: { $ifNull: ['$plan.name', 'Unknown'] }, count: { $sum: 1 }, revenue: { $sum: '$amount' } } },
        { $sort: { count: -1 } },
      ]),
      // Members who started as pass holders and now have a non-pass membership
      Member.countDocuments({ storeId: req.user.storeId, isPass: false, startDate: { $ne: null } }),
    ]);

    res.json({ total, converted, conversionRate: total ? Math.round(converted / total * 100) : 0, byType });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
