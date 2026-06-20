process.env.JWT_SECRET = 'test-secret';
process.env.SUPERADMIN_USERNAME = 'superadmin';

const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../server');
const db = require('./helpers/db');
const Store = require('../models/Store');
const {
  createUser, createStore, tokenFor, authHeader,
  createMembershipType, createMember, createMemberPayment,
} = require('./helpers/factories');

beforeAll(() => db.connect());
afterEach(() => db.clearAll());
afterAll(() => db.disconnect());

const sampleItems = [
  { id: 'item-1', name: 'Protein Bar', category: 'nutrition', price: 3.50, qty: 2 },
  { id: 'item-2', name: 'Water',       category: 'drinks',    price: 1.00, qty: 1 },
];

async function setup() {
  const owner = await createUser({ username: 'owner' });
  const store = await createStore(owner._id);
  const token = tokenFor(owner, store._id);
  return { owner, store, token };
}

function cashierToken(storeId) {
  return jwt.sign(
    { cashierId: 'cashier-abc', storeId, role: 'cashier', username: 'frontdesk' },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );
}

describe('POST /api/sales', () => {
  it('records a cash sale', async () => {
    const { store, token } = await setup();

    const res = await request(app)
      .post('/api/sales')
      .set(authHeader(token))
      .send({
        items: sampleItems,
        total: 8.00,
        currency: 'HBD',
        paymentMethod: 'cash',
      });

    expect(res.status).toBe(201);
    expect(res.body.total).toBe(8.00);
    expect(res.body.paymentMethod).toBe('cash');
    expect(res.body.storeId).toBe(store._id.toString());
  });

  it('records an HBD sale with Hive metadata', async () => {
    const { token } = await setup();

    const res = await request(app)
      .post('/api/sales')
      .set(authHeader(token))
      .send({
        items: sampleItems,
        total: 8.00,
        currency: 'HBD',
        paymentMethod: 'hbd',
        hiveFrom: 'customeraccount',
        hiveTransactionId: 'abc123xyz',
      });

    expect(res.status).toBe(201);
    expect(res.body.hiveFrom).toBe('customeraccount');
    expect(res.body.hiveTransactionId).toBe('abc123xyz');
  });

  it('cashier can record a sale', async () => {
    const { store } = await setup();
    const token = cashierToken(store._id);

    const res = await request(app)
      .post('/api/sales')
      .set(authHeader(token))
      .send({
        items: sampleItems,
        total: 8.00,
        currency: 'HBD',
        paymentMethod: 'cash',
        cashier: 'frontdesk',
      });

    expect(res.status).toBe(201);
    expect(res.body.cashier).toBe('frontdesk');
  });

  it('rejects sale missing required fields', async () => {
    const { token } = await setup();

    const res = await request(app)
      .post('/api/sales')
      .set(authHeader(token))
      .send({ total: 8.00 }); // missing items and paymentMethod

    expect(res.status).toBe(400);
  });

  it('rejects unauthenticated requests', async () => {
    const res = await request(app)
      .post('/api/sales')
      .send({ items: sampleItems, total: 8.00, paymentMethod: 'cash' });

    expect(res.status).toBe(401);
  });
});

