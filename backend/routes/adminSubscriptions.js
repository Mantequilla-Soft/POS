const router = require('express').Router();
const { requireRole } = require('../middleware/auth');
const Subscription = require('../models/Subscription');
const SubscriptionPayment = require('../models/SubscriptionPayment');
const Store = require('../models/Store');
const { recordPayment } = require('./subscriptions');

router.use(requireRole('superadmin'));

// GET /api/admin/subscriptions — all subscriptions with store info
router.get('/', async (req, res) => {
  try {
    const subs = await Subscription.find().sort({ createdAt: -1 });
    const storeIds = subs.map(s => s.storeId);
    const stores = await Store.find({ _id: { $in: storeIds } }, 'businessName ownerId');
    const storeMap = {};
    stores.forEach(s => { storeMap[s._id.toString()] = s; });

    const result = subs.map(sub => {
      const store = storeMap[sub.storeId.toString()] || {};
      return {
        ...sub.toObject(),
        businessName: store.businessName || '(unnamed)',
      };
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/admin/subscriptions/:storeId/status — suspend / unsuspend / set any status
router.patch('/:storeId/status', async (req, res) => {
  try {
    const { status, notes } = req.body;
    const valid = ['trial', 'active', 'overdue', 'comped', 'suspended'];
    if (!valid.includes(status)) return res.status(400).json({ error: 'Invalid status' });
    const update = { status };
    if (notes !== undefined) update.notes = notes;
    const sub = await Subscription.findOneAndUpdate(
      { storeId: req.params.storeId },
      { $set: update },
      { new: true }
    );
    if (!sub) return res.status(404).json({ error: 'Subscription not found' });
    res.json(sub);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/subscriptions/:storeId/comp — grant free months
router.post('/:storeId/comp', async (req, res) => {
  try {
    const { months = 1, notes } = req.body;
    const sub = await Subscription.findOne({ storeId: req.params.storeId });
    if (!sub) return res.status(404).json({ error: 'Subscription not found' });

    const base = sub.compedUntil && sub.compedUntil > new Date() ? sub.compedUntil : new Date();
    sub.compedUntil = new Date(base.getTime() + months * 30 * 24 * 60 * 60 * 1000);
    sub.currentPeriodEnd = sub.compedUntil;
    sub.status = 'comped';
    if (notes) sub.notes = notes;
    await sub.save();
    res.json(sub);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/subscriptions/:storeId/payment — record a manual payment
router.post('/:storeId/payment', async (req, res) => {
  try {
    const { amount, currency = 'HBD', method = 'manual', notes } = req.body;
    if (!amount) return res.status(400).json({ error: 'amount required' });
    const sub = await Subscription.findOne({ storeId: req.params.storeId });
    if (!sub) return res.status(404).json({ error: 'Subscription not found' });
    const updated = await recordPayment(sub, {
      amount, currency, method,
      recordedBy: 'superadmin',
      hiveTxMemo: notes || '',
    });
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/admin/subscriptions/:storeId/price — set custom plan price (locks the store from global reprice)
router.patch('/:storeId/price', async (req, res) => {
  try {
    const { planPrice, planCurrency } = req.body;
    if (!planPrice) return res.status(400).json({ error: 'planPrice required' });
    const sub = await Subscription.findOneAndUpdate(
      { storeId: req.params.storeId },
      { $set: { planPrice, priceOverride: true, ...(planCurrency && { planCurrency }) } },
      { new: true }
    );
    if (!sub) return res.status(404).json({ error: 'Subscription not found' });
    res.json(sub);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/admin/subscriptions/:storeId/notes — update superadmin notes
router.patch('/:storeId/notes', async (req, res) => {
  try {
    const { notes } = req.body;
    const sub = await Subscription.findOneAndUpdate(
      { storeId: req.params.storeId },
      { $set: { notes: notes || '' } },
      { new: true }
    );
    if (!sub) return res.status(404).json({ error: 'Subscription not found' });
    res.json(sub);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/admin/subscriptions/:storeId/payments — payment history for a store
router.get('/:storeId/payments', async (req, res) => {
  try {
    const payments = await SubscriptionPayment.find({ storeId: req.params.storeId }).sort({ paidAt: -1 });
    res.json(payments);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
