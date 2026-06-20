process.env.JWT_SECRET = 'test-secret';
process.env.SUPERADMIN_USERNAME = 'superadmin';

const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../server');
const db = require('./helpers/db');
const {
  createUser, createStore, createMembershipType,
  createMember, createSale, createMemberPayment,
  tokenFor, authHeader,
} = require('./helpers/factories');

beforeAll(() => db.connect());
afterEach(() => db.clearAll());
afterAll(() => db.disconnect());

async function setup() {
  const owner = await createUser({ username: 'owner' });
  const store = await createStore(owner._id);
  const token = tokenFor(owner, store._id);
  return { owner, store, token };
}

function cashierToken(storeId) {
  return jwt.sign(
    { cashierId: 'c1', storeId, role: 'cashier', username: 'frontdesk' },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );
}

// ── Access control ────────────────────────────────────────────────────────────

describe('Reports — access control', () => {
  const endpoints = [
    '/api/reports/revenue-by-day',
    '/api/reports/top-items',
    '/api/reports/by-category',
    '/api/reports/by-hour',
    '/api/reports/by-weekday',
    '/api/reports/cashiers',
    '/api/reports/members/snapshot',
    '/api/reports/members/over-time',
    '/api/reports/members/by-type',
    '/api/reports/passes',
  ];

  it('returns 401 for all endpoints without a token', async () => {
    const { store } = await setup();
    for (const ep of endpoints) {
      const res = await request(app).get(ep);
      expect(res.status).toBe(401);
    }
  });

  it('returns 403 for cashier role on all endpoints', async () => {
    const { store } = await setup();
    const token = cashierToken(store._id);
    for (const ep of endpoints) {
      const res = await request(app).get(ep).set(authHeader(token));
      expect(res.status).toBe(403);
    }
  });

  it('allows store_owner to reach all endpoints (returns 200)', async () => {
    const { token } = await setup();
    for (const ep of endpoints) {
      const res = await request(app).get(ep).set(authHeader(token));
      expect(res.status).toBe(200);
    }
  });
});

// ── Revenue by day ────────────────────────────────────────────────────────────

describe('GET /api/reports/revenue-by-day', () => {
  it('returns empty array when no sales', async () => {
    const { token } = await setup();
    const res = await request(app).get('/api/reports/revenue-by-day').set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('aggregates revenue and count per day', async () => {
    const { store, token } = await setup();
    await createSale(store._id, { total: 10, items: [{ id: 'i1', name: 'A', price: 10, qty: 1 }] });
    await createSale(store._id, { total: 20, items: [{ id: 'i2', name: 'B', price: 20, qty: 1 }] });

    const res = await request(app).get('/api/reports/revenue-by-day').set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1); // both on same day
    expect(res.body[0].revenue).toBe(30);
    expect(res.body[0].count).toBe(2);
  });

  it('date filter excludes out-of-range sales', async () => {
    const { store, token } = await setup();
    await createSale(store._id, { total: 5 });

    const res = await request(app)
      .get('/api/reports/revenue-by-day?from=2099-01-01&to=2099-01-31')
      .set(authHeader(token));

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(0);
  });

  it('multi-tenancy: only returns own store sales', async () => {
    const ownerA = await createUser({ username: 'a' });
    const storeA = await createStore(ownerA._id);
    const tokenA = tokenFor(ownerA, storeA._id);

    const ownerB = await createUser({ username: 'b' });
    const storeB = await createStore(ownerB._id);
    await createSale(storeB._id, { total: 99 });

    const res = await request(app).get('/api/reports/revenue-by-day').set(authHeader(tokenA));
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(0);
  });

  it('adds membership dues alongside POS revenue on a day with both', async () => {
    const { store, token } = await setup();
    await createSale(store._id, { total: 10 });

    const membershipType = await createMembershipType(store._id);
    const member = await createMember(store._id, membershipType._id);
    await createMemberPayment(store._id, member._id, membershipType._id, { amount: 50 });

    const res = await request(app).get('/api/reports/revenue-by-day').set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].revenue).toBe(10);
    expect(res.body[0].duesRevenue).toBe(50);
    expect(res.body[0].totalRevenue).toBe(60);
  });

  it('includes a day with dues but no POS sales', async () => {
    const { store, token } = await setup();

    const membershipType = await createMembershipType(store._id);
    const member = await createMember(store._id, membershipType._id);
    await createMemberPayment(store._id, member._id, membershipType._id, { amount: 30 });

    const res = await request(app).get('/api/reports/revenue-by-day').set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].revenue).toBe(0);
    expect(res.body[0].duesRevenue).toBe(30);
    expect(res.body[0].totalRevenue).toBe(30);
  });
});

// ── Top items ─────────────────────────────────────────────────────────────────

