process.env.JWT_SECRET = 'test-secret';
process.env.SUPERADMIN_USERNAME = 'superadmin';

const request = require('supertest');
const app = require('../server');
const db = require('./helpers/db');
const { createUser, createStore, tokenFor, authHeader } = require('./helpers/factories');

beforeAll(() => db.connect());
afterEach(() => db.clearAll());
afterAll(() => db.disconnect());

describe('POST /api/store', () => {
  it('creates a store and returns { store, token }', async () => {
    const owner = await createUser({ username: 'owner' });

    const res = await request(app)
      .post('/api/store')
      .set(authHeader(tokenFor(owner)))
      .send({
        settings: {
          businessName: 'Iron Gym',
          hiveAccount: 'irongym',
          categories: ['fitness'],
          bitcoinLightningEnabled: false,
        },
        items: [],
        published: true,
      });

    expect(res.status).toBe(201);
    expect(res.body.store.businessName).toBe('Iron Gym');
    expect(res.body.store.hiveAccount).toBe('irongym');
    expect(res.body.store.published).toBe(true);
    // Fresh token with storeId should be returned
    expect(res.body.token).toBeDefined();
  });

  it('rejects a second store for the same owner', async () => {
    const owner = await createUser({ username: 'owner' });
    await createStore(owner._id);

    const res = await request(app)
      .post('/api/store')
      .set(authHeader(tokenFor(owner)))
      .send({ settings: { businessName: 'Second Store' } });

    expect(res.status).toBe(409);
  });

  it('requires authentication', async () => {
    const res = await request(app).post('/api/store').send({});
    expect(res.status).toBe(401);
  });

  it('blocks cashiers from creating stores', async () => {
    const owner = await createUser({ username: 'owner' });
    const store = await createStore(owner._id);
    const cashierToken = require('jsonwebtoken').sign(
      { cashierId: 'abc', storeId: store._id, role: 'cashier', username: 'bob' },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );

    const res = await request(app)
      .post('/api/store')
      .set(authHeader(cashierToken))
      .send({ settings: { businessName: 'Hacked Store' } });

    expect(res.status).toBe(403);
  });
});

describe('GET /api/store', () => {
  it('owner can read their store', async () => {
    const owner = await createUser({ username: 'owner' });
    const store = await createStore(owner._id, { businessName: 'My Shop' });

    const res = await request(app)
      .get('/api/store')
      .set(authHeader(tokenFor(owner, store._id)));

    expect(res.status).toBe(200);
    expect(res.body.businessName).toBe('My Shop');
  });

  it('cashier can read their store', async () => {
    const owner = await createUser({ username: 'owner' });
    const store = await createStore(owner._id, { businessName: 'Cashier Store' });
    const cashierToken = require('jsonwebtoken').sign(
      { cashierId: 'abc', storeId: store._id, role: 'cashier', username: 'bob' },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );

    const res = await request(app)
      .get('/api/store')
      .set(authHeader(cashierToken));

    expect(res.status).toBe(200);
    expect(res.body.businessName).toBe('Cashier Store');
  });
});

describe('GET /api/store/config', () => {
  it('returns store in legacy frontend shape', async () => {
    const owner = await createUser({ username: 'owner' });
    const store = await createStore(owner._id, {
      businessName: 'Sweet Bakery',
      hiveAccount: 'bakery',
      features: { memberships: true, bitcoinLightning: false },
    });

    const res = await request(app)
      .get('/api/store/config')
      .set(authHeader(tokenFor(owner, store._id)));

    expect(res.status).toBe(200);
    expect(res.body.settings.businessName).toBe('Sweet Bakery');
    expect(res.body.settings.hiveAccount).toBe('bakery');
    expect(res.body.features.memberships).toBe(true);
    expect(res.body._id).toBeDefined();
  });

  it('returns 404 when owner has no store', async () => {
    const owner = await createUser({ username: 'owner' });

    const res = await request(app)
      .get('/api/store/config')
      .set(authHeader(tokenFor(owner)));

    expect(res.status).toBe(404);
  });
});

describe('PUT /api/store', () => {
  it('updates store fields and returns { store }', async () => {
    const owner = await createUser({ username: 'owner' });
    const store = await createStore(owner._id, { features: { memberships: false } });

    const res = await request(app)
      .put('/api/store')
      .set(authHeader(tokenFor(owner, store._id)))
      .send({
        settings: { businessName: 'Updated Name' },
        features: { memberships: true },
      });

    expect(res.status).toBe(200);
    expect(res.body.store.businessName).toBe('Updated Name');
    expect(res.body.store.features.memberships).toBe(true);
  });

  it('saves membership feature flag correctly', async () => {
    const owner = await createUser({ username: 'owner' });
    const store = await createStore(owner._id, { features: { memberships: false } });

    await request(app)
      .put('/api/store')
      .set(authHeader(tokenFor(owner, store._id)))
      .send({ features: { memberships: true } });

    // Read it back
    const res = await request(app)
      .get('/api/store')
      .set(authHeader(tokenFor(owner, store._id)));

    expect(res.body.features.memberships).toBe(true);
  });

  it('blocks cashiers from updating the store', async () => {
    const owner = await createUser({ username: 'owner' });
    const store = await createStore(owner._id);
    const cashierToken = require('jsonwebtoken').sign(
      { cashierId: 'abc', storeId: store._id, role: 'cashier', username: 'bob' },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );

    const res = await request(app)
      .put('/api/store')
      .set(authHeader(cashierToken))
      .send({ settings: { businessName: 'Hacked' } });

    expect(res.status).toBe(403);
  });
});

describe('Multi-tenancy isolation', () => {
  it('owner A cannot read owner B store via config endpoint', async () => {
    const ownerA = await createUser({ username: 'ownera' });
    const ownerB = await createUser({ username: 'ownerb' });
    await createStore(ownerB._id, { businessName: "B's Store" });

    const res = await request(app)
      .get('/api/store/config')
      .set(authHeader(tokenFor(ownerA)));

    expect(res.status).toBe(404);
  });

  it('owner A cannot update owner B store', async () => {
    const ownerA = await createUser({ username: 'ownera' });
    const ownerB = await createUser({ username: 'ownerb' });
    const storeB = await createStore(ownerB._id);

    const res = await request(app)
      .put(`/api/store/${storeB._id}`)
      .set(authHeader(tokenFor(ownerA)))
      .send({ settings: { businessName: 'Hijacked' } });

    expect(res.status).toBe(404);
  });
});
