process.env.JWT_SECRET = 'test-secret';
process.env.SUPERADMIN_USERNAME = 'superadmin';

const request = require('supertest');
const app = require('../server');
const db = require('./helpers/db');
const { createUser, createStore, tokenFor, authHeader } = require('./helpers/factories');
const Subscription = require('../models/Subscription');
const PricingConfig = require('../models/PricingConfig');
const { recordPayment } = require('../routes/subscriptions');

beforeAll(() => db.connect());
afterEach(() => db.clearAll());
afterAll(() => db.disconnect());

// Seed a pricing config and a subscription for the given store
async function seedBilling(storeId, { basePrice = 5, reservations = 2 } = {}) {
  await PricingConfig.create({
    basePrice,
    addons: { reservations, memberships: 3, emailCampaigns: 1, discountCodes: 1, restaurantFeatures: 2, hotel: 0 },
  });
  return Subscription.create({
    storeId,
    status: 'active',
    planPrice: basePrice,
    periodHighPrice: basePrice,
    currentPeriodEnd: new Date(Date.now() + 30 * 86400000),
  });
}

async function setup() {
  const owner = await createUser({ username: 'owner' });
  const store = await createStore(owner._id);
  const token = tokenFor(owner, store._id);
  return { owner, store, token };
}

// ── periodHighPrice ratchet ──────────────────────────────────────────────────

describe('billing high-water mark', () => {
  it('planPrice increases and periodHighPrice ratchets up when a feature is enabled', async () => {
    const { store, token } = await setup();
    const sub = await seedBilling(store._id); // base=5, reservations addon=2

    await request(app)
      .put('/api/store')
      .set(authHeader(token))
      .send({ features: { reservations: true } });

    const updated = await Subscription.findById(sub._id);
    expect(updated.planPrice).toBe(7);          // 5 base + 2 reservations
    expect(updated.periodHighPrice).toBe(7);    // ratcheted up
  });

  it('planPrice decreases when a feature is disabled but periodHighPrice stays', async () => {
    const { store, token } = await setup();
    const sub = await seedBilling(store._id);

    // Enable reservations first (price goes to 7, high=7)
    await request(app)
      .put('/api/store')
      .set(authHeader(token))
      .send({ features: { reservations: true } });

    // Disable reservations mid-period (price goes back to 5, high should stay at 7)
    await request(app)
      .put('/api/store')
      .set(authHeader(token))
      .send({ features: { reservations: false } });

    const updated = await Subscription.findById(sub._id);
    expect(updated.planPrice).toBe(5);          // current feature price
    expect(updated.periodHighPrice).toBe(7);    // billing floor preserved
  });

  it('periodHighPrice resets to planPrice after a payment is recorded', async () => {
    const { store } = await setup();
    let sub = await seedBilling(store._id);

    // Simulate a mid-period price increase then decrease
    sub.planPrice = 7;
    sub.periodHighPrice = 7;
    await sub.save();

    sub.planPrice = 5;
    await sub.save();

    // Record payment — should reset periodHighPrice to planPrice (5)
    await recordPayment(sub, { amount: 5, currency: 'HBD', method: 'manual' });

    const refreshed = await Subscription.findById(sub._id);
    expect(refreshed.periodHighPrice).toBe(5);
    expect(refreshed.planPrice).toBe(5);
  });

  it('periodHighPrice does not decrease if a new price is lower than the current high', async () => {
    const { store, token } = await setup();
    const sub = await seedBilling(store._id);

    // Set the high-water mark to 10 manually (simulates a previously-enabled expensive feature)
    sub.periodHighPrice = 10;
    await sub.save();

    // Enable reservations → new planPrice = 7, but 7 < 10 so periodHighPrice stays at 10
    await request(app)
      .put('/api/store')
      .set(authHeader(token))
      .send({ features: { reservations: true } });

    const updated = await Subscription.findById(sub._id);
    expect(updated.planPrice).toBe(7);
    expect(updated.periodHighPrice).toBe(10);   // not overwritten by a lower price
  });
});

// ── GET /api/subscription breakdown ─────────────────────────────────────────

describe('GET /api/subscription', () => {
  it('returns subscription with planPrice and periodHighPrice', async () => {
    const { store, token } = await setup();
    const sub = await seedBilling(store._id);
    sub.periodHighPrice = 7;
    await sub.save();

    const res = await request(app)
      .get('/api/subscription')
      .set(authHeader(token));

    expect(res.status).toBe(200);
    expect(res.body.planPrice).toBeDefined();
    expect(res.body.periodHighPrice).toBe(7);
  });

  it('returns a feature breakdown array', async () => {
    const { store, token } = await setup();
    await seedBilling(store._id);

    const res = await request(app)
      .get('/api/subscription')
      .set(authHeader(token));

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.breakdown)).toBe(true);
    expect(res.body.breakdown.length).toBeGreaterThan(0);
    expect(res.body.breakdown[0]).toHaveProperty('label');
    expect(res.body.breakdown[0]).toHaveProperty('amount');
  });

  it('returns 404 when no subscription exists', async () => {
    const owner = await createUser({ username: 'nosub' });
    const store = await createStore(owner._id);
    const token = tokenFor(owner, store._id);

    const res = await request(app)
      .get('/api/subscription')
      .set(authHeader(token));

    expect(res.status).toBe(404);
  });
});
