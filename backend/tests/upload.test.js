process.env.JWT_SECRET          = 'test-secret';
process.env.SUPERADMIN_USERNAME = 'superadmin';
process.env.PUBLIC_URL          = 'http://localhost:3001';

const path    = require('path');
const fs      = require('fs');
const request = require('supertest');
const app     = require('../server');
const db      = require('./helpers/db');
const { createUser, createStore, tokenFor, authHeader } = require('./helpers/factories');

beforeAll(() => db.connect());
afterEach(() => db.clearAll());
afterAll(async () => {
  await db.disconnect();
  // Clean up any files written during tests
  const uploadsDir = path.join(__dirname, '../uploads');
  if (fs.existsSync(uploadsDir)) {
    for (const f of fs.readdirSync(uploadsDir)) {
      if (f !== '.keep') fs.unlinkSync(path.join(uploadsDir, f));
    }
  }
});

// Minimal 1×1 pixel PNG in a Buffer (no external fixture files needed)
function tiny1x1Png() {
  return Buffer.from(
    '89504e470d0a1a0a0000000d4948445200000001000000010802000000' +
    '9001002e00000000c4944415478016360f8cfc000000002000157' +
    '3e55920000000049454e44ae426082',
    'hex'
  );
}

describe('POST /api/upload', () => {
  it('uploads an image and returns an absolute URL', async () => {
    const owner = await createUser({ username: 'owner' });
    const store = await createStore(owner._id);
    const token = tokenFor(owner, store._id);

    const res = await request(app)
      .post('/api/upload')
      .set(authHeader(token))
      .attach('image', tiny1x1Png(), { filename: 'test.png', contentType: 'image/png' });

    expect(res.status).toBe(200);
    expect(res.body.url).toMatch(/^http:\/\/localhost:3001\/uploads\/.+\.png$/);
  });

  it('rejects requests with no file', async () => {
    const owner = await createUser({ username: 'owner' });
    const store = await createStore(owner._id);
    const token = tokenFor(owner, store._id);

    const res = await request(app)
      .post('/api/upload')
      .set(authHeader(token));

    expect(res.status).toBe(400);
  });

  it('rejects non-image files', async () => {
    const owner = await createUser({ username: 'owner' });
    const store = await createStore(owner._id);
    const token = tokenFor(owner, store._id);

    const res = await request(app)
      .post('/api/upload')
      .set(authHeader(token))
      .attach('image', Buffer.from('not an image'), { filename: 'hack.txt', contentType: 'text/plain' });

    expect(res.status).toBe(400);
  });

  it('blocks unauthenticated requests', async () => {
    const res = await request(app)
      .post('/api/upload')
      .attach('image', tiny1x1Png(), { filename: 'test.png', contentType: 'image/png' });

    expect(res.status).toBe(401);
  });

  it('blocks cashier role from uploading', async () => {
    const jwt   = require('jsonwebtoken');
    const owner = await createUser({ username: 'owner' });
    const store = await createStore(owner._id);
    const cashierToken = jwt.sign(
      { cashierId: 'abc', storeId: store._id, role: 'cashier', username: 'bob' },
      process.env.JWT_SECRET, { expiresIn: '1h' }
    );

    const res = await request(app)
      .post('/api/upload')
      .set(authHeader(cashierToken))
      .attach('image', tiny1x1Png(), { filename: 'test.png', contentType: 'image/png' });

    expect(res.status).toBe(403);
  });
});
