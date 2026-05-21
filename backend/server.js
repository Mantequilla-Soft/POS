require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

const app = express();

app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
app.use(express.json({ limit: '5mb' }));

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/store', require('./routes/store'));
app.use('/api/cashiers', require('./routes/cashiers'));
app.use('/api/members', require('./routes/members'));
app.use('/api/membership-types', require('./routes/membershipTypes'));

app.get('/api/health', (req, res) => res.json({ status: 'ok', ts: new Date() }));

// Export app for testing — only start the server when run directly
if (require.main === module) {
  mongoose
    .connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/poshive')
    .then(() => {
      const port = process.env.PORT || 3001;
      app.listen(port, () => console.log(`POSHIVE backend running on port ${port}`));
    })
    .catch((err) => {
      console.error('MongoDB connection error:', err.message);
      process.exit(1);
    });
}

module.exports = app;
