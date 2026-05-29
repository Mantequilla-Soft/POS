/**
 * One-time migration: create Subscription documents for any stores that don't have one.
 * Safe to run multiple times — skips stores that already have a subscription.
 *
 * Usage:
 *   node backend/scripts/migrate-subscriptions.js
 *   node backend/scripts/migrate-subscriptions.js --status active   (default: active)
 *   node backend/scripts/migrate-subscriptions.js --status trial
 *   node backend/scripts/migrate-subscriptions.js --days 30         (grace period, default: 30)
 */

require('dotenv').config();
const mongoose = require('mongoose');
const Store = require('../models/Store');
const Subscription = require('../models/Subscription');

const args = process.argv.slice(2);
function arg(name, fallback) {
  const i = args.indexOf('--' + name);
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
}

const STATUS = arg('status', 'active');
const DAYS   = parseInt(arg('days', '30'));
const PRICE  = parseFloat(process.env.BILLING_PLAN_PRICE || '5');
const VALID_STATUSES = ['trial', 'active', 'comped'];

if (!VALID_STATUSES.includes(STATUS)) {
  console.error(`Invalid --status "${STATUS}". Use: ${VALID_STATUSES.join(', ')}`);
  process.exit(1);
}

async function run() {
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/poshive');
  console.log('Connected to MongoDB');

  const stores = await Store.find({}, '_id businessName');
  console.log(`Found ${stores.length} store(s) total`);

  let created = 0, skipped = 0;

  for (const store of stores) {
    const existing = await Subscription.findOne({ storeId: store._id });
    if (existing) {
      console.log(`  SKIP  ${store.businessName || store._id} — already has subscription (${existing.status})`);
      skipped++;
      continue;
    }

    const periodEnd = new Date(Date.now() + DAYS * 86400000);
    await Subscription.create({
      storeId:          store._id,
      status:           STATUS,
      planPrice:        PRICE,
      trialEndsAt:      STATUS === 'trial' ? periodEnd : undefined,
      currentPeriodEnd: periodEnd,
    });

    console.log(`  CREATE ${store.businessName || store._id} — status=${STATUS}, period ends ${periodEnd.toLocaleDateString()}`);
    created++;
  }

  console.log(`\nDone. Created: ${created}  Skipped: ${skipped}`);
  await mongoose.disconnect();
}

run().catch(err => {
  console.error(err.message);
  process.exit(1);
});
