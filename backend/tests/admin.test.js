process.env.JWT_SECRET = 'test-secret';
process.env.SUPERADMIN_USERNAME = 'superadmin';

const request = require('supertest');
const app = require('../server');
const db = require('./helpers/db');
const { createUser, createStore, tokenFor, authHeader } = require('./helpers/factories');

beforeAll(() => db.connect());
afterEach(() => db.clearAll());
afterAll(() => db.disconnect());

describe('GET /api/admin/pending', () => {
  it('returns unapproved users', async () => {
    const admin = await createUser({ username: 'superadmin', role: 'superadmin' });
    await createUser({ username: 'pending1', approved: false });
    await createUser({ username: 'pending2', approved: false });
    await createUser({ username: 'approved1', approved: true });

    const res = await request(app)
      .get('/api/admin/pending')
      .set(authHeader(tokenFor(admin)));

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body.map(u => u.username)).toEqual(
      expect.arrayContaining(['pending1', 'pending2'])
    );
    // never expose passwords
    res.body.forEach(u => expect(u.password).toBeUndefined());
  });

  it('blocks non-superadmin', async () => {
    const owner = await createUser({ username: 'owner' });
    const store = await createStore(owner._id);

    const res = await request(app)
      .get('/api/admin/pending')
      .set(authHeader(tokenFor(owner, store._id)));

    expect(res.status).toBe(403);
  });
});

describe('POST /api/admin/approve/:userId', () => {
  it('approves a pending user and allows login', async () => {
    const admin = await createUser({ username: 'superadmin', role: 'superadmin' });
    const pending = await createUser({ username: 'newowner', approved: false });

    const approveRes = await request(app)
      .post(`/api/admin/approve/${pending._id}`)
      .set(authHeader(tokenFor(admin)));

    expect(approveRes.status).toBe(200);

    // Now they can log in
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ username: 'newowner', password: 'password123' });

    expect(loginRes.status).toBe(200);
    expect(loginRes.body.token).toBeDefined();
  });
});

describe('DELETE /api/admin/reject/:userId', () => {
  it('removes the user entirely', async () => {
    const admin = await createUser({ username: 'superadmin', role: 'superadmin' });
    const pending = await createUser({ username: 'rejected', approved: false });

    const rejectRes = await request(app)
      .delete(`/api/admin/reject/${pending._id}`)
      .set(authHeader(tokenFor(admin)));

    expect(rejectRes.status).toBe(200);

    // Login now returns 401 (user not found)
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ username: 'rejected', password: 'password123' });

    expect(loginRes.status).toBe(401);
  });
});

describe('GET /api/admin/stores', () => {
  it('returns all stores with owner info', async () => {
    const admin = await createUser({ username: 'superadmin', role: 'superadmin' });
    const ownerA = await createUser({ username: 'ownera' });
    const ownerB = await createUser({ username: 'ownerb' });
    await createStore(ownerA._id, { businessName: 'Gym Alpha' });
    await createStore(ownerB._id, { businessName: 'Bakery Beta' });

    const res = await request(app)
      .get('/api/admin/stores')
      .set(authHeader(tokenFor(admin)));

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    const names = res.body.map(s => s.businessName);
    expect(names).toEqual(expect.arrayContaining(['Gym Alpha', 'Bakery Beta']));
  });
});
