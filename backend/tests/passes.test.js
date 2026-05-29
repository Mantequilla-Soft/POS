process.env.JWT_SECRET = 'test-secret';
process.env.SUPERADMIN_USERNAME = 'superadmin';

const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../server');
const db = require('./helpers/db');
const Member = require('../models/Member');
const { createUser, createStore, createMembershipType, createMember, tokenFor, authHeader } = require('./helpers/factories');

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
  return jwt.sign({ cashierId: 'c1', storeId, role: 'cashier', username: 'desk' }, process.env.JWT_SECRET, { expiresIn: '1h' });
}

// ── POST /api/members/pass-sale ───────────────────────────────────────────────

describe('POST /api/members/pass-sale', () => {
  it('creates an active pass holder with payment recorded', async () => {
    const { store, token } = await setup();
    const passType = await createMembershipType(store._id, { name: 'Day Pass', durationDays: 1, price: 5, isPass: true });

    const res = await request(app)
      .post('/api/members/pass-sale')
      .set(authHeader(token))
      .send({ membershipTypeId: passType._id, name: 'Walk In', email: 'w@test.com', paymentMethod: 'cash' });

    expect(res.status).toBe(201);
    expect(res.body.name).toBe('Walk In');
    expect(res.body.isPass).toBe(true);
    expect(res.body.status).toBe('active');
    expect(res.body.nextDueDate).toBeDefined();
  });

  it('nextDueDate is set to startDate + durationDays', async () => {
    const { store, token } = await setup();
    const passType = await createMembershipType(store._id, { name: 'Week Pass', durationDays: 7, isPass: true });

    const res = await request(app)
      .post('/api/members/pass-sale')
      .set(authHeader(token))
      .send({ membershipTypeId: passType._id, name: 'Jane', paymentMethod: 'cash' });

    expect(res.status).toBe(201);
    const start = new Date(res.body.startDate);
    const end   = new Date(res.body.nextDueDate);
    const diffDays = Math.round((end - start) / 86400000);
    expect(diffDays).toBe(7);
  });

  it('cashier can sell a pass', async () => {
    const { store } = await setup();
    const passType = await createMembershipType(store._id, { name: 'Day Pass', durationDays: 1, isPass: true });
    const token = cashierToken(store._id);

    const res = await request(app)
      .post('/api/members/pass-sale')
      .set(authHeader(token))
      .send({ membershipTypeId: passType._id, name: 'Guest', paymentMethod: 'cash' });

    expect(res.status).toBe(201);
  });

  it('rejects if membershipTypeId is not a pass type', async () => {
    const { store, token } = await setup();
    const regularType = await createMembershipType(store._id, { name: 'Monthly', isPass: false });

    const res = await request(app)
      .post('/api/members/pass-sale')
      .set(authHeader(token))
      .send({ membershipTypeId: regularType._id, name: 'Test', paymentMethod: 'cash' });

    expect(res.status).toBe(404);
  });

  it('rejects missing name', async () => {
    const { store, token } = await setup();
    const passType = await createMembershipType(store._id, { isPass: true });

    const res = await request(app)
      .post('/api/members/pass-sale')
      .set(authHeader(token))
      .send({ membershipTypeId: passType._id, paymentMethod: 'cash' });

    expect(res.status).toBe(400);
  });

  it('rejects unauthenticated', async () => {
    const { store } = await setup();
    const passType = await createMembershipType(store._id, { isPass: true });

    const res = await request(app)
      .post('/api/members/pass-sale')
      .send({ membershipTypeId: passType._id, name: 'Test', paymentMethod: 'cash' });

    expect(res.status).toBe(401);
  });
});

// ── isPass filter on GET /api/members ────────────────────────────────────────

describe('GET /api/members — isPass filter', () => {
  it('?isPass=true returns only pass holders', async () => {
    const { store, token } = await setup();
    const mt = await createMembershipType(store._id);
    await createMember(store._id, mt._id, { name: 'Regular', isPass: false });
    await createMember(store._id, mt._id, { name: 'Pass Holder', isPass: true });

    const res = await request(app).get('/api/members?isPass=true').set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.members).toHaveLength(1);
    expect(res.body.members[0].name).toBe('Pass Holder');
  });

  it('?isPass=false excludes pass holders', async () => {
    const { store, token } = await setup();
    const mt = await createMembershipType(store._id);
    await createMember(store._id, mt._id, { name: 'Regular', isPass: false });
    await createMember(store._id, mt._id, { name: 'Pass Holder', isPass: true });

    const res = await request(app).get('/api/members?isPass=false').set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.members).toHaveLength(1);
    expect(res.body.members[0].name).toBe('Regular');
  });
});

// ── syncOverdueStatus pass exemption ─────────────────────────────────────────

describe('Pass holders exempted from overdue status', () => {
  it('expired pass goes to expired (not overdue) when nextDueDate passes', async () => {
    const { store, token } = await setup();
    const mt = await createMembershipType(store._id, { isPass: true });
    await createMember(store._id, mt._id, {
      name: 'Expired Pass',
      isPass: true,
      status: 'active',
      nextDueDate: new Date(Date.now() - 86400000), // yesterday
    });

    // syncOverdueStatus runs on GET /api/members
    const res = await request(app).get('/api/members').set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.members[0].status).toBe('expired');
  });

  it('regular member still goes overdue (regression)', async () => {
    const { store, token } = await setup();
    const mt = await createMembershipType(store._id, { isPass: false });
    await createMember(store._id, mt._id, {
      name: 'Late Member',
      isPass: false,
      status: 'active',
      nextDueDate: new Date(Date.now() - 86400000),
    });

    const res = await request(app).get('/api/members').set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.members[0].status).toBe('overdue');
  });
});
