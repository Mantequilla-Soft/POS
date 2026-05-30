'use strict';
const mongoose = require('mongoose');

const bookingSchema = new mongoose.Schema({
  storeId:       { type: mongoose.Schema.Types.ObjectId, ref: 'Store', required: true },
  resourceType:  { type: String, enum: ['table', 'room'], default: 'table' },
  resourceId:    { type: String, default: '' },
  resourceLabel: { type: String, default: '' },
  guestName:     { type: String, required: true },
  guestPhone:    { type: String, default: '' },
  guestEmail:    { type: String, default: '' },
  partySize:     { type: Number, default: 1 },
  startAt:       { type: Date, required: true },
  endAt:         { type: Date, default: null },
  notes:         { type: String, default: '' },
  status: {
    type: String,
    enum: ['confirmed', 'seated', 'completed', 'cancelled', 'no_show', 'checked_in', 'checked_out'],
    default: 'confirmed',
  },
  saleId: { type: mongoose.Schema.Types.ObjectId, ref: 'Sale', default: null },
}, { timestamps: true });

bookingSchema.index({ storeId: 1, startAt: 1 });

module.exports = mongoose.model('Booking', bookingSchema);
