process.env.JWT_SECRET = 'test-secret';
process.env.SUPERADMIN_USERNAME = 'superadmin';

const request = require('supertest');
const app = require('../server');
const db = require('./helpers/db');
const { createUser } = require('./helpers/factories');

beforeAll(() => db.connect());
afterEach(() => db.clearAll());
afterAll(() => db.disconnect());

describe('POST /api/auth/register', () => {
  it('creates an account with approved=false', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ username: 'newowner', password: 'password123' });

    expect(res.status).toBe(201);
    expect(res.body.message).toMatch(/awaiting/i);
  });

  it('rejects duplicate username', async () => {
    await createUser({ username: 'taken' });
    const res = await request(app)
      .post('/api/auth/register')
      .send({ username: 'taken', password: 'password123' });

    expect(res.status).toBe(409);
  });

  it('requires username and password', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ username: 'nopass' });

    expect(res.status).toBe(400);
  });
});

describe('POST /api/auth/login', () => {
  it('blocks login when account is pending approval', async () => {
    await createUser({ username: 'pending', approved: false });

    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'pending', password: 'password123' });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/approval/i);
  });

  it('returns a JWT when approved', async () => {
    await createUser({ username: 'approved', approved: true });

    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'approved', password: 'password123' });

    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();
    expect(res.body.user.username).toBe('approved');
  });

  it('rejects wrong password', async () => {
    await createUser({ username: 'owner' });

    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'owner', password: 'wrongpassword' });

    expect(res.status).toBe(401);
  });

  it('auto-promotes SUPERADMIN_USERNAME to superadmin on first login', async () => {
    await createUser({ username: 'superadmin', role: 'store_owner', approved: false });

    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'superadmin', password: 'password123' });

    expect(res.status).toBe(200);
    expect(res.body.user.role).toBe('superadmin');
  });
});