describe('GET /api/reports/top-items', () => {
  it('returns empty array when no sales', async () => {
    const { token } = await setup();
    const res = await request(app).get('/api/reports/top-items').set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('groups item quantities across multiple sales and sorts by qty desc', async () => {
    const { store, token } = await setup();
    // Protein Bar sold 3 times total, Water sold 1 time
    await createSale(store._id, {
      items: [{ id: 'pb', name: 'Protein Bar', category: 'nutrition', price: 5, qty: 2 }],
      total: 10,
    });
    await createSale(store._id, {
      items: [
        { id: 'pb', name: 'Protein Bar', category: 'nutrition', price: 5, qty: 1 },
        { id: 'w',  name: 'Water',       category: 'drinks',    price: 1, qty: 1 },
      ],
      total: 6,
    });

    const res = await request(app).get('/api/reports/top-items').set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body[0]._id).toBe('Protein Bar');
    expect(res.body[0].qty).toBe(3);
    expect(res.body[1]._id).toBe('Water');
    expect(res.body[1].qty).toBe(1);
  });

  it('includes revenue per item', async () => {
    const { store, token } = await setup();
    await createSale(store._id, {
      items: [{ id: 'x', name: 'Widget', category: 'misc', price: 10, qty: 3 }],
      total: 30,
    });

    const res = await request(app).get('/api/reports/top-items').set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body[0].revenue).toBe(30);
  });

  it('multi-tenancy: only counts items from own store', async () => {
    const ownerA = await createUser({ username: 'a' });
    const storeA = await createStore(ownerA._id);
    const tokenA = tokenFor(ownerA, storeA._id);

    const ownerB = await createUser({ username: 'b' });
    const storeB = await createStore(ownerB._id);
    await createSale(storeB._id, {
      items: [{ id: 'i1', name: 'B Item', price: 5, qty: 10 }],
      total: 50,
    });

    const res = await request(app).get('/api/reports/top-items').set(authHeader(tokenA));
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(0);
  });
});

// ── By hour ───────────────────────────────────────────────────────────────────

describe('GET /api/reports/by-hour', () => {
  it('always returns exactly 24 entries (0–23)', async () => {
    const { token } = await setup();
    const res = await request(app).get('/api/reports/by-hour').set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(24);
    expect(res.body[0]._id).toBe(0);
    expect(res.body[23]._id).toBe(23);
  });

  it('fills hours with no sales as zero', async () => {
    const { token } = await setup();
    const res = await request(app).get('/api/reports/by-hour').set(authHeader(token));
    res.body.forEach(h => {
      expect(h.count).toBe(0);
      expect(h.revenue).toBe(0);
    });
  });

  it('counts are non-zero for hours that have sales', async () => {
    const { store, token } = await setup();
    await createSale(store._id, { total: 5 });

    const res = await request(app).get('/api/reports/by-hour').set(authHeader(token));
    expect(res.status).toBe(200);
    const total = res.body.reduce((s, h) => s + h.count, 0);
    expect(total).toBe(1);
  });
});

// ── By weekday ────────────────────────────────────────────────────────────────

describe('GET /api/reports/by-weekday', () => {
  it('always returns exactly 7 entries in Mon–Sun order', async () => {
    const { token } = await setup();
    const res = await request(app).get('/api/reports/by-weekday').set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(7);
    // MongoDB dayOfWeek: 2=Mon … 7=Sat, 1=Sun — our route returns [2,3,4,5,6,7,1]
    const ids = res.body.map(r => r._id);
    expect(ids).toEqual([2, 3, 4, 5, 6, 7, 1]);
  });

  it('fills empty days with zero revenue', async () => {
    const { token } = await setup();
    const res = await request(app).get('/api/reports/by-weekday').set(authHeader(token));
    res.body.forEach(d => {
      expect(d.revenue).toBe(0);
      expect(d.count).toBe(0);
    });
  });
});

// ── Cashiers ──────────────────────────────────────────────────────────────────

