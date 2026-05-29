const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../../models/User');
const Store = require('../../models/Store');
const MembershipType = require('../../models/MembershipType');
const Member = require('../../models/Member');
const Sale = require('../../models/Sale');
const MemberPayment = require('../../models/MemberPayment');

const JWT_SECRET = process.env.JWT_SECRET;

async function createUser({ username = 'testowner', password = 'password123', role = 'store_owner', approved = true } = {}) {
  const hash = await bcrypt.hash(password, 1); // low rounds for speed in tests
  return User.create({ username, password: hash, role, approved });
}

async function createStore(ownerId, overrides = {}) {
  return Store.create({
    ownerId,
    businessName: 'Test Gym',
    hiveAccount: 'testgym',
    categories: ['fitness', 'nutrition'],
    features: { memberships: true, bitcoinLightning: false },
    published: true,
    items: [],
    ...overrides,
  });
}

async function createMembershipType(storeId, overrides = {}) {
  return MembershipType.create({
    storeId,
    name: 'Monthly',
    price: 50,
    currency: 'HBD',
    durationDays: 30,
    active: true,
    ...overrides,
  });
}

async function createMember(storeId, membershipTypeId, overrides = {}) {
  const startDate = new Date();
  const nextDueDate = new Date();
  nextDueDate.setDate(nextDueDate.getDate() + 30);
  return Member.create({
    storeId,
    name: 'Jane Doe',
    membershipTypeId,
    startDate,
    nextDueDate,
    status: 'active',
    ...overrides,
  });
}

function tokenFor(user, storeId = null) {
  return jwt.sign(
    { userId: user._id, role: user.role, storeId },
    JWT_SECRET,
    { expiresIn: '1h' }
  );
}

function authHeader(token) {
  return { Authorization: `Bearer ${token}` };
}

async function createSale(storeId, overrides = {}) {
  return Sale.create({
    storeId,
    items: [{ id: 'i1', name: 'Protein Bar', category: 'nutrition', price: 5, qty: 1 }],
    total: 5,
    subtotal: 5,
    taxAmount: 0,
    currency: 'HBD',
    paymentMethod: 'cash',
    cashier: 'testcashier',
    ...overrides,
  });
}

async function createMemberPayment(storeId, memberId, membershipTypeId, overrides = {}) {
  const now = new Date();
  return MemberPayment.create({
    storeId,
    memberId,
    membershipTypeId,
    amount: 50,
    currency: 'HBD',
    method: 'cash',
    paidDate: now,
    periodStart: now,
    periodEnd: new Date(now.getTime() + 30 * 86400000),
    ...overrides,
  });
}

module.exports = {
  createUser, createStore, createMembershipType, createMember,
  createSale, createMemberPayment,
  tokenFor, authHeader,
};
