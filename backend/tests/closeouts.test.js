process.env.JWT_SECRET = 'test-secret';
process.env.SUPERADMIN_USERNAME = 'superadmin';

const request = require('supertest');
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

describe('GET /api/closeouts/sales-summary', () => {
  it('returns zeros when there is nothing for the day', async () => {
    const { token } = await setup();

    const res = await request(app)
      .get('/api/closeouts/sales-summary?date=2099-06-01')
      .set(authHeader(token));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      totalSales: 0, transferAmount: 0, cashSales: 0,
      duesTotal: 0, duesCash: 0, duesTransfer: 0,
    });
  });

  it('folds a cash dues payment into cashSales/totalSales, not transferAmount', async () => {
    const { store, token } = await setup();
    const paidDate = new Date('2099-06-01T12:00:00Z');

    await createSale(store._id, { total: 40, paymentMethod: 'cash', createdAt: paidDate });

    const membershipType = await createMembershipType(store._id);
    const member = await createMember(store._id, membershipType._id);
    await createMemberPayment(store._id, member._id, membershipType._id, {
      amount: 25, method: 'cash', paidDate,
    });

    const res = await request(app)
      .get('/api/closeouts/sales-summary?date=2099-06-01')
      .set(authHeader(token));

    expect(res.status).toBe(200);
    expect(res.body.totalSales).toBe(65);     // 40 POS + 25 dues
    expect(res.body.transferAmount).toBe(0);
    expect(res.body.cashSales).toBe(65);       // all cash, drawer should reflect both
    expect(res.body.duesTotal).toBe(25);
    expect(res.body.duesCash).toBe(25);
    expect(res.body.duesTransfer).toBe(0);
  });

  it('folds a bank-transfer dues payment into transferAmount, not cashSales', async () => {
    const { store, token } = await setup();
    const paidDate = new Date('2099-06-02T12:00:00Z');

    await createSale(store._id, { total: 40, paymentMethod: 'cash', createdAt: paidDate });

    const membershipType = await createMembershipType(store._id);
    const member = await createMember(store._id, membershipType._id);
    await createMemberPayment(store._id, member._id, membershipType._id, {
      amount: 25, method: 'bank_transfer', paidDate,
    });

    const res = await request(app)
      .get('/api/closeouts/sales-summary?date=2099-06-02')
      .set(authHeader(token));

    expect(res.status).toBe(200);
    expect(res.body.totalSales).toBe(65);
    expect(res.body.transferAmount).toBe(25);
    expect(res.body.cashSales).toBe(40);       // unaffected — dues went to the bank, not the drawer
    expect(res.body.duesTotal).toBe(25);
    expect(res.body.duesCash).toBe(0);
    expect(res.body.duesTransfer).toBe(25);
  });

  it('excludes dues payments from a different day', async () => {
    const { store, token } = await setup();

    const membershipType = await createMembershipType(store._id);
    const member = await createMember(store._id, membershipType._id);
    await createMemberPayment(store._id, member._id, membershipType._id, {
      amount: 25, method: 'cash', paidDate: new Date('2099-06-09T12:00:00Z'),
    });

    const res = await request(app)
      .get('/api/closeouts/sales-summary?date=2099-06-01')
      .set(authHeader(token));

    expect(res.status).toBe(200);
    expect(res.body.duesTotal).toBe(0);
    expect(res.body.totalSales).toBe(0);
  });

  it('multi-tenancy: only folds in dues from the requesting store', async () => {
    const ownerA = await createUser({ username: 'a' });
    const storeA = await createStore(ownerA._id);
    const tokenA = tokenFor(ownerA, storeA._id);

    const ownerB = await createUser({ username: 'b' });
    const storeB = await createStore(ownerB._id);
    const paidDate = new Date('2099-06-01T12:00:00Z');
    const membershipTypeB = await createMembershipType(storeB._id);
    const memberB = await createMember(storeB._id, membershipTypeB._id);
    await createMemberPayment(storeB._id, memberB._id, membershipTypeB._id, {
      amount: 99, method: 'cash', paidDate,
    });

    const res = await request(app)
      .get('/api/closeouts/sales-summary?date=2099-06-01')
      .set(authHeader(tokenA));

    expect(res.status).toBe(200);
    expect(res.body.duesTotal).toBe(0);
  });
});

