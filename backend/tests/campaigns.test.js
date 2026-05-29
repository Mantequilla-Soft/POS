process.env.JWT_SECRET = 'test-secret';
process.env.SUPERADMIN_USERNAME = 'superadmin';

// Mock the mailer so tests never touch SMTP
jest.mock('../services/mailer', () => ({
  isConfigured:     jest.fn(() => true),
  sendCampaignEmail: jest.fn().mockResolvedValue(undefined),
}));

const request    = require('supertest');
const jwt        = require('jsonwebtoken');
const app        = require('../server');
const db         = require('./helpers/db');
const Member     = require('../models/Member');
const CampaignLog  = require('../models/CampaignLog');
const EmailTemplate = require('../models/EmailTemplate');
const mailer     = require('../services/mailer');
const { createUser, createStore, createMembershipType, createMember, tokenFor, authHeader } = require('./helpers/factories');

beforeAll(() => db.connect());
afterEach(async () => { await db.clearAll(); jest.clearAllMocks(); });
afterAll(() => db.disconnect());

// ── helpers ──────────────────────────────────────────────────────────────────

async function setup() {
  const owner = await createUser({ username: 'owner' });
  const store = await createStore(owner._id, { features: { memberships: true, emailCampaigns: true } });
  const token = tokenFor(owner, store._id);
  return { owner, store, token };
}

function cashierToken(storeId) {
  return jwt.sign(
    { cashierId: 'c1', storeId, role: 'cashier', username: 'desk' },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );
}

// ── Access control ────────────────────────────────────────────────────────────

describe('Campaigns access control', () => {
  it('GET /api/campaigns requires auth', async () => {
    const res = await request(app).get('/api/campaigns');
    expect(res.status).toBe(401);
  });

  it('cashier is blocked from GET /api/campaigns', async () => {
    const { store } = await setup();
    const res = await request(app)
      .get('/api/campaigns')
      .set(authHeader(cashierToken(store._id)));
    expect(res.status).toBe(403);
  });

  it('cashier is blocked from POST /api/campaigns/send', async () => {
    const { store } = await setup();
    const res = await request(app)
      .post('/api/campaigns/send')
      .set(authHeader(cashierToken(store._id)))
      .send({ subject: 'Hi', body: '<p>Hello</p>', filters: {} });
    expect(res.status).toBe(403);
  });

  it('cashier is blocked from GET /api/campaigns/templates', async () => {
    const { store } = await setup();
    const res = await request(app)
      .get('/api/campaigns/templates')
      .set(authHeader(cashierToken(store._id)));
    expect(res.status).toBe(403);
  });

  it('store_owner can access GET /api/campaigns', async () => {
    const { token } = await setup();
    const res = await request(app).get('/api/campaigns').set(authHeader(token));
    expect(res.status).toBe(200);
  });
});

// ── POST /api/campaigns/preview-count ────────────────────────────────────────

describe('POST /api/campaigns/preview-count', () => {
  it('counts members with and without email', async () => {
    const { store, token } = await setup();
    const mt = await createMembershipType(store._id);
    await createMember(store._id, mt._id, { email: 'a@test.com', status: 'active' });
    await createMember(store._id, mt._id, { email: 'b@test.com', status: 'active' });
    await createMember(store._id, mt._id, { email: '',           status: 'active' }); // no email

    const res = await request(app)
      .post('/api/campaigns/preview-count')
      .set(authHeader(token))
      .send({ filters: { status: 'all' } });

    expect(res.status).toBe(200);
    expect(res.body.willReceive).toBe(2);
    expect(res.body.skippedNoEmail).toBe(1);
    expect(res.body.skippedOptOut).toBe(0);
  });

  it('excludes opted-out members from willReceive', async () => {
    const { store, token } = await setup();
    const mt = await createMembershipType(store._id);
    await createMember(store._id, mt._id, { email: 'a@test.com', emailOptOut: false });
    await createMember(store._id, mt._id, { email: 'b@test.com', emailOptOut: true });

    const res = await request(app)
      .post('/api/campaigns/preview-count')
      .set(authHeader(token))
      .send({ filters: { status: 'all' } });

    expect(res.status).toBe(200);
    expect(res.body.willReceive).toBe(1);
    expect(res.body.skippedOptOut).toBe(1);
  });

  it('filters by status correctly', async () => {
    const { store, token } = await setup();
    const mt = await createMembershipType(store._id);
    await createMember(store._id, mt._id, { email: 'a@test.com', status: 'active' });
    await createMember(store._id, mt._id, { email: 'b@test.com', status: 'overdue' });

    const res = await request(app)
      .post('/api/campaigns/preview-count')
      .set(authHeader(token))
      .send({ filters: { status: 'overdue' } });

    expect(res.status).toBe(200);
    expect(res.body.willReceive).toBe(1);
    expect(res.body.total).toBe(1);
  });

  it('excludes pass holders from count (default filter)', async () => {
    const { store, token } = await setup();
    const mt   = await createMembershipType(store._id, { isPass: false });
    const pass = await createMembershipType(store._id, { isPass: true });
    await createMember(store._id, mt._id,   { email: 'a@test.com', isPass: false });
    await createMember(store._id, pass._id, { email: 'b@test.com', isPass: true  });

    const res = await request(app)
      .post('/api/campaigns/preview-count')
      .set(authHeader(token))
      .send({ filters: { status: 'all' } });

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1); // passes excluded by default
  });
});

