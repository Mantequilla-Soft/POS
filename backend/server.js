require('dotenv').config();
const express   = require('express');
const mongoose  = require('mongoose');
const cors      = require('cors');
const path      = require('path');
const fs        = require('fs');
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

// Shareable availability page — /availability/:hiveAccount
// Reads hotel-widget.html and injects server-rendered Open Graph meta tags
// so Facebook, WhatsApp, Twitter etc. generate proper link preview cards.
app.get('/availability/:hiveAccount', async (req, res) => {
  try {
    const Store = require('./models/Store');
    const { hiveAccount } = req.params;
    const esc = s => String(s ?? '').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

    const store = await Store.findOne({ hiveAccount });
    if (!store || !store.features?.hotel) {
      return res.status(404).send('<h1>Not found</h1>');
    }

    const rooms       = (store.rooms || []).filter(r => r.active !== false);
    const bizName     = store.businessName || hiveAccount;
    const title       = `${esc(bizName)} — Room Availability`;
    const description = rooms.length
      ? `${rooms.length} room${rooms.length !== 1 ? 's' : ''} for rent. Check availability and contact us to book.`
      : `Check room availability at ${esc(bizName)}.`;
    const pageUrl     = `${req.protocol}://${req.hostname}/availability/${hiveAccount}`;
    const image       = store.bannerUrl || '';

    const ogTags = [
      `  <title>${title}</title>`,
      `  <meta name="description" content="${esc(description)}">`,
      `  <meta property="og:title"       content="${esc(title)}">`,
      `  <meta property="og:description" content="${esc(description)}">`,
      `  <meta property="og:type"        content="website">`,
      `  <meta property="og:url"         content="${esc(pageUrl)}">`,
      image ? `  <meta property="og:image"       content="${esc(image)}">` : '',
      `  <meta name="twitter:card"        content="${image ? 'summary_large_image' : 'summary'}">`,
      `  <meta name="twitter:title"       content="${esc(title)}">`,
      `  <meta name="twitter:description" content="${esc(description)}">`,
      image ? `  <meta name="twitter:image"       content="${esc(image)}">` : '',
    ].filter(Boolean).join('\n');

    let html = fs.readFileSync(path.join(__dirname, '..', 'hotel-widget.html'), 'utf8');
    // Inject OG tags before </head>
    html = html.replace('</head>', ogTags + '\n</head>');
    // Pre-fill the store param so no ?store= query string is needed
    html = html.replace(
      "const STORE  = params.get('store') || '';",
      `const STORE  = params.get('store') || '${hiveAccount.replace(/'/g, "\\'")}';`
    );

    res.removeHeader('X-Frame-Options');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (err) {
    res.status(500).send('<h1>Server error</h1>');
  }
});

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
