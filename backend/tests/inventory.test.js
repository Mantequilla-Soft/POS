process.env.JWT_SECRET = 'test-secret';

const request = require('supertest');
const app     = require('../server');
const db      = require('./helpers/db');
const { createUser, createStore, tokenFor, authHeader } = require('./helpers/factories');

beforeAll(() => db.connect());
afterEach(() => db.clearAll());
afterAll(() => db.disconnect());

async function setup({ inventoryEnabled = true } = {}) {
  const owner = await createUser({ username: 'owner' });
  const store = await createStore(owner._id, { features: { inventory: inventoryEnabled } });
  const token = tokenFor(owner, store._id);
  return { owner, store, token };
}

async function createItem(token, overrides = {}) {
  return request(app)
    .post('/api/inventory/items')
    .set(authHeader(token))
    .send({ name: 'Coffee Beans', unit: 'kg', ...overrides });
}

async function createMovement(token, itemId, overrides = {}) {
  return request(app)
    .post('/api/inventory/movements')
    .set(authHeader(token))
    .send({ itemId, type: 'purchase', qty: 10, unitCost: 5, ...overrides });
}

// ── Feature gate ─────────────────────────────────────────────────────────────

describe('feature gate', () => {
  it('returns 403 when inventory feature is disabled', async () => {
    const { token } = await setup({ inventoryEnabled: false });
    const res = await request(app).get('/api/inventory/items').set(authHeader(token));
    expect(res.status).toBe(403);
  });

  it('returns 401 for unauthenticated requests', async () => {
    const res = await request(app).get('/api/inventory/items');
    expect(res.status).toBe(401);
  });
});

// ── Items ─────────────────────────────────────────────────────────────────────

