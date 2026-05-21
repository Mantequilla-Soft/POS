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
  it('creates a store with settings correctly flattened', async () => {
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
    expect(res.body.businessName).toBe('Iron Gym');
    expect(res.body.hiveAccount).toBe('irongym');
    expect(res.body.published).toBe(true);
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
  it('updates store fields including feature flags', async () => {
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
    expect(res.body.businessName).toBe('Updated Name');
    expect(res.body.features.memberships).toBe(true);
  });
});

describe('Multi-tenancy isolation', () => {
  it('owner A cannot read owner B store via config endpoint', async () => {
    const ownerA = await createUser({ username: 'ownera' });
    const ownerB = await createUser({ username: 'ownerb' });
    await createStore(ownerB._id, { businessName: "B's Store" });

    // ownerA has no store — should get 404, not B's store
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
