process.env.JWT_SECRET = 'test-secret';
process.env.SUPERADMIN_USERNAME = 'superadmin';

const request = require('supertest');
const app = require('../server');
const db = require('./helpers/db');
const {
  createUser, createStore, createMembershipType,
  createMember, tokenFor, authHeader,
} = require('./helpers/factories');

beforeAll(() => db.connect());
afterEach(() => db.clearAll());
afterAll(() => db.disconnect());

async function setup() {
  const owner = await createUser({ username: 'owner' });
  const store = await createStore(owner._id);
  const mtype = await createMembershipType(store._id);
  const token = tokenFor(owner, store._id);
  return { owner, store, mtype, token };
}

describe('POST /api/members', () => {
  it('creates a member', async () => {
    const { store, mtype, token } = await setup();

    const res = await request(app)
      .post('/api/members')
      .set(authHeader(token))
      .send({
        name: 'John Doe',
        membershipTypeId: mtype._id,
        startDate: new Date().toISOString(),
        nextDueDate: new Date(Date.now() + 30 * 86400000).toISOString(),
      });

    expect(res.status).toBe(201);
    expect(res.body.name).toBe('John Doe');
    expect(res.body.storeId).toBe(store._id.toString());
  });
});

describe('GET /api/members', () => {
  it('returns members for the store', async () => {
    const { store, mtype, token } = await setup();
    await createMember(store._id, mtype._id, { name: 'Alice' });
    await createMember(store._id, mtype._id, { name: 'Bob' });

    const res = await request(app)
      .get('/api/members')
      .set(authHeader(token));

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
  });

  it('auto-marks members as overdue on GET when nextDueDate has passed', async () => {
    const { store, mtype, token } = await setup();
    // Create member with nextDueDate in the past
    await createMember(store._id, mtype._id, {
      name: 'Late Payer',
      status: 'active',
      nextDueDate: new Date(Date.now() - 86400000), // yesterday
    });

    const res = await request(app)
      .get('/api/members')
      .set(authHeader(token));

    expect(res.status).toBe(200);
    expect(res.body[0].status).toBe('overdue');
  });

  it('filters by status', async () => {
    const { store, mtype, token } = await setup();
    await createMember(store._id, mtype._id, { name: 'Active', status: 'active' });
    await createMember(store._id, mtype._id, { name: 'Suspended', status: 'suspended' });

    const res = await request(app)
      .get('/api/members?status=suspended')
      .set(authHeader(token));

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].name).toBe('Suspended');
  });

  it('filters by search term', async () => {
    const { store, mtype, token } = await setup();
    await createMember(store._id, mtype._id, { name: 'Carlos Rivera' });
    await createMember(store._id, mtype._id, { name: 'Ana Smith' });

    const res = await request(app)
      .get('/api/members?search=carlos')
      .set(authHeader(token));

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].name).toBe('Carlos Rivera');
  });
});

describe('PUT /api/members/:id', () => {
  it('updates a member', async () => {
    const { store, mtype, token } = await setup();
    const member = await createMember(store._id, mtype._id, { name: 'Old Name' });

    const res = await request(app)
      .put(`/api/members/${member._id}`)
      .set(authHeader(token))
      .send({ name: 'New Name', notes: 'Updated' });

    expect(res.status).toBe(200);
    expect(res.body.name).toBe('New Name');
  });
});

describe('DELETE /api/members/:id', () => {
  it('deletes the member and their payment history', async () => {
    const { store, mtype, token } = await setup();
    const member = await createMember(store._id, mtype._id);

    // Record a payment first
    await request(app)
      .post(`/api/members/${member._id}/payments`)
      .set(authHeader(token))
      .send({ method: 'cash', paidDate: new Date().toISOString() });

    const deleteRes = await request(app)
      .delete(`/api/members/${member._id}`)
      .set(authHeader(token));

    expect(deleteRes.status).toBe(200);

    // Member is gone
    const getRes = await request(app)
      .get(`/api/members/${member._id}`)
      .set(authHeader(token));
    expect(getRes.status).toBe(404);

    // Payments are gone
    const paymentsRes = await request(app)
      .get(`/api/members/${member._id}/payments`)
      .set(authHeader(token));
    expect(paymentsRes.body).toHaveLength(0);
  });
});

describe('Multi-tenancy isolation', () => {
  it('store A cannot see store B members', async () => {
    const ownerA = await createUser({ username: 'ownera' });
    const storeA = await createStore(ownerA._id);
    const mtypeA = await createMembershipType(storeA._id);
    const tokenA = tokenFor(ownerA, storeA._id);

    const ownerB = await createUser({ username: 'ownerb' });
    const storeB = await createStore(ownerB._id);
    const mtypeB = await createMembershipType(storeB._id);
    await createMember(storeB._id, mtypeB._id, { name: 'B Member' });

    const res = await request(app)
      .get('/api/members')
      .set(authHeader(tokenA));

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(0);
  });
});
