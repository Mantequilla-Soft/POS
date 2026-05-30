process.env.JWT_SECRET = 'test-secret';
process.env.SUPERADMIN_USERNAME = 'superadmin';

const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../server');
const db = require('./helpers/db');
const { createUser, createStore, tokenFor, authHeader } = require('./helpers/factories');

beforeAll(() => db.connect());
afterEach(() => db.clearAll());
afterAll(() => db.disconnect());

const TOMORROW = new Date(Date.now() + 86400000).toISOString();
const TODAY = new Date().toISOString();

function cashierToken(storeId) {
  return jwt.sign(
    { cashierId: 'cashier-1', storeId, role: 'cashier', username: 'frontdesk' },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );
}

async function setup() {
  const owner = await createUser({ username: 'owner' });
  const store = await createStore(owner._id, { features: { reservations: true } });
  const token = tokenFor(owner, store._id);
  return { owner, store, token };
}

async function createBooking(token, overrides = {}) {
  return request(app)
    .post('/api/bookings')
    .set(authHeader(token))
    .send({ guestName: 'Alice Smith', startAt: TOMORROW, partySize: 2, ...overrides });
}

// ── POST /api/bookings ───────────────────────────────────────────────────────

describe('POST /api/bookings', () => {
  it('owner can create a booking', async () => {
    const { store, token } = await setup();
    const res = await createBooking(token);
    expect(res.status).toBe(201);
    expect(res.body.guestName).toBe('Alice Smith');
    expect(res.body.partySize).toBe(2);
    expect(res.body.storeId).toBe(store._id.toString());
    expect(res.body.status).toBe('confirmed');
  });

  it('cashier can create a booking', async () => {
    const { store } = await setup();
    const token = cashierToken(store._id);
    const res = await createBooking(token);
    expect(res.status).toBe(201);
    expect(res.body.guestName).toBe('Alice Smith');
  });

  it('rejects booking without guestName', async () => {
    const { token } = await setup();
    const res = await request(app)
      .post('/api/bookings')
      .set(authHeader(token))
      .send({ startAt: TOMORROW });
    expect(res.status).toBe(400);
  });

  it('rejects booking without startAt', async () => {
    const { token } = await setup();
    const res = await request(app)
      .post('/api/bookings')
      .set(authHeader(token))
      .send({ guestName: 'Alice' });
    expect(res.status).toBe(400);
  });

  it('rejects unauthenticated request', async () => {
    const res = await request(app)
      .post('/api/bookings')
      .send({ guestName: 'Alice', startAt: TOMORROW });
    expect(res.status).toBe(401);
  });
});

// ── GET /api/bookings ────────────────────────────────────────────────────────

describe('GET /api/bookings', () => {
  it('owner sees bookings for the requested day', async () => {
    const { token } = await setup();
    await createBooking(token, { startAt: TOMORROW });

    const date = TOMORROW.slice(0, 10);
    const res = await request(app)
      .get(`/api/bookings?date=${date}`)
      .set(authHeader(token));

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].guestName).toBe('Alice Smith');
  });

  it('returns empty array for a day with no bookings', async () => {
    const { token } = await setup();
    const res = await request(app)
      .get('/api/bookings?date=2099-12-31')
      .set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(0);
  });

  it('cashier does not see cancelled bookings', async () => {
    const { store, token } = await setup();
    const cashier = cashierToken(store._id);

    // Create then cancel a booking
    const bkRes = await createBooking(token, { startAt: TOMORROW });
    await request(app)
      .delete(`/api/bookings/${bkRes.body._id}`)
      .set(authHeader(token));

    const date = TOMORROW.slice(0, 10);
    const res = await request(app)
      .get(`/api/bookings?date=${date}`)
      .set(authHeader(cashier));

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(0);
  });

  it('owner sees cancelled bookings', async () => {
    const { token } = await setup();
    const bkRes = await createBooking(token, { startAt: TOMORROW });
    await request(app)
      .delete(`/api/bookings/${bkRes.body._id}`)
      .set(authHeader(token));

    const date = TOMORROW.slice(0, 10);
    const res = await request(app)
      .get(`/api/bookings?date=${date}`)
      .set(authHeader(token));

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].status).toBe('cancelled');
  });

  it('multi-tenancy: only returns bookings from own store', async () => {
    const ownerA = await createUser({ username: 'ownera' });
    const storeA = await createStore(ownerA._id);
    const tokenA = tokenFor(ownerA, storeA._id);

    const ownerB = await createUser({ username: 'ownerb' });
    const storeB = await createStore(ownerB._id);
    const tokenB = tokenFor(ownerB, storeB._id);

    await createBooking(tokenB, { startAt: TOMORROW });

    const date = TOMORROW.slice(0, 10);
    const res = await request(app)
      .get(`/api/bookings?date=${date}`)
      .set(authHeader(tokenA));

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(0);
  });
});

