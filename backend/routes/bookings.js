'use strict';
const router  = require('express').Router();
const { authenticate } = require('../middleware/auth');
const Booking = require('../models/Booking');

router.use(authenticate);

function getStoreId(req) { return req.user.storeId; }

// Build the day range for a given YYYY-MM-DD string (or today)
function dayRange(dateStr) {
  const d = dateStr ? new Date(dateStr) : new Date();
  const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const end   = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end };
}

// GET /api/bookings?date=YYYY-MM-DD&resourceType=table
router.get('/', async (req, res) => {
  try {
    const sid = getStoreId(req);
    if (!sid) return res.status(400).json({ error: 'No store' });
    const { start, end } = dayRange(req.query.date);
    const filter = { storeId: sid, startAt: { $gte: start, $lt: end } };
    if (req.query.resourceType) filter.resourceType = req.query.resourceType;
    // Cashiers don't see cancelled/no_show
    if (req.user.role === 'cashier') {
      filter.status = { $nin: ['cancelled', 'no_show', 'completed'] };
    }
    const bookings = await Booking.find(filter).sort({ startAt: 1 });
    res.json(bookings);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/bookings — owner + cashier
router.post('/', async (req, res) => {
  try {
    const sid = getStoreId(req);
    if (!sid) return res.status(400).json({ error: 'No store' });
    const { resourceType, resourceId, resourceLabel, guestName, guestPhone, guestEmail,
            partySize, startAt, endAt, notes } = req.body;
    if (!guestName || !startAt) return res.status(400).json({ error: 'guestName and startAt required' });
    const booking = await Booking.create({
      storeId: sid,
      resourceType: resourceType || 'table',
      resourceId:   resourceId   || '',
      resourceLabel: resourceLabel || '',
      guestName, guestPhone, guestEmail,
      partySize: partySize || 1,
      startAt: new Date(startAt),
      endAt:   endAt ? new Date(endAt) : null,
      notes:   notes || '',
    });
    res.status(201).json(booking);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/bookings/:id
router.get('/:id', async (req, res) => {
  try {
    const sid = getStoreId(req);
    const booking = await Booking.findOne({ _id: req.params.id, storeId: sid });
    if (!booking) return res.status(404).json({ error: 'Not found' });
    res.json(booking);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/bookings/:id — owner only
router.put('/:id', async (req, res) => {
  try {
    if (req.user.role === 'cashier') return res.status(403).json({ error: 'Forbidden' });
    const sid = getStoreId(req);
    const fields = ['resourceId','resourceLabel','guestName','guestPhone','guestEmail',
                    'partySize','startAt','endAt','notes','status'];
    const update = {};
    for (const f of fields) {
      if (req.body[f] !== undefined) {
        update[f] = (f === 'startAt' || f === 'endAt')
          ? (req.body[f] ? new Date(req.body[f]) : null)
          : req.body[f];
      }
    }
    const booking = await Booking.findOneAndUpdate(
      { _id: req.params.id, storeId: sid },
      { $set: update },
      { new: true, runValidators: true }
    );
    if (!booking) return res.status(404).json({ error: 'Not found' });
    res.json(booking);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/bookings/:id — owner only (soft cancel)
router.delete('/:id', async (req, res) => {
  try {
    if (req.user.role === 'cashier') return res.status(403).json({ error: 'Forbidden' });
    const sid = getStoreId(req);
    const booking = await Booking.findOneAndUpdate(
      { _id: req.params.id, storeId: sid },
      { $set: { status: 'cancelled' } },
      { new: true }
    );
    if (!booking) return res.status(404).json({ error: 'Not found' });
    res.json(booking);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Status transition helpers
async function transition(req, res, toStatus, allowedRoles = ['store_owner', 'cashier']) {
  try {
    const sid = getStoreId(req);
    if (!allowedRoles.includes(req.user.role)) return res.status(403).json({ error: 'Forbidden' });
    const booking = await Booking.findOneAndUpdate(
      { _id: req.params.id, storeId: sid },
      { $set: { status: toStatus } },
      { new: true }
    );
    if (!booking) return res.status(404).json({ error: 'Not found' });
    res.json(booking);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// PATCH /api/bookings/:id/seat
router.patch('/:id/seat',     (req, res) => transition(req, res, 'seated'));
// PATCH /api/bookings/:id/noshow
router.patch('/:id/noshow',   (req, res) => transition(req, res, 'no_show'));
// PATCH /api/bookings/:id/complete
router.patch('/:id/complete', (req, res) => transition(req, res, 'completed'));

module.exports = router;