// ── POST /api/campaigns/send ──────────────────────────────────────────────────

describe('POST /api/campaigns/send', () => {
  it('sends to eligible members and saves a CampaignLog', async () => {
    const { store, token } = await setup();
    const mt = await createMembershipType(store._id);
    await createMember(store._id, mt._id, { name: 'Alice', email: 'alice@test.com' });
    await createMember(store._id, mt._id, { name: 'Bob',   email: 'bob@test.com'   });

    const res = await request(app)
      .post('/api/campaigns/send')
      .set(authHeader(token))
      .send({ subject: 'Hello members', body: '<p>Hi {{name}}</p>', filters: {} });

    expect(res.status).toBe(200);
    expect(res.body.log.sentCount).toBe(2);
    expect(res.body.log.skippedNoEmail).toBe(0);
    expect(res.body.log.subject).toBe('Hello members');

    // Verify CampaignLog persisted
    const log = await CampaignLog.findById(res.body.log._id);
    expect(log).not.toBeNull();
    expect(log.sentCount).toBe(2);
  });

  it('skips members with no email address', async () => {
    const { store, token } = await setup();
    const mt = await createMembershipType(store._id);
    await createMember(store._id, mt._id, { email: 'a@test.com' });
    await createMember(store._id, mt._id, { email: '' });

    const res = await request(app)
      .post('/api/campaigns/send')
      .set(authHeader(token))
      .send({ subject: 'Hi', body: '<p>Test</p>', filters: {} });

    expect(res.status).toBe(200);
    expect(res.body.log.sentCount).toBe(1);
    expect(res.body.log.skippedNoEmail).toBe(1);
  });

  it('skips opted-out members', async () => {
    const { store, token } = await setup();
    const mt = await createMembershipType(store._id);
    await createMember(store._id, mt._id, { email: 'a@test.com', emailOptOut: false });
    await createMember(store._id, mt._id, { email: 'b@test.com', emailOptOut: true  });

    const res = await request(app)
      .post('/api/campaigns/send')
      .set(authHeader(token))
      .send({ subject: 'Hi', body: '<p>Test</p>', filters: {} });

    expect(res.status).toBe(200);
    expect(res.body.log.sentCount).toBe(1);
    expect(res.body.log.skippedOptOut).toBe(1);
  });

  it('calls sendCampaignEmail once per eligible member', async () => {
    const { store, token } = await setup();
    const mt = await createMembershipType(store._id);
    await createMember(store._id, mt._id, { email: 'a@test.com' });
    await createMember(store._id, mt._id, { email: 'b@test.com' });
    await createMember(store._id, mt._id, { email: '' }); // skipped

    await request(app)
      .post('/api/campaigns/send')
      .set(authHeader(token))
      .send({ subject: 'Hi', body: '<p>Test</p>', filters: {} });

    expect(mailer.sendCampaignEmail).toHaveBeenCalledTimes(2);
  });

  it('returns 400 when subject is missing', async () => {
    const { token } = await setup();
    const res = await request(app)
      .post('/api/campaigns/send')
      .set(authHeader(token))
      .send({ body: '<p>Hi</p>', filters: {} });
    expect(res.status).toBe(400);
  });

  it('returns 400 when body is missing', async () => {
    const { token } = await setup();
    const res = await request(app)
      .post('/api/campaigns/send')
      .set(authHeader(token))
      .send({ subject: 'Hi', filters: {} });
    expect(res.status).toBe(400);
  });

  it('returns 503 when SMTP is not configured', async () => {
    mailer.isConfigured.mockReturnValueOnce(false);
    const { token } = await setup();
    const res = await request(app)
      .post('/api/campaigns/send')
      .set(authHeader(token))
      .send({ subject: 'Hi', body: '<p>Hi</p>', filters: {} });
    expect(res.status).toBe(503);
  });
});