// ── GET /api/bookings/:id ────────────────────────────────────────────────────

describe('GET /api/bookings/:id', () => {
  it('returns a single booking', async () => {
    const { token } = await setup();
    const created = (await createBooking(token)).body;

    const res = await request(app)
      .get(`/api/bookings/${created._id}`)
      .set(authHeader(token));

    expect(res.status).toBe(200);
    expect(res.body._id).toBe(created._id);
    expect(res.body.guestName).toBe('Alice Smith');
  });

  it('returns 404 for unknown id', async () => {
    const { token } = await setup();
    const res = await request(app)
      .get('/api/bookings/000000000000000000000001')
      .set(authHeader(token));
    expect(res.status).toBe(404);
  });
});

// ── PUT /api/bookings/:id ────────────────────────────────────────────────────

describe('PUT /api/bookings/:id', () => {
  it('owner can update guest info', async () => {
    const { token } = await setup();
    const created = (await createBooking(token)).body;

    const res = await request(app)
      .put(`/api/bookings/${created._id}`)
      .set(authHeader(token))
      .send({ guestName: 'Bob Jones', partySize: 4 });

    expect(res.status).toBe(200);
    expect(res.body.guestName).toBe('Bob Jones');
    expect(res.body.partySize).toBe(4);
  });

  it('cashier cannot update a booking', async () => {
    const { store, token } = await setup();
    const created = (await createBooking(token)).body;
    const cashier = cashierToken(store._id);

    const res = await request(app)
      .put(`/api/bookings/${created._id}`)
      .set(authHeader(cashier))
      .send({ guestName: 'Hacker' });

    expect(res.status).toBe(403);
  });
});

// ── DELETE /api/bookings/:id (soft cancel) ───────────────────────────────────

describe('DELETE /api/bookings/:id', () => {
  it('owner can cancel a booking (sets status to cancelled)', async () => {
    const { token } = await setup();
    const created = (await createBooking(token)).body;

    const res = await request(app)
      .delete(`/api/bookings/${created._id}`)
      .set(authHeader(token));

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('cancelled');
  });

  it('does not delete the document — booking is still retrievable', async () => {
    const { token } = await setup();
    const created = (await createBooking(token)).body;
    await request(app).delete(`/api/bookings/${created._id}`).set(authHeader(token));

    const res = await request(app)
      .get(`/api/bookings/${created._id}`)
      .set(authHeader(token));

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('cancelled');
  });

  it('cashier cannot cancel a booking', async () => {
    const { store, token } = await setup();
    const created = (await createBooking(token)).body;
    const cashier = cashierToken(store._id);

    const res = await request(app)
      .delete(`/api/bookings/${created._id}`)
      .set(authHeader(cashier));

    expect(res.status).toBe(403);
  });
});

// ── Status transitions ───────────────────────────────────────────────────────

describe('PATCH /api/bookings/:id/seat', () => {
  it('owner can seat a booking', async () => {
    const { token } = await setup();
    const created = (await createBooking(token)).body;

    const res = await request(app)
      .patch(`/api/bookings/${created._id}/seat`)
      .set(authHeader(token));

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('seated');
  });

  it('cashier can seat a booking', async () => {
    const { store, token } = await setup();
    const created = (await createBooking(token)).body;
    const cashier = cashierToken(store._id);

    const res = await request(app)
      .patch(`/api/bookings/${created._id}/seat`)
      .set(authHeader(cashier));

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('seated');
  });
});

describe('PATCH /api/bookings/:id/noshow', () => {
  it('marks booking as no_show', async () => {
    const { token } = await setup();
    const created = (await createBooking(token)).body;

    const res = await request(app)
      .patch(`/api/bookings/${created._id}/noshow`)
      .set(authHeader(token));

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('no_show');
  });
});

describe('PATCH /api/bookings/:id/complete', () => {
  it('marks booking as completed', async () => {
    const { token } = await setup();
    const created = (await createBooking(token)).body;

    const res = await request(app)
      .patch(`/api/bookings/${created._id}/complete`)
      .set(authHeader(token));

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('completed');
  });
});