describe('Cash drawer reconciliation', () => {
  async function createDraft(token, overrides = {}) {
    const res = await request(app)
      .post('/api/closeouts')
      .set(authHeader(token))
      .send({
        date: '2099-07-01',
        totalSales: 50, transferAmount: 0, cashSales: 50,
        shifts: [], deductions: [], notes: '',
        ...overrides,
      });
    return res.body;
  }

  it('defaults actualCashCounted to null and cashVariance to 0 on creation', async () => {
    const { token } = await setup();
    const closeout = await createDraft(token);

    expect(closeout.actualCashCounted).toBeNull();
    expect(closeout.cashVariance).toBe(0);
  });

  it('blocks submit when the drawer has not been counted', async () => {
    const { token } = await setup();
    const closeout = await createDraft(token);

    const res = await request(app)
      .patch(`/api/closeouts/${closeout._id}/submit`)
      .set(authHeader(token));

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('cash_count_required');
  });

  it('allows submit when the count matches exactly (variance 0)', async () => {
    const { token } = await setup();
    const closeout = await createDraft(token);

    await request(app)
      .put(`/api/closeouts/${closeout._id}`)
      .set(authHeader(token))
      .send({ totalSales: 50, transferAmount: 0, cashSales: 50, shifts: [], deductions: [], notes: '', actualCashCounted: 50 });

    const res = await request(app)
      .patch(`/api/closeouts/${closeout._id}/submit`)
      .set(authHeader(token));

    expect(res.status).toBe(200);
    expect(res.body.cashVariance).toBe(0);
    expect(res.body.status).toBe('submitted');
  });

  it('blocks submit when there is a variance and no note', async () => {
    const { token } = await setup();
    const closeout = await createDraft(token);

    await request(app)
      .put(`/api/closeouts/${closeout._id}`)
      .set(authHeader(token))
      .send({ totalSales: 50, transferAmount: 0, cashSales: 50, shifts: [], deductions: [], notes: '', actualCashCounted: 45 });

    const res = await request(app)
      .patch(`/api/closeouts/${closeout._id}/submit`)
      .set(authHeader(token));

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('variance_note_required');
  });

  it('allows submit when there is a variance and a note is provided', async () => {
    const { token } = await setup();
    const closeout = await createDraft(token);

    await request(app)
      .put(`/api/closeouts/${closeout._id}`)
      .set(authHeader(token))
      .send({
        totalSales: 50, transferAmount: 0, cashSales: 50, shifts: [], deductions: [], notes: '',
        actualCashCounted: 45, cashVarianceNote: 'Gave incorrect change on a $5 sale',
      });

    const res = await request(app)
      .patch(`/api/closeouts/${closeout._id}/submit`)
      .set(authHeader(token));

    expect(res.status).toBe(200);
    expect(res.body.cashVariance).toBe(-5);
    expect(res.body.status).toBe('submitted');
  });

  it('GET /report sums cashVariance across closeouts in range', async () => {
    const { token } = await setup();

    const c1 = await createDraft(token, { date: '2099-07-01' });
    await request(app).put(`/api/closeouts/${c1._id}`).set(authHeader(token))
      .send({
        totalSales: 50, transferAmount: 0, cashSales: 50, shifts: [], deductions: [], notes: '',
        actualCashCounted: 55, cashVarianceNote: 'till over by $5',
      });
    await request(app).patch(`/api/closeouts/${c1._id}/submit`).set(authHeader(token));

    const c2 = await createDraft(token, { date: '2099-07-02' });
    await request(app).put(`/api/closeouts/${c2._id}`).set(authHeader(token))
      .send({
        totalSales: 50, transferAmount: 0, cashSales: 50, shifts: [], deductions: [], notes: '',
        actualCashCounted: 47, cashVarianceNote: 'short on change',
      });
    await request(app).patch(`/api/closeouts/${c2._id}/submit`).set(authHeader(token));

    const res = await request(app)
      .get('/api/closeouts/report?from=2099-07-01&to=2099-07-02')
      .set(authHeader(token));

    expect(res.status).toBe(200);
    expect(res.body.cashVariance).toBe(2); // +5 (over) + -3 (short)
  });
});
