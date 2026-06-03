'use strict';
const router        = require('express').Router();
const mongoose      = require('mongoose');
const { authenticate, roleOnly } = require('../middleware/auth');
const Store         = require('../models/Store');
const InventoryItem = require('../models/InventoryItem');
const StockMovement = require('../models/StockMovement');
const StockCount    = require('../models/StockCount');

router.use(authenticate);
router.use(roleOnly('store_owner', 'superadmin'));

// Resolve the store for the authenticated owner and enforce the feature gate.
async function resolveStore(req, res) {
  const store = await Store.findOne({ ownerId: req.user.userId });
  if (!store)               { res.status(404).json({ error: 'Store not found' });              return null; }
  if (!store.features?.inventory) { res.status(403).json({ error: 'Inventory feature not enabled' }); return null; }
  return store;
}

function toOid(id) {
  return mongoose.Types.ObjectId.isValid(id) ? new mongoose.Types.ObjectId(id) : null;
}

// ── Items ────────────────────────────────────────────────────────────────────

router.get('/items', async (req, res) => {
  try {
    const store = await resolveStore(req, res); if (!store) return;
    const items = await InventoryItem.find({ storeId: store._id, active: true }).sort({ name: 1 });
    res.json(items);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/items', async (req, res) => {
  try {
    const store = await resolveStore(req, res); if (!store) return;
    const { name, unit, category, reorderPoint } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'name is required' });
    const item = await InventoryItem.create({
      storeId: store._id,
      name: name.trim(),
      unit: unit?.trim() || 'each',
      category: category?.trim() || '',
      reorderPoint: Number(reorderPoint) || 0,
    });
    res.status(201).json(item);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/items/:id', async (req, res) => {
  try {
    const store = await resolveStore(req, res); if (!store) return;
    const { name, unit, category, reorderPoint } = req.body;
    const update = {};
    if (name       !== undefined) update.name         = name.trim();
    if (unit       !== undefined) update.unit         = unit.trim();
    if (category   !== undefined) update.category     = category.trim();
    if (reorderPoint !== undefined) update.reorderPoint = Number(reorderPoint) || 0;
    if (update.name === '') return res.status(400).json({ error: 'name cannot be empty' });
    const item = await InventoryItem.findOneAndUpdate(
      { _id: req.params.id, storeId: store._id },
      { $set: update },
      { new: true }
    );
    if (!item) return res.status(404).json({ error: 'Item not found' });
    res.json(item);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/items/:id', async (req, res) => {
  try {
    const store = await resolveStore(req, res); if (!store) return;
    const item = await InventoryItem.findOneAndUpdate(
      { _id: req.params.id, storeId: store._id },
      { $set: { active: false } },
      { new: true }
    );
    if (!item) return res.status(404).json({ error: 'Item not found' });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Stock levels (aggregated) ─────────────────────────────────────────────────

router.get('/levels', async (req, res) => {
  try {
    const store = await resolveStore(req, res); if (!store) return;
    const sid = store._id;

    const [items, agg] = await Promise.all([
      InventoryItem.find({ storeId: sid, active: true }).lean(),
      StockMovement.aggregate([
        { $match: { storeId: sid } },
        { $group: { _id: '$itemId', totalQty: { $sum: '$qty' } } },
      ]),
    ]);

    const qtyMap = Object.fromEntries(agg.map(a => [a._id.toString(), a.totalQty]));
    const levels = items.map(item => ({
      ...item,
      currentQty: qtyMap[item._id.toString()] ?? 0,
      lowStock: (qtyMap[item._id.toString()] ?? 0) <= item.reorderPoint && item.reorderPoint > 0,
    }));

    res.json(levels);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Movements ────────────────────────────────────────────────────────────────

router.get('/movements', async (req, res) => {
  try {
    const store = await resolveStore(req, res); if (!store) return;
    const filter = { storeId: store._id };
    if (req.query.itemId) filter.itemId = req.query.itemId;
    if (req.query.type)   filter.type   = req.query.type;
    if (req.query.from || req.query.to) {
      filter.date = {};
      if (req.query.from) filter.date.$gte = new Date(req.query.from);
      if (req.query.to)   filter.date.$lte = new Date(req.query.to);
    }
    const movements = await StockMovement.find(filter).sort({ date: -1 }).limit(500).lean();
    res.json(movements);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/movements', async (req, res) => {
  try {
    const store = await resolveStore(req, res); if (!store) return;
    const { itemId, type, qty, unitCost, supplier, date, notes } = req.body;

    if (!itemId)                                         return res.status(400).json({ error: 'itemId is required' });
    if (!['opening', 'purchase', 'adjustment'].includes(type)) return res.status(400).json({ error: 'invalid type' });
    if (qty === undefined || qty === null || qty === '')  return res.status(400).json({ error: 'qty is required' });

    const item = await InventoryItem.findOne({ _id: itemId, storeId: store._id, active: true });
    if (!item) return res.status(404).json({ error: 'Item not found' });

    const movement = await StockMovement.create({
      storeId:   store._id,
      itemId,
      type,
      qty:       Number(qty),
      unitCost:  Number(unitCost) || 0,
      supplier:  supplier?.trim() || '',
      date:      date ? new Date(date) : new Date(),
      notes:     notes?.trim() || '',
      createdBy: req.user.username || '',
    });
    res.status(201).json(movement);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Stock counts (reconciliations) ────────────────────────────────────────────

router.get('/counts', async (req, res) => {
  try {
    const store = await resolveStore(req, res); if (!store) return;
    const counts = await StockCount.find({ storeId: store._id }).sort({ createdAt: -1 }).limit(50).lean();
    res.json(counts);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/counts', async (req, res) => {
  try {
    const store = await resolveStore(req, res); if (!store) return;
    const { periodStart, periodEnd, lines } = req.body;
    if (!periodStart || !periodEnd) return res.status(400).json({ error: 'periodStart and periodEnd are required' });

    const sanitizedLines = (lines || []).map(l => ({
      itemId:      l.itemId,
      itemName:    String(l.itemName || ''),
      unit:        String(l.unit     || ''),
      expectedQty: Number(l.expectedQty) || 0,
      actualQty:   Number(l.actualQty)   || 0,
      variance:    Number(l.actualQty)   - (Number(l.expectedQty) || 0),
      notes:       String(l.notes || ''),
    }));

    const count = await StockCount.create({
      storeId: store._id,
      periodStart: new Date(periodStart),
      periodEnd:   new Date(periodEnd),
      lines: sanitizedLines,
    });
    res.status(201).json(count);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.patch('/counts/:id/complete', async (req, res) => {
  try {
    const store = await resolveStore(req, res); if (!store) return;
    const count = await StockCount.findOneAndUpdate(
      { _id: req.params.id, storeId: store._id, status: 'draft' },
      { $set: { status: 'completed', completedAt: new Date() } },
      { new: true }
    );
    if (!count) return res.status(404).json({ error: 'Draft count not found' });
    res.json(count);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
