require('dotenv').config();
const express   = require('express');
const mongoose  = require('mongoose');
const cors      = require('cors');
const path      = require('path');
const rateLimit = require('express-rate-limit');

const app = express();

app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
app.use(express.json({ limit: '5mb' }));

// Brute-force protection on auth endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts, please try again later.' },
  skip: () => process.env.NODE_ENV === 'test',
});

// Serve uploaded images
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// hotel-widget.html must be embeddable in iframes from any origin.
// This route runs before express.static so we control the response headers
// regardless of what X-Frame-Options the reverse proxy normally injects.
app.get('/hotel-widget.html', (req, res) => {
  res.removeHeader('X-Frame-Options');
  res.removeHeader('Content-Security-Policy');
  res.sendFile(path.join(__dirname, '..', 'hotel-widget.html'));
});

// Serve frontend static files from the parent directory
app.use(express.static(path.join(__dirname, '..'), { index: 'login.html' }));

// Routes
app.use('/api/auth', authLimiter, require('./routes/auth'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/store', require('./routes/store'));
app.use('/api/cashiers', require('./routes/cashiers'));
app.use('/api/members', require('./routes/members'));
app.use('/api/membership-types', require('./routes/membershipTypes'));
app.use('/api/sales',     require('./routes/sales'));
app.use('/api/upload',    require('./routes/upload'));
app.use('/api/reminders', require('./routes/reminders'));
app.use('/api/reports',   require('./routes/reports'));
app.use('/api/campaigns', require('./routes/campaigns'));
app.use('/api/kitchen',      require('./routes/kitchen'));
app.use('/api/subscription',         require('./routes/subscriptions'));
app.use('/api/admin/subscriptions',  require('./routes/adminSubscriptions'));
app.use('/api/pricing',        require('./routes/pricing'));
app.use('/api/discount-codes', require('./routes/discountCodes'));
app.use('/api/bookings',      require('./routes/bookings'));
app.use('/api/hotel',         require('./routes/hotel'));

app.get('/api/health', (req, res) => res.json({ status: 'ok', ts: new Date() }));

// Export app for testing — only start the server when run directly
if (require.main === module) {
  mongoose
    .connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/poshive')
    .then(() => {
      const port = process.env.PORT || 3001;
      app.listen(port, () => console.log(`POSHIVE backend running on port ${port}`));
      require('./services/reminderJob').startReminderJob();
      require('./services/backupJob').startBackupJob();
      require('./services/billingJob').startBillingJob();
    })
    .catch((err) => {
      console.error('MongoDB connection error:', err.message);
      process.exit(1);
    });
}

module.exports = app;
