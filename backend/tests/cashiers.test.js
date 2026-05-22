process.env.JWT_SECRET          = 'test-secret';
process.env.SUPERADMIN_USERNAME = 'superadmin';

const request = require('supertest');
const app     = require('../server');
const db      = require('./helpers/db');
const { createUser, createStore, tokenFor, authHeader } = require('./helpers/factories');

beforeAll(() => db.connect());
afterEach(() => db.clearAll());
afterAll(() => db.disconnect());

async function setup() {
  const owner = await createUser({ username: 'owner' });
  const store = await createStore(owner._id);
  const token = tokenFor(owner, store._id);
  return { owner, store, token };
}

describe('GET /api/cashiers', () => {
  it('returns empty list for a new store', async () => {
    const { token } = await setup();
    const res = await request(app).get('/api/cashiers').set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('returns cashiers belonging to the store', async () => {
    const { token } = await setup();
    await request(app).post('/api/cashiers').set(authHeader(token))
      .send({ username: 'alice', password: 'pass123' });

    const res = await request(app).get('/api/cashiers').set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].username).toBe('alice');
    expect(res.body[0].password).toBeUndefined(); // never exposed
  });

  it('blocks unauthenticated requests', async () => {
    const res = await request(app).get('/api/cashiers');
    expect(res.status).toBe(401);
  });
});

describe('POST /api/cashiers', () => {
  it('creates a cashier', async () => {
    const { token } = await setup();
    const res = await request(app).post('/api/cashiers').set(authHeader(token))
      .send({ username: 'bob', password: 'secure123' });

    expect(res.status).toBe(201);
    expect(res.body.username).toBe('bob');
    expect(res.body.active).toBe(true);
    expect(res.body.password).toBeUndefined();
  });

  it('rejects missing username or password', async () => {
    const { token } = await setup();
    const res = await request(app).post('/api/cashiers').set(authHeader(token))
      .send({ username: 'bob' });
    expect(res.status).toBe(400);
  });

  it('rejects duplicate username within the same store', async () => {
    const { token } = await setup();
    await request(app).post('/api/cashiers').set(authHeader(token))
      .send({ username: 'dup', password: 'pass123' });

    const res = await request(app).post('/api/cashiers').set(authHeader(token))
      .send({ username: 'dup', password: 'other123' });
    expect(res.status).toBe(409);
  });

  it('blocks cashier role from creating cashiers', async () => {
    const { store } = await setup();
    const jwt = require('jsonwebtoken');
    const cashierToken = jwt.sign(
      { cashierId: 'abc', storeId: store._id, role: 'cashier', username: 'bob' },
      process.env.JWT_SECRET, { expiresIn: '1h' }
    );
    const res = await request(app).post('/api/cashiers').set(authHeader(cashierToken))
      .send({ username: 'x', password: 'y' });
    expect(res.status).toBe(403);
  });
});

describe('PUT /api/cashiers/:id', () => {
  it('updates username and active flag', async () => {
    const { token } = await setup();
    const created = await request(app).post('/api/cashiers').set(authHeader(token))
      .send({ username: 'carol', password: 'pass123' });
    const id = created.body.id;

    const res = await request(app).put(`/api/cashiers/${id}`).set(authHeader(token))
      .send({ username: 'carol2', active: false });

    expect(res.status).toBe(200);
    expect(res.body.username).toBe('carol2');
    expect(res.body.active).toBe(false);
  });

  it('returns 404 for a cashier belonging to another store', async () => {
    const { token: tokenA } = await setup();
    const ownerB  = await createUser({ username: 'ownerb' });
    const storeB  = await createStore(ownerB._id);
    const tokenB  = tokenFor(ownerB, storeB._id);

    const created = await request(app).post('/api/cashiers').set(authHeader(tokenA))
      .send({ username: 'mine', password: 'pass123' });
    const id = created.body.id;

    const res = await request(app).put(`/api/cashiers/${id}`).set(authHeader(tokenB))
      .send({ username: 'stolen' });
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/cashiers/:id', () => {
  it('deletes a cashier', async () => {
    const { token } = await setup();
    const created = await request(app).post('/api/cashiers').set(authHeader(token))
      .send({ username: 'del', password: 'pass123' });
    const id = created.body.id;

    const del = await request(app).delete(`/api/cashiers/${id}`).set(authHeader(token));
    expect(del.status).toBe(200);

    const list = await request(app).get('/api/cashiers').set(authHeader(token));
    expect(list.body).toHaveLength(0);
  });

  it('multi-tenancy: cannot delete another store cashier', async () => {
    const { token: tokenA } = await setup();
    const ownerB = await createUser({ username: 'ownerb' });
    const storeB = await createStore(ownerB._id);
    const tokenB = tokenFor(ownerB, storeB._id);

    const created = await request(app).post('/api/cashiers').set(authHeader(tokenA))
      .send({ username: 'notmine', password: 'pass123' });
    const id = created.body.id;

    // Delete silently scoped to storeB — won't find it, returns 200 but does nothing
    await request(app).delete(`/api/cashiers/${id}`).set(authHeader(tokenB));

    // Still exists for store A
    const list = await request(app).get('/api/cashiers').set(authHeader(tokenA));
    expect(list.body).toHaveLength(1);
  });
});