describe('GET /api/sales', () => {
  it('returns paginated sales for the store', async () => {
    const { store, token } = await setup();

    await request(app).post('/api/sales').set(authHeader(token))
      .send({ items: sampleItems, total: 8.00, currency: 'HBD', paymentMethod: 'cash' });
    await request(app).post('/api/sales').set(authHeader(token))
      .send({ items: sampleItems, total: 5.00, currency: 'HBD', paymentMethod: 'hbd' });

    const res = await request(app)
      .get('/api/sales')
      .set(authHeader(token));

    expect(res.status).toBe(200);
    expect(res.body.sales).toHaveLength(2);
    expect(res.body.total).toBe(2);
  });

  it('filters by payment method', async () => {
    const { token } = await setup();

    await request(app).post('/api/sales').set(authHeader(token))
      .send({ items: sampleItems, total: 8.00, currency: 'HBD', paymentMethod: 'cash' });
    await request(app).post('/api/sales').set(authHeader(token))
      .send({ items: sampleItems, total: 5.00, currency: 'HBD', paymentMethod: 'hbd' });

    const res = await request(app)
      .get('/api/sales?method=hbd')
      .set(authHeader(token));

    expect(res.status).toBe(200);
    expect(res.body.sales).toHaveLength(1);
    expect(res.body.sales[0].paymentMethod).toBe('hbd');
  });

  it('blocks cashiers from listing sales', async () => {
    const { store } = await setup();
    const token = cashierToken(store._id);

    const res = await request(app)
      .get('/api/sales')
      .set(authHeader(token));

    expect(res.status).toBe(403);
  });

  it('multi-tenancy: only returns sales from own store', async () => {
    const ownerA = await createUser({ username: 'ownera' });
    const storeA = await createStore(ownerA._id);
    const tokenA = tokenFor(ownerA, storeA._id);

    const ownerB = await createUser({ username: 'ownerb' });
    const storeB = await createStore(ownerB._id);
    const tokenB = tokenFor(ownerB, storeB._id);

    // B records a sale
    await request(app).post('/api/sales').set(authHeader(tokenB))
      .send({ items: sampleItems, total: 10.00, currency: 'HBD', paymentMethod: 'cash' });

    // A should see 0 sales
    const res = await request(app)
      .get('/api/sales')
      .set(authHeader(tokenA));

    expect(res.status).toBe(200);
    expect(res.body.sales).toHaveLength(0);
  });
});

describe('GET /api/sales/summary', () => {
  it('returns correct revenue and count (no date filter)', async () => {
    const { token } = await setup();

    await request(app).post('/api/sales').set(authHeader(token))
      .send({ items: sampleItems, total: 8.00, currency: 'HBD', paymentMethod: 'cash' });
    await request(app).post('/api/sales').set(authHeader(token))
      .send({ items: sampleItems, total: 12.00, currency: 'HBD', paymentMethod: 'hbd' });

    // No date filter — avoids timezone edge cases; covers all sales for this store
    const res = await request(app)
      .get('/api/sales/summary')
      .set(authHeader(token));

    expect(res.status).toBe(200);
    expect(res.body.revenue).toBe(20.00);
    expect(res.body.count).toBe(2);
    expect(res.body.byMethod).toHaveLength(2);
  });

  it('date range filter returns only matching sales', async () => {
    const { token } = await setup();

    await request(app).post('/api/sales').set(authHeader(token))
      .send({ items: sampleItems, total: 8.00, currency: 'HBD', paymentMethod: 'cash' });

    // Far-future range should return nothing
    const res = await request(app)
      .get('/api/sales/summary?from=2099-01-01&to=2099-01-31')
      .set(authHeader(token));

    expect(res.status).toBe(200);
    expect(res.body.revenue).toBe(0);
    expect(res.body.count).toBe(0);
  });

  it('returns zeros when no sales in range', async () => {
    const { token } = await setup();

    const res = await request(app)
      .get('/api/sales/summary?from=2020-01-01&to=2020-01-31')
      .set(authHeader(token));

    expect(res.status).toBe(200);
    expect(res.body.revenue).toBe(0);
    expect(res.body.count).toBe(0);
  });

  it('folds membership dues into totalRevenue without changing revenue', async () => {
    const { store, token } = await setup();

    await request(app).post('/api/sales').set(authHeader(token))
      .send({ items: sampleItems, total: 8.00, currency: 'HBD', paymentMethod: 'cash' });

    const membershipType = await createMembershipType(store._id);
    const member = await createMember(store._id, membershipType._id);
    await createMemberPayment(store._id, member._id, membershipType._id, { amount: 50 });

    const res = await request(app)
      .get('/api/sales/summary')
      .set(authHeader(token));

    expect(res.status).toBe(200);
    expect(res.body.revenue).toBe(8.00);
    expect(res.body.duesRevenue).toBe(50);
    expect(res.body.duesCount).toBe(1);
    expect(res.body.totalRevenue).toBe(58.00);
  });

  it('excludes dues payments outside the date range', async () => {
    const { store, token } = await setup();

    const membershipType = await createMembershipType(store._id);
    const member = await createMember(store._id, membershipType._id);
    await createMemberPayment(store._id, member._id, membershipType._id, {
      amount: 50,
      paidDate: new Date('2099-06-01'),
    });

    const res = await request(app)
      .get('/api/sales/summary?from=2020-01-01&to=2020-01-31')
      .set(authHeader(token));

    expect(res.status).toBe(200);
    expect(res.body.duesRevenue).toBe(0);
    expect(res.body.totalRevenue).toBe(0);
  });
});