// ── Token interpolation ───────────────────────────────────────────────────────

describe('Token interpolation in campaign send', () => {
  it('interpolates {{name}}, {{membership}}, {{storeName}} in subject and body', async () => {
    const { store, token } = await setup();
    const mt = await createMembershipType(store._id, { name: 'Gold Plan' });
    await createMember(store._id, mt._id, { name: 'Alice', email: 'alice@test.com' });

    await request(app)
      .post('/api/campaigns/send')
      .set(authHeader(token))
      .send({
        subject: 'Hi {{name}}, your plan is {{membership}} at {{storeName}}',
        body:    '<p>Hello {{name}}</p>',
        filters: {},
      });

    expect(mailer.sendCampaignEmail).toHaveBeenCalledTimes(1);
    const [, , sentSubject, sentBody] = mailer.sendCampaignEmail.mock.calls[0];
    expect(sentSubject).toBe('Hi Alice, your plan is Gold Plan at Test Gym');
    expect(sentBody).toContain('Hello Alice');
    expect(sentBody).not.toContain('{{name}}');
  });

  it('generates and saves an unsubscribeToken on first send', async () => {
    const { store, token } = await setup();
    const mt = await createMembershipType(store._id);
    const member = await createMember(store._id, mt._id, { email: 'a@test.com' });
    expect(member.unsubscribeToken).toBe('');

    await request(app)
      .post('/api/campaigns/send')
      .set(authHeader(token))
      .send({ subject: 'Hi', body: '<p>Hi</p>', filters: {} });

    const updated = await Member.findById(member._id);
    expect(updated.unsubscribeToken).toBeTruthy();
  });
});

// ── GET /api/members/unsubscribe ──────────────────────────────────────────────

describe('GET /api/members/unsubscribe', () => {
  it('sets emailOptOut = true and returns HTML confirmation', async () => {
    const { store } = await setup();
    const mt = await createMembershipType(store._id);
    const member = await createMember(store._id, mt._id, { email: 'a@test.com' });

    const unsubToken = jwt.sign(
      { memberId: String(member._id), storeId: String(store._id), purpose: 'unsub' },
      process.env.JWT_SECRET,
      { expiresIn: '10y' }
    );

    const res = await request(app)
      .get(`/api/members/unsubscribe?token=${unsubToken}`);

    expect(res.status).toBe(200);
    expect(res.text).toContain('unsubscribed');

    const updated = await Member.findById(member._id);
    expect(updated.emailOptOut).toBe(true);
  });

  it('rejects a token with wrong purpose', async () => {
    const badToken = jwt.sign(
      { memberId: 'someid', storeId: 'storeid', purpose: 'auth' },
      process.env.JWT_SECRET
    );
    const res = await request(app)
      .get(`/api/members/unsubscribe?token=${badToken}`);
    expect(res.status).toBe(400);
  });

  it('rejects a tampered / invalid token', async () => {
    const res = await request(app)
      .get('/api/members/unsubscribe?token=not-a-valid-jwt');
    expect(res.status).toBe(400);
  });

  it('returns 400 when token query param is missing', async () => {
    const res = await request(app).get('/api/members/unsubscribe');
    expect(res.status).toBe(400);
  });
});

// ── Templates CRUD ────────────────────────────────────────────────────────────

