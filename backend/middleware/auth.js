const jwt = require('jsonwebtoken');

function authenticate(req, res, next) {
  const header = req.headers.authorization;
  // Allow token via query param for file-download endpoints
  const raw = (header?.startsWith('Bearer ') ? header.slice(7) : null) || req.query.token;
  if (!raw) return res.status(401).json({ error: 'Missing token' });
  try {
    req.user = jwt.verify(raw, process.env.JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function requireRole(...roles) {
  return [
    authenticate,
    (req, res, next) => {
      if (!roles.includes(req.user.role)) {
        return res.status(403).json({ error: 'Forbidden' });
      }
      next();
    },
  ];
}

// Use after `authenticate` (or any router that already authenticates)
// — gates a single route without re-running authentication.
function roleOnly(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    next();
  };
}

// Blocks suspended stores from mutating operations.
// Must be used after authenticate (or requireRole).
// Skipped entirely when BILLING_ENABLED=false.
async function requireActiveSubscription(req, res, next) {
  if (process.env.BILLING_ENABLED === 'false') return next();
  if (!req.user?.storeId) return next(); // superadmin, no store
  try {
    const Subscription = require('../models/Subscription');
    const sub = await Subscription.findOne({ storeId: req.user.storeId });
    if (sub?.status === 'suspended') {
      return res.status(403).json({ error: 'Store subscription is suspended. Please contact support.' });
    }
    next();
  } catch (err) {
    next(); // fail open — don't block on billing errors
  }
}

module.exports = { authenticate, requireRole, roleOnly, requireActiveSubscription };
