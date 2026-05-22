process.env.JWT_SECRET        = 'test-secret';
process.env.SUPERADMIN_USERNAME = 'superadmin';
process.env.EMAIL_HOST        = 'smtp.test.example';
process.env.EMAIL_USER        = 'test@example.com';
process.env.EMAIL_PASS        = 'testpass';
process.env.EMAIL_FROM        = 'noreply@test.com';
process.env.REMINDER_INTERVAL_DAYS = '7';

const request = require('supertest');
const app     = require('../server');
const db      = require('./helpers/db');
const {
  createUser, createStore, createMembershipType,
  createMember, tokenFor, authHeader,
} = require('./helpers/factories');

// Capture spies before jest.mock hoists the factory
const mockSendMail = jest.fn().mockResolvedValue({ messageId: 'test-id' });
const mockClose    = jest.fn();

jest.mock('nodemailer', () => ({
  createTransport: jest.fn(() => ({ sendMail: mockSendMail, close: mockClose })),
}));

beforeAll(() => db.connect());
afterEach(() => { db.clearAll(); jest.clearAllMocks(); });
afterAll(() => db.disconnect());

async function setup({ emailReminders = true } = {}) {
  const owner = await createUser({ username: 'owner' });
  const store = await createStore(owner._id, {
    businessName: 'Test Gym',
    hiveAccount: 'testgym',
    features: { memberships: true, emailReminders },
  });
  const mtype = await createMembershipType(store._id);
  const token = tokenFor(owner, store._id);
  return { owner, store, mtype, token };
}

describe('POST /api/reminders/send', () => {
  it('sends emails to overdue members with an email address', async () => {
    const { store, mtype, token } = await setup();

    await createMember(store._id, mtype._id, {
      name: 'Overdue Alice',
      email: 'alice@example.com',
      status: 'overdue',
      nextDueDate: new Date(Date.now() - 3 * 86400000),
    });
    await createMember(store._id, mtype._id, {
      name: 'Overdue Bob',
      email: 'bob@example.com',
      status: 'overdue',
      nextDueDate: new Date(Date.now() - 5 * 86400000),
    });

    const res = await request(app)
      .post('/api/reminders/send')
      .set(authHeader(token));

    expect(res.status).toBe(200);
    expect(res.body.sent).toBe(2);
    expect(res.body.errors).toBe(0);

    expect(mockSendMail).toHaveBeenCalledTimes(2);
  });

  it('skips active members', async () => {
    const { store, mtype, token } = await setup();

    await createMember(store._id, mtype._id, {
      name: 'Active Member',
      email: 'active@example.com',
      status: 'active',
    });

    const res = await request(app)
      .post('/api/reminders/send')
      .set(authHeader(token));

    expect(res.status).toBe(200);
    expect(res.body.sent).toBe(0);
  });

  it('skips overdue members without an email address', async () => {
    const { store, mtype, token } = await setup();

    await createMember(store._id, mtype._id, {
      name: 'No Email',
      email: '',
      status: 'overdue',
      nextDueDate: new Date(Date.now() - 86400000),
    });

    const res = await request(app)
      .post('/api/reminders/send')
      .set(authHeader(token));

    expect(res.status).toBe(200);
    expect(res.body.sent).toBe(0);
  });

  it('skips members reminded within the interval window', async () => {
    const { store, mtype, token } = await setup();

    await createMember(store._id, mtype._id, {
      name: 'Recently Reminded',
      email: 'recent@example.com',
      status: 'overdue',
      nextDueDate: new Date(Date.now() - 86400000),
      lastReminderSent: new Date(Date.now() - 2 * 86400000), // reminded 2 days ago (< 7 day window)
    });

    const res = await request(app)
      .post('/api/reminders/send')
      .set(authHeader(token));

    expect(res.status).toBe(200);
    expect(res.body.sent).toBe(0);
    expect(res.body.skipped).toBe(1);
  });

  it('sends again after the interval has passed', async () => {
    const { store, mtype, token } = await setup();

    await createMember(store._id, mtype._id, {
      name: 'Due Again',
      email: 'dueagain@example.com',
      status: 'overdue',
      nextDueDate: new Date(Date.now() - 86400000),
      lastReminderSent: new Date(Date.now() - 8 * 86400000), // reminded 8 days ago (> 7 day window)
    });

    const res = await request(app)
      .post('/api/reminders/send')
      .set(authHeader(token));

    expect(res.status).toBe(200);
    expect(res.body.sent).toBe(1);
  });

  it('updates lastReminderSent after sending', async () => {
    const { store, mtype, token } = await setup();
    const Member = require('../models/Member');

    const member = await createMember(store._id, mtype._id, {
      name: 'Track Me',
      email: 'track@example.com',
      status: 'overdue',
      nextDueDate: new Date(Date.now() - 86400000),
    });

    await request(app)
      .post('/api/reminders/send')
      .set(authHeader(token));

    const updated = await Member.findById(member._id);
    expect(updated.lastReminderSent).not.toBeNull();
    expect(new Date() - updated.lastReminderSent).toBeLessThan(5000);
  });

  it('returns 503 when email is not configured', async () => {
    const { token } = await setup();
    const savedHost = process.env.EMAIL_HOST;
    delete process.env.EMAIL_HOST;

    const res = await request(app)
      .post('/api/reminders/send')
      .set(authHeader(token));

    expect(res.status).toBe(503);
    process.env.EMAIL_HOST = savedHost;
  });

  it('blocks cashiers from triggering reminders', async () => {
    const { store } = await setup();
    const jwt = require('jsonwebtoken');
    const cashierToken = jwt.sign(
      { cashierId: 'abc', storeId: store._id, role: 'cashier', username: 'bob' },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );

    const res = await request(app)
      .post('/api/reminders/send')
      .set(authHeader(cashierToken));

    expect(res.status).toBe(403);
  });

  it('multi-tenancy: only sends for own store members', async () => {
    const ownerA = await createUser({ username: 'ownera' });
    const storeA = await createStore(ownerA._id, { features: { memberships: true, emailReminders: true } });
    const mtypeA = await createMembershipType(storeA._id);
    const tokenA = tokenFor(ownerA, storeA._id);

    const ownerB = await createUser({ username: 'ownerb' });
    const storeB = await createStore(ownerB._id, { features: { memberships: true, emailReminders: true } });
    const mtypeB = await createMembershipType(storeB._id);

    // Only store B has an overdue member
    await createMember(storeB._id, mtypeB._id, {
      name: 'B Member',
      email: 'b@example.com',
      status: 'overdue',
      nextDueDate: new Date(Date.now() - 86400000),
    });

    // Store A triggers reminders — should send 0
    const res = await request(app)
      .post('/api/reminders/send')
      .set(authHeader(tokenA));

    expect(res.status).toBe(200);
    expect(res.body.sent).toBe(0);
  });
});