// ── Stock decrement ───────────────────────────────────────────────────────────

describe('stock decrement on sale', () => {
  async function setupWithItems() {
    const owner = await createUser({ username: 'stockowner' });
    const store = await createStore(owner._id, {
      items: [
        { id: 'cola',  name: 'Coca-Cola', category: 'drinks', price: 2, trackStock: true,  stockQty: 10 },
        { id: 'water', name: 'Water',     category: 'drinks', price: 1, trackStock: false, stockQty: 99 },
      ],
    });
    const token = tokenFor(owner, store._id);
    return { owner, store, token };
  }

  it('decrements stockQty for a tracked item after immediate sale', async () => {
    const { store, token } = await setupWithItems();

    await request(app).post('/api/sales').set(authHeader(token)).send({
      items: [{ id: 'cola', name: 'Coca-Cola', price: 2, qty: 3 }],
      total: 6,
      paymentMethod: 'cash',
    });

    const updated = await Store.findById(store._id);
    expect(updated.items.find(i => i.id === 'cola').stockQty).toBe(7);
  });

  it('does not change stockQty for untracked items', async () => {
    const { store, token } = await setupWithItems();

    await request(app).post('/api/sales').set(authHeader(token)).send({
      items: [{ id: 'water', name: 'Water', price: 1, qty: 5 }],
      total: 5,
      paymentMethod: 'cash',
    });

    const updated = await Store.findById(store._id);
    expect(updated.items.find(i => i.id === 'water').stockQty).toBe(99);
  });

  it('handles mixed tracked and untracked items in the same sale', async () => {
    const { store, token } = await setupWithItems();

    await request(app).post('/api/sales').set(authHeader(token)).send({
      items: [
        { id: 'cola',  name: 'Coca-Cola', price: 2, qty: 2 },
        { id: 'water', name: 'Water',     price: 1, qty: 1 },
      ],
      total: 5,
      paymentMethod: 'cash',
    });

    const updated = await Store.findById(store._id);
    expect(updated.items.find(i => i.id === 'cola').stockQty).toBe(8);
    expect(updated.items.find(i => i.id === 'water').stockQty).toBe(99);
  });

  it('decrements by qty when selling multiple units', async () => {
    const { store, token } = await setupWithItems();

    await request(app).post('/api/sales').set(authHeader(token)).send({
      items: [{ id: 'cola', name: 'Coca-Cola', price: 2, qty: 10 }],
      total: 20,
      paymentMethod: 'cash',
    });

    const updated = await Store.findById(store._id);
    expect(updated.items.find(i => i.id === 'cola').stockQty).toBe(0);
  });

  it('decrements on tab close', async () => {
    const { store, token } = await setupWithItems();

    const open = await request(app).post('/api/sales/open').set(authHeader(token)).send({
      items: [{ id: 'cola', name: 'Coca-Cola', price: 2, qty: 1 }],
      total: 2,
    });
    expect(open.status).toBe(201);

    await request(app).patch(`/api/sales/${open.body._id}/close`).set(authHeader(token)).send({
      paymentMethod: 'cash',
    });

    const updated = await Store.findById(store._id);
    expect(updated.items.find(i => i.id === 'cola').stockQty).toBe(9);
  });

  it('ignores items with no id (does not crash)', async () => {
    const { token } = await setupWithItems();

    const res = await request(app).post('/api/sales').set(authHeader(token)).send({
      items: [{ name: 'Mystery Item', price: 5, qty: 1 }], // no id
      total: 5,
      paymentMethod: 'cash',
    });

    expect(res.status).toBe(201);
  });
});
