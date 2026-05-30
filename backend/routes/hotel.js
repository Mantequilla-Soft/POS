'use strict';
const router  = require('express').Router();
const Store   = require('../models/Store');
const Booking = require('../models/Booking');

// All routes here are public — no authenticate middleware.

// Expand a booking's [startAt, endAt) into individual YYYY-MM-DD strings
function expandDates(startAt, endAt) {
  const dates = [];
  const end = new Date(endAt);
  const cur = new Date(startAt);
  cur.setUTCHours(0, 0, 0, 0);
  end.setUTCHours(0, 0, 0, 0);
  while (cur < end) {
    dates.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return dates;
}

// GET /api/hotel/availability?store=hiveAccount&from=YYYY-MM-DD&to=YYYY-MM-DD
router.get('/availability', async (req, res) => {
  try {
    const { store: hiveAccount, from, to } = req.query;
    if (!hiveAccount || !from || !to) {
      return res.status(400).json({ error: 'store, from, and to are required' });
    }

    const storeDoc = await Store.findOne({ hiveAccount });
    if (!storeDoc || !storeDoc.features?.hotel) {
      return res.status(404).json({ error: 'Store not found or hotel feature not enabled' });
    }

    const fromDate = new Date(from);
    const toDate   = new Date(to);
    toDate.setUTCDate(toDate.getUTCDate() + 1); // include the to date itself

    const activeRooms = (storeDoc.rooms || []).filter(r => r.active !== false);

    // Find all room bookings overlapping [fromDate, toDate)
    const bookings = await Booking.find({
      storeId:      storeDoc._id,
      resourceType: 'room',
      status:       { $nin: ['cancelled', 'no_show'] },
      startAt:      { $lt: toDate },
      endAt:        { $gt: fromDate },
    }).select('resourceId startAt endAt');

    // Build unavailableDates per room
    const bookedByRoom = {};
    for (const bk of bookings) {
      if (!bookedByRoom[bk.resourceId]) bookedByRoom[bk.resourceId] = new Set();
      for (const d of expandDates(bk.startAt, bk.endAt)) {
        bookedByRoom[bk.resourceId].add(d);
      }
    }

    const rooms = activeRooms.map(r => ({
      roomId:          r.id,
      label:           r.label,
      description:     r.description || '',
      capacity:        r.capacity,
      nightlyRate:     r.nightlyRate,
      currency:        r.currency,
      unavailableDates: Array.from(bookedByRoom[r.id] || []).sort(),
    }));

    res.json({
      rooms,
      storeMeta: {
        businessName:  storeDoc.businessName,
        contactPhone:  storeDoc.contactPhone  || '',
        contactEmail:  storeDoc.ownerEmail    || '',
        hiveAccount:   storeDoc.hiveAccount,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
