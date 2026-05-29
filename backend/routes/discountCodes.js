'use strict';
const router       = require('express').Router();
const { authenticate } = require('../middleware/auth');
const DiscountCode = require('../models/DiscountCode');

router.use(authenticate);

function storeId(req) {
  return req.user.storeId || req.user.userId;  // owner: storeId from JWT; cashier: storeId from JWT
}

function getStoreId(req) {
  return req.user.storeId;
}

// Shared validation logic — also exported for sales route
async function validateCode(storeId, code, cartTotal) {
  const dc = await DiscountCode.findOne({ storeId, code: code.toUpperCase().trim(), active: true });
  if (!dc) return { valid: false, error: 'Invalid or inactive code' };
  if (dc.expiresAt && dc.expiresAt < new Date()) return { valid: false, error: 'Code has expired' };
  if (dc.maxUses > 0 && dc.usedCount >= dc.maxUses) return { valid: false, error: 'Max uses reached' };
  if (cartTotal < dc.minCartAmount) return { valid: false, error: `Minimum cart total is ${dc.minCartAmount}` };

  let discountAmount;
  if (dc.type === 'percent') {
    discountAmount = Math.round(cartTotal * dc.value / 100 * 100) / 100;
  } else {
    discountAmount = Math.min(dc.value, cartTotal);
  }
  return { valid: true, discountAmount, code: dc };
}

// GET /api/discount-codes
router.get('/', async (req, res) => {
  try {
    const sid = getStoreId(req);
    if (!sid) return res.status(400).json({ error: 'No store associated with this account' });
    const codes = await DiscountCode.find({ storeId: sid }).sort({ createdAt: -1 });
    res.json(codes);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/discount-codes/validate
router.post('/validate', async (req, res) => {
  try {
    const sid = getStoreId(req);
    if (!sid) return res.status(400).json({ error: 'No store associated with this account' });
    const { code, cartTotal } = req.body;
    if (!code) return res.status(400).json({ error: 'code required' });
    const result = await validateCode(sid, code, parseFloat(cartTotal) || 0);
    if (!result.valid) return res.status(400).json(result);
    res.json({ valid: true, discountAmount: result.discountAmount, code: result.code });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/discount-codes — owner only
router.post('/', async (req, res) => {
  try {
    if (req.user.role === 'cashier') return res.status(403).json({ error: 'Forbidden' });
    const sid = getStoreId(req);
    if (!sid) return res.status(400).json({ error: 'No store associated with this account' });
    const { code, type, value, minCartAmount, maxUses, expiresAt } = req.body;
    if (!code || !type || value === undefined) return res.status(400).json({ error: 'code, type, value required' });
    const dc = await DiscountCode.create({
      storeId: sid,
      code: code.toUpperCase().trim(),
      type, value,
      minCartAmount: minCartAmount || 0,
      maxUses: maxUses || 0,
      expiresAt: expiresAt || null,
    });
    res.status(201).json(dc);
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ error: 'Code already exists for this store' });
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/discount-codes/:id — owner only
router.put('/:id', async (req, res) => {
  try {
    if (req.user.role === 'cashier') return res.status(403).json({ error: 'Forbidden' });
    const sid = getStoreId(req);
    const { type, value, minCartAmount, maxUses, expiresAt, active } = req.body;
    const update = {};
    if (type          !== undefined) update.type          = type;
    if (value         !== undefined) update.value         = value;
    if (minCartAmount !== undefined) update.minCartAmount = minCartAmount;
    if (maxUses       !== undefined) update.maxUses       = maxUses;
    if (expiresAt     !== undefined) update.expiresAt     = expiresAt || null;
    if (active        !== undefined) update.active        = active;
    const dc = await DiscountCode.findOneAndUpdate(
      { _id: req.params.id, storeId: sid },
      { $set: update },
      { new: true }
    );
    if (!dc) return res.status(404).json({ error: 'Code not found' });
    res.json(dc);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/discount-codes/:id — owner only
router.delete('/:id', async (req, res) => {
  try {
    if (req.user.role === 'cashier') return res.status(403).json({ error: 'Forbidden' });
    const sid = getStoreId(req);
    const dc = await DiscountCode.findOneAndDelete({ _id: req.params.id, storeId: sid });
    if (!dc) return res.status(404).json({ error: 'Code not found' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
module.exports.validateCode = validateCode;
