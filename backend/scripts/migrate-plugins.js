/**
 * One-time migration: move per-plugin data from legacy fields into pluginConfigs.
 *
 * Converts:
 *   features.hive            → pluginConfigs.hive.enabled
 *   features.stripe          → pluginConfigs.stripe.enabled
 *   features.bitcoinLightning→ pluginConfigs.lightning.enabled
 *   stripeConfig             → pluginConfigs.stripe (merged)
 *   bitcoinLightningConfig   → pluginConfigs.lightning (merged)
 *
 * hiveAccount stays at store root (used in member reminder emails too).
 * Safe to re-run — skips stores that already have pluginConfigs populated.
 *
 * Usage:
 *   node backend/scripts/migrate-plugins.js
 *   node backend/scripts/migrate-plugins.js --dry-run
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');

const dry = process.argv.includes('--dry-run');

async function run() {
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/poshive');
  console.log(`Connected to MongoDB${dry ? ' (DRY RUN — no writes)' : ''}`);

  const db = mongoose.connection.db;
  const stores = await db.collection('stores').find({}).toArray();
  console.log(`Found ${stores.length} store(s)`);

  let migrated = 0, skipped = 0;

  for (const store of stores) {
    // Skip if already migrated
    if (store.pluginConfigs && Object.keys(store.pluginConfigs).length > 0) {
      console.log(`  SKIP  ${store.businessName || store._id} — pluginConfigs already set`);
      skipped++;
      continue;
    }

    const pluginConfigs = {};

    // Hive plugin
    const hiveEnabled = !!(store.features?.hive || store.hiveAccount);
    if (hiveEnabled) {
      pluginConfigs.hive = { enabled: hiveEnabled };
    }

    // Stripe plugin
    const stripeEnabled = !!store.features?.stripe;
    if (stripeEnabled || store.stripeConfig?.publishableKey) {
      pluginConfigs.stripe = {
        enabled:        stripeEnabled,
        publishableKey: store.stripeConfig?.publishableKey || '',
        secretKey:      store.stripeConfig?.secretKey      || '',
      };
    }

    // Lightning plugin
    const lightningEnabled = !!store.features?.bitcoinLightning;
    if (lightningEnabled || store.bitcoinLightningConfig) {
      pluginConfigs.lightning = {
        enabled:          lightningEnabled,
        ...(store.bitcoinLightningConfig || {}),
      };
    }

    // Build new features object (remove payment flags)
    const { hive, stripe, bitcoinLightning, ...nonPaymentFeatures } = store.features || {};

    const update = {
      $set:   { pluginConfigs, features: nonPaymentFeatures },
      $unset: { stripeConfig: '', bitcoinLightningConfig: '' },
    };

    console.log(`  MIGRATE ${store.businessName || store._id}`);
    console.log(`    plugins: ${Object.keys(pluginConfigs).join(', ') || '(none)'}`);

    if (!dry) {
      await db.collection('stores').updateOne({ _id: store._id }, update);
    }
    migrated++;
  }

  console.log(`\nDone. Migrated: ${migrated}  Skipped: ${skipped}${dry ? '  (dry run — nothing written)' : ''}`);
  await mongoose.disconnect();
}

run().catch(err => {
  console.error(err.message);
  process.exit(1);
});