describe('GET /api/reports/cashiers', () => {
  it('returns empty array when no sales', async () => {
    const { token } = await setup();
    const res = await request(app).get('/api/reports/cashiers').set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('groups sales by cashier and sorts by revenue desc', async () => {
    const { store, token } = await setup();
    await createSale(store._id, { total: 10, cashier: 'alice' });
    await createSale(store._id, { total: 50, cashier: 'bob' });
    await createSale(store._id, { total: 5,  cashier: 'alice' });

    const res = await request(app).get('/api/reports/cashiers').set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body[0]._id).toBe('bob');
    expect(res.body[0].revenue).toBe(50);
    expect(res.body[0].count).toBe(1);
    expect(res.body[1]._id).toBe('alice');
    expect(res.body[1].revenue).toBe(15);
    expect(res.body[1].count).toBe(2);
  });
});

// ── Members snapshot ──────────────────────────────────────────────────────────

describe('GET /api/reports/members/snapshot', () => {
  it('returns all status keys defaulting to zero', async () => {
    const { token } = await setup();
    const res = await request(app).get('/api/reports/members/snapshot').set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      active: 0, overdue: 0, pending: 0, suspended: 0, expired: 0,
    });
  });

  it('counts members per status correctly', async () => {
    const { store, token } = await setup();
    const mtype = await createMembershipType(store._id);
    await createMember(store._id, mtype._id, { name: 'A', status: 'active' });
    await createMember(store._id, mtype._id, { name: 'B', status: 'active' });
    await createMember(store._id, mtype._id, { name: 'C', status: 'overdue' });

    const res = await request(app).get('/api/reports/members/snapshot').set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.active).toBe(2);
    expect(res.body.overdue).toBe(1);
    expect(res.body.suspended).toBe(0);
  });

  it('multi-tenancy: does not count members from other stores', async () => {
    const ownerA = await createUser({ username: 'a' });
    const storeA = await createStore(ownerA._id);
    const tokenA = tokenFor(ownerA, storeA._id);

    const ownerB = await createUser({ username: 'b' });
    const storeB = await createStore(ownerB._id);
    const mtypeB = await createMembershipType(storeB._id);
    await createMember(storeB._id, mtypeB._id, { status: 'active' });

    const res = await request(app).get('/api/reports/members/snapshot').set(authHeader(tokenA));
    expect(res.status).toBe(200);
    expect(res.body.active).toBe(0);
  });
});

// ── Members over time ─────────────────────────────────────────────────────────

describe('GET /api/reports/members/over-time', () => {
  it('returns empty array when no payments', async () => {
    const { token } = await setup();
    const res = await request(app).get('/api/reports/members/over-time').set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('groups payments by month', async () => {
    const { store, token } = await setup();
    const mtype = await createMembershipType(store._id);
    const member = await createMember(store._id, mtype._id);

    const periodStart = new Date('2025-03-01T10:00:00Z');
    await createMemberPayment(store._id, member._id, mtype._id, { periodStart, amount: 50 });
    await createMemberPayment(store._id, member._id, mtype._id, { periodStart, amount: 50 });

    const res = await request(app).get('/api/reports/members/over-time').set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]._id).toBe('2025-03');
    expect(res.body[0].payments).toBe(2);
    expect(res.body[0].revenue).toBe(100);
  });
});

// ── Members by type ───────────────────────────────────────────────────────────

describe('GET /api/reports/members/by-type', () => {
  it('returns empty array when no payments', async () => {
    const { token } = await setup();
    const res = await request(app).get('/api/reports/members/by-type').set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('groups payments by membership type name', async () => {
    const { store, token } = await setup();
    const monthly = await createMembershipType(store._id, { name: 'Monthly', price: 30 });
    const annual  = await createMembershipType(store._id, { name: 'Annual',  price: 300 });
    const member  = await createMember(store._id, monthly._id);

    await createMemberPayment(store._id, member._id, monthly._id, { amount: 30 });
    await createMemberPayment(store._id, member._id, monthly._id, { amount: 30 });
    await createMemberPayment(store._id, member._id, annual._id,  { amount: 300 });

    const res = await request(app).get('/api/reports/members/by-type').set(authHeader(token));
    expect(res.status).toBe(200);
    // Sorted by revenue desc: Annual first
    expect(res.body[0]._id).toBe('Annual');
    expect(res.body[0].revenue).toBe(300);
    expect(res.body[1]._id).toBe('Monthly');
    expect(res.body[1].revenue).toBe(60);
    expect(res.body[1].count).toBe(2);
  });
});

// ── Passes ────────────────────────────────────────────────────────────────────

describe('GET /api/reports/passes', () => {
  it('returns zeros when store has no pass-type memberships', async () => {
    const { token } = await setup();
    const res = await request(app).get('/api/reports/passes').set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ total: 0, converted: 0, conversionRate: 0, byType: [] });
  });

  it('counts pass payments and groups by type', async () => {
    const { store, token } = await setup();
    const dayPass = await createMembershipType(store._id, { name: 'Day Pass', isPass: true, price: 5 });
    const member  = await createMember(store._id, dayPass._id);

    await createMemberPayment(store._id, member._id, dayPass._id, { amount: 5 });
    await createMemberPayment(store._id, member._id, dayPass._id, { amount: 5 });

    const res = await request(app).get('/api/reports/passes').set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
    expect(res.body.byType).toHaveLength(1);
    expect(res.body.byType[0]._id).toBe('Day Pass');
    expect(res.body.byType[0].count).toBe(2);
    expect(res.body.byType[0].revenue).toBe(10);
  });
});