describe('Email Templates CRUD', () => {
  it('POST /api/campaigns/templates creates a template', async () => {
    const { store, token } = await setup();

    const res = await request(app)
      .post('/api/campaigns/templates')
      .set(authHeader(token))
      .send({ name: 'Promo', subject: 'Big Sale', body: '<p>Sale!</p>' });

    expect(res.status).toBe(201);
    expect(res.body.name).toBe('Promo');
    expect(res.body.storeId).toBe(String(store._id));
  });

  it('POST /api/campaigns/templates requires a name', async () => {
    const { token } = await setup();
    const res = await request(app)
      .post('/api/campaigns/templates')
      .set(authHeader(token))
      .send({ subject: 'Hi', body: '<p>Hi</p>' });
    expect(res.status).toBe(400);
  });

  it('GET /api/campaigns/templates lists only own store templates', async () => {
    const { store, token } = await setup();
    // A second store's template
    const owner2 = await createUser({ username: 'owner2' });
    const store2 = await createStore(owner2._id);
    await EmailTemplate.create({ storeId: store2._id, name: 'Other', subject: 'x', body: 'x', createdBy: 'owner2' });

    await request(app)
      .post('/api/campaigns/templates')
      .set(authHeader(token))
      .send({ name: 'My Tpl', subject: 'Hello', body: '<p>Hi</p>' });

    const res = await request(app).get('/api/campaigns/templates').set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].name).toBe('My Tpl');
  });

  it('PUT /api/campaigns/templates/:id updates template', async () => {
    const { store, token } = await setup();
    const tpl = await EmailTemplate.create({
      storeId: store._id, name: 'Old Name', subject: 'Old', body: 'Old body', createdBy: 'owner',
    });

    const res = await request(app)
      .put(`/api/campaigns/templates/${tpl._id}`)
      .set(authHeader(token))
      .send({ name: 'New Name', subject: 'New Subject', body: '<p>New body</p>' });

    expect(res.status).toBe(200);
    expect(res.body.name).toBe('New Name');
  });

  it('DELETE /api/campaigns/templates/:id removes template', async () => {
    const { store, token } = await setup();
    const tpl = await EmailTemplate.create({
      storeId: store._id, name: 'Bye', subject: 'x', body: 'x', createdBy: 'owner',
    });

    const del = await request(app)
      .delete(`/api/campaigns/templates/${tpl._id}`)
      .set(authHeader(token));
    expect(del.status).toBe(200);

    const check = await EmailTemplate.findById(tpl._id);
    expect(check).toBeNull();
  });

  it('cannot delete another store\'s template', async () => {
    const { token } = await setup();
    const owner2 = await createUser({ username: 'owner2' });
    const store2 = await createStore(owner2._id);
    const tpl = await EmailTemplate.create({
      storeId: store2._id, name: 'Theirs', subject: 'x', body: 'x', createdBy: 'owner2',
    });

    const res = await request(app)
      .delete(`/api/campaigns/templates/${tpl._id}`)
      .set(authHeader(token));
    expect(res.status).toBe(200); // endpoint doesn't 404 but the doc is not deleted
    const check = await EmailTemplate.findById(tpl._id);
    expect(check).not.toBeNull(); // still exists
  });
});

// ── Campaign history ──────────────────────────────────────────────────────────

describe('GET /api/campaigns', () => {
  it('returns campaign history in reverse-chronological order', async () => {
    const { store, token } = await setup();
    await CampaignLog.create({ storeId: store._id, subject: 'First',  sentAt: new Date('2025-01-01'), sentBy: 'owner' });
    await CampaignLog.create({ storeId: store._id, subject: 'Second', sentAt: new Date('2025-06-01'), sentBy: 'owner' });

    const res = await request(app).get('/api/campaigns').set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.logs[0].subject).toBe('Second');
    expect(res.body.logs[1].subject).toBe('First');
  });

  it('only returns logs from own store', async () => {
    const { store, token } = await setup();
    const owner2 = await createUser({ username: 'owner2' });
    const store2 = await createStore(owner2._id);
    await CampaignLog.create({ storeId: store2._id,  subject: 'Theirs', sentAt: new Date(), sentBy: 'owner2' });
    await CampaignLog.create({ storeId: store._id,   subject: 'Mine',   sentAt: new Date(), sentBy: 'owner'  });

    const res = await request(app).get('/api/campaigns').set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.logs).toHaveLength(1);
    expect(res.body.logs[0].subject).toBe('Mine');
  });
});
