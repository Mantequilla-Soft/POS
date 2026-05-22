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
  const mtype = await createMembershipType(store._id, { durationDays: 30, price: 50 });
  const token = tokenFor(owner, store._id);
  return { owner, store, mtype, token };
}

describe('POST /api/members/:id/payments', () => {
  it('records a cash payment and advances nextDueDate by durationDays', async () => {
    const { store, mtype, token } = await setup();
    const paidDate = new Date('2026-01-01');
    const member = await createMember(store._id, mtype._id, {
      status: 'overdue',
      nextDueDate: new Date('2025-12-01'),
    });

    const res = await request(app)
      .post(`/api/members/${member._id}/payments`)
      .set(authHeader(token))
      .send({ method: 'cash', paidDate: paidDate.toISOString() });

    expect(res.status).toBe(201);

    // nextDueDate should be paidDate + 30 days
    const expectedDue = new Date('2026-01-31').toISOString().slice(0, 10);
    const actualDue = new Date(res.body.member.nextDueDate).toISOString().slice(0, 10);
    expect(actualDue).toBe(expectedDue);
  });

  it('restores member status to active after payment', async () => {
    const { store, mtype, token } = await setup();
    const member = await createMember(store._id, mtype._id, { status: 'overdue' });

    const res = await request(app)
      .post(`/api/members/${member._id}/payments`)
      .set(authHeader(token))
      .send({ method: 'cash', paidDate: new Date().toISOString() });

    expect(res.status).toBe(201);
    expect(res.body.member.status).toBe('active');
  });

  it('records an HBD payment with memo and payer', async () => {
    const { store, mtype, token } = await setup();
    const member = await createMember(store._id, mtype._id);

    const res = await request(app)
      .post(`/api/members/${member._id}/payments`)
      .set(authHeader(token))
      .send({
        method: 'hbd',
        amount: 50,
        currency: 'HBD',
        hiveTransactionMemo: 'kcs-hpos-ab1c-xy2z',
        hiveFrom: 'memberhive',
        paidDate: new Date().toISOString(),
      });

    expect(res.status).toBe(201);
    expect(res.body.payment.method).toBe('hbd');
    expect(res.body.payment.hiveTransactionMemo).toBe('kcs-hpos-ab1c-xy2z');
    expect(res.body.payment.hiveFrom).toBe('memberhive');
  });

  it('uses membership type price when amount is not provided', async () => {
    const { store, mtype, token } = await setup();
    const member = await createMember(store._id, mtype._id);

    const res = await request(app)
      .post(`/api/members/${member._id}/payments`)
      .set(authHeader(token))
      .send({ method: 'cash', paidDate: new Date().toISOString() });

    expect(res.status).toBe(201);
    expect(res.body.payment.amount).toBe(50); // mtype.price
  });
});

describe('GET /api/members/:id/payments', () => {
  it('returns payment history sorted newest first', async () => {
    const { store, mtype, token } = await setup();
    const member = await createMember(store._id, mtype._id);

    // Record two payments on different dates
    await request(app)
      .post(`/api/members/${member._id}/payments`)
      .set(authHeader(token))
      .send({ method: 'cash', paidDate: new Date('2026-01-01').toISOString() });

    await request(app)
      .post(`/api/members/${member._id}/payments`)
      .set(authHeader(token))
      .send({ method: 'cash', paidDate: new Date('2026-02-01').toISOString() });

    const res = await request(app)
      .get(`/api/members/${member._id}/payments`)
      .set(authHeader(token));

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    // Newest first
    expect(new Date(res.body[0].paidDate) > new Date(res.body[1].paidDate)).toBe(true);
  });
});

describe('Payment chaining — advance payments stack correctly', () => {
  it('second payment starts from nextDueDate, not paidDate, when member is already paid up', async () => {
    const { store, mtype, token } = await setup();
    const member = await createMember(store._id, mtype._id, {
      status: 'active',
      nextDueDate: new Date('2026-01-01'), // already expired
    });

    // First payment on Jan 1 → period Jan 1–31, nextDueDate = Jan 31
    await request(app)
      .post(`/api/members/${member._id}/payments`)
      .set(authHeader(token))
      .send({ method: 'cash', paidDate: new Date('2026-01-01').toISOString() });

    // Second payment also on Jan 1 — should chain from Jan 31, not duplicate Jan 1–31
    const res = await request(app)
      .post(`/api/members/${member._id}/payments`)
      .set(authHeader(token))
      .send({ method: 'cash', paidDate: new Date('2026-01-01').toISOString() });

    expect(res.status).toBe(201);

    const start = new Date(res.body.payment.periodStart).toISOString().slice(0, 10);
    const end   = new Date(res.body.payment.periodEnd).toISOString().slice(0, 10);
    expect(start).toBe('2026-01-31');
    expect(end).toBe('2026-03-02');   // Jan 31 + 30 days

    // nextDueDate should be Mar 2 — two full months paid in advance
    const due = new Date(res.body.member.nextDueDate).toISOString().slice(0, 10);
    expect(due).toBe('2026-03-02');
  });

  it('two same-day payments result in non-overlapping periods', async () => {
    const { store, mtype, token } = await setup();
    const member = await createMember(store._id, mtype._id, {
      status: 'overdue',
      nextDueDate: new Date('2025-12-01'),
    });

    const today = new Date('2026-05-21').toISOString();

    await request(app)
      .post(`/api/members/${member._id}/payments`)
      .set(authHeader(token))
      .send({ method: 'cash', paidDate: today });

    await request(app)
      .post(`/api/members/${member._id}/payments`)
      .set(authHeader(token))
      .send({ method: 'cash', paidDate: today });

    const histRes = await request(app)
      .get(`/api/members/${member._id}/payments`)
      .set(authHeader(token));

    expect(histRes.body).toHaveLength(2);

    // Sort by periodStart ascending so order is deterministic regardless of DB sort
    const sorted = [...histRes.body].sort(
      (a, b) => new Date(a.periodStart) - new Date(b.periodStart)
    );
    const firstEnd  = new Date(sorted[0].periodEnd).toISOString().slice(0, 10);
    const secondStart = new Date(sorted[1].periodStart).toISOString().slice(0, 10);
    // Second period starts exactly where the first one ends — no gap, no overlap
    expect(secondStart).toBe(firstEnd);
  });
});