describe('POST /api/inventory/items', () => {
  it('creates an item with defaults', async () => {
    const { token } = await setup();
    const res = await createItem(token);
    expect(res.status).toBe(201);
    expect(res.body.name).toBe('Coffee Beans');
    expect(res.body.unit).toBe('kg');
    expect(res.body.active).toBe(true);
    expect(res.body.reorderPoint).toBe(0);
  });

  it('rejects missing name', async () => {
    const { token } = await setup();
    const res = await request(app)
      .post('/api/inventory/items')
      .set(authHeader(token))
      .send({ unit: 'kg' });
    expect(res.status).toBe(400);
  });

  it('rejects blank name', async () => {
    const { token } = await setup();
    const res = await createItem(token, { name: '   ' });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/inventory/items', () => {
  it('lists only active items', async () => {
    const { token } = await setup();
    await createItem(token, { name: 'Milk' });
    await createItem(token, { name: 'Sugar' });
    const res = await request(app).get('/api/inventory/items').set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
  });

  it('does not include deactivated items', async () => {
    const { token } = await setup();
    const created = await createItem(token, { name: 'Old Stock' });
    await request(app)
      .delete(`/api/inventory/items/${created.body._id}`)
      .set(authHeader(token));
    const res = await request(app).get('/api/inventory/items').set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(0);
  });
});

describe('PUT /api/inventory/items/:id', () => {
  it('updates item fields', async () => {
    const { token } = await setup();
    const item = await createItem(token);
    const res = await request(app)
      .put(`/api/inventory/items/${item.body._id}`)
      .set(authHeader(token))
      .send({ name: 'Arabica Beans', reorderPoint: 5 });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Arabica Beans');
    expect(res.body.reorderPoint).toBe(5);
  });

  it('returns 404 for unknown item', async () => {
    const { token } = await setup();
    const fakeId = new (require('mongoose').Types.ObjectId)();
    const res = await request(app)
      .put(`/api/inventory/items/${fakeId}`)
      .set(authHeader(token))
      .send({ name: 'X' });
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/inventory/items/:id', () => {
  it('soft-deletes an item', async () => {
    const { token } = await setup();
    const item = await createItem(token);
    const del = await request(app)
      .delete(`/api/inventory/items/${item.body._id}`)
      .set(authHeader(token));
    expect(del.status).toBe(200);
    expect(del.body.ok).toBe(true);
    // Confirm item is gone from the list
    const list = await request(app).get('/api/inventory/items').set(authHeader(token));
    expect(list.body).toHaveLength(0);
  });
});

// ── Stock movements ───────────────────────────────────────────────────────────

describe('POST /api/inventory/movements', () => {
  it('logs a purchase', async () => {
    const { token } = await setup();
    const item = await createItem(token);
    const res = await createMovement(token, item.body._id);
    expect(res.status).toBe(201);
    expect(res.body.qty).toBe(10);
    expect(res.body.type).toBe('purchase');
    expect(res.body.unitCost).toBe(5);
  });

  it('logs a negative adjustment (waste/loss)', async () => {
    const { token } = await setup();
    const item = await createItem(token);
    const res = await createMovement(token, item.body._id, { type: 'adjustment', qty: -3 });
    expect(res.status).toBe(201);
    expect(res.body.qty).toBe(-3);
  });

  it('rejects invalid type', async () => {
    const { token } = await setup();
    const item = await createItem(token);
    const res = await createMovement(token, item.body._id, { type: 'consumption' });
    expect(res.status).toBe(400);
  });

  it('returns 400 when qty is missing', async () => {
    const { token } = await setup();
    const item = await createItem(token);
    const res = await request(app)
      .post('/api/inventory/movements')
      .set(authHeader(token))
      .send({ itemId: item.body._id, type: 'purchase' });
    expect(res.status).toBe(400);
  });

  it('returns 404 for unknown itemId', async () => {
    const { token } = await setup();
    const fakeId = new (require('mongoose').Types.ObjectId)();
    const res = await createMovement(token, fakeId);
    expect(res.status).toBe(404);
  });

  it('returns 404 for deactivated item', async () => {
    const { token } = await setup();
    const item = await createItem(token);
    await request(app).delete(`/api/inventory/items/${item.body._id}`).set(authHeader(token));
    const res = await createMovement(token, item.body._id);
    expect(res.status).toBe(404);
  });
});

describe('GET /api/inventory/movements', () => {
  it('returns movement log', async () => {
    const { token } = await setup();
    const item = await createItem(token);
    await createMovement(token, item.body._id);
    await createMovement(token, item.body._id, { type: 'adjustment', qty: -2 });
    const res = await request(app).get('/api/inventory/movements').set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
  });
});

// ── Stock levels ──────────────────────────────────────────────────────────────

describe('GET /api/inventory/levels', () => {
  it('computes running total correctly', async () => {
    const { token } = await setup();
    const item = await createItem(token, { name: 'Flour', reorderPoint: 5 });
    await createMovement(token, item.body._id, { type: 'opening', qty: 20 });
    await createMovement(token, item.body._id, { type: 'purchase', qty: 10 });
    await createMovement(token, item.body._id, { type: 'adjustment', qty: -4 });

    const res = await request(app).get('/api/inventory/levels').set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].currentQty).toBe(26);   // 20 + 10 - 4
    expect(res.body[0].lowStock).toBe(false);   // 26 > reorderPoint 5
  });

  it('flags low stock when at or below reorder point', async () => {
    const { token } = await setup();
    const item = await createItem(token, { name: 'Salt', reorderPoint: 10 });
    await createMovement(token, item.body._id, { type: 'opening', qty: 8 });

    const res = await request(app).get('/api/inventory/levels').set(authHeader(token));
    expect(res.body[0].currentQty).toBe(8);
    expect(res.body[0].lowStock).toBe(true);   // 8 <= reorderPoint 10
  });

  it('returns zero qty for items with no movements', async () => {
    const { token } = await setup();
    await createItem(token, { name: 'New Item' });
    const res = await request(app).get('/api/inventory/levels').set(authHeader(token));
    expect(res.body[0].currentQty).toBe(0);
  });
});

// ── Stock counts (reconciliation) ─────────────────────────────────────────────

describe('POST /api/inventory/counts', () => {
  it('saves a draft count', async () => {
    const { token } = await setup();
    const item = await createItem(token);
    const res = await request(app)
      .post('/api/inventory/counts')
      .set(authHeader(token))
      .send({
        periodStart: '2026-06-01',
        periodEnd:   '2026-06-07',
        lines: [{ itemId: item.body._id, itemName: 'Coffee Beans', unit: 'kg', expectedQty: 10, actualQty: 8 }],
      });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('draft');
    expect(res.body.lines[0].variance).toBe(-2);   // 8 - 10
  });

  it('rejects missing period dates', async () => {
    const { token } = await setup();
    const res = await request(app)
      .post('/api/inventory/counts')
      .set(authHeader(token))
      .send({ lines: [] });
    expect(res.status).toBe(400);
  });
});

describe('PATCH /api/inventory/counts/:id/complete', () => {
  it('locks a draft count', async () => {
    const { token } = await setup();
    const draft = await request(app)
      .post('/api/inventory/counts')
      .set(authHeader(token))
      .send({ periodStart: '2026-06-01', periodEnd: '2026-06-07', lines: [] });
    const res = await request(app)
      .patch(`/api/inventory/counts/${draft.body._id}/complete`)
      .set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('completed');
    expect(res.body.completedAt).toBeTruthy();
  });

  it('cannot complete an already-completed count', async () => {
    const { token } = await setup();
    const draft = await request(app)
      .post('/api/inventory/counts')
      .set(authHeader(token))
      .send({ periodStart: '2026-06-01', periodEnd: '2026-06-07', lines: [] });
    await request(app)
      .patch(`/api/inventory/counts/${draft.body._id}/complete`)
      .set(authHeader(token));
    // Second complete attempt hits the draft filter — not found
    const res = await request(app)
      .patch(`/api/inventory/counts/${draft.body._id}/complete`)
      .set(authHeader(token));
    expect(res.status).toBe(404);
  });
});

describe('GET /api/inventory/counts', () => {
  it('lists reconciliation history', async () => {
    const { token } = await setup();
    await request(app)
      .post('/api/inventory/counts')
      .set(authHeader(token))
      .send({ periodStart: '2026-05-01', periodEnd: '2026-05-31', lines: [] });
    await request(app)
      .post('/api/inventory/counts')
      .set(authHeader(token))
      .send({ periodStart: '2026-06-01', periodEnd: '2026-06-07', lines: [] });
    const res = await request(app).get('/api/inventory/counts').set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
  });
});
