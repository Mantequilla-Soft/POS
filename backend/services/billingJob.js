const cron = require('node-cron');
const Subscription = require('../models/Subscription');
const SubscriptionPayment = require('../models/SubscriptionPayment');
const Store = require('../models/Store');
const { recordPayment } = require('../routes/subscriptions');
const { isConfigured } = require('./mailer');
const nodemailer = require('nodemailer');

// ── Overdue marking ──────────────────────────────────────────────────────────

async function updateOverdueStatuses() {
  const now = new Date();

  // Trials that have expired → overdue
  const trials = await Subscription.updateMany(
    { status: 'trial', trialEndsAt: { $lt: now } },
    { $set: { status: 'overdue' } }
  );

  // Active periods that have expired → overdue
  const actives = await Subscription.updateMany(
    { status: 'active', currentPeriodEnd: { $lt: now } },
    { $set: { status: 'overdue' } }
  );

  const total = (trials.modifiedCount || 0) + (actives.modifiedCount || 0);
  if (total > 0) {
    console.log(`[billing] Marked ${trials.modifiedCount} trial(s) and ${actives.modifiedCount} active period(s) as overdue`);
  }
  return total;
}

// ── Hive payment polling ─────────────────────────────────────────────────────

async function pollHivePayments() {
  const billingAccount = process.env.BILLING_HIVE_ACCOUNT;
  if (!billingAccount) return;

  let history;
  try {
    const response = await fetch('https://api.hive.blog', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'condenser_api.get_account_history',
        // -1 = most recent, 50 = look back 50 ops
        params: [billingAccount, -1, 50],
        id: 1,
      }),
    });
    const data = await response.json();
    history = data.result || [];
  } catch (err) {
    console.error('[billing] Hive poll failed:', err.message);
    return;
  }

  let recorded = 0;
  for (const [, op] of history) {
    if (op.op[0] !== 'transfer') continue;
    const tx = op.op[1];
    if (tx.to !== billingAccount) continue;
    if (!tx.memo?.startsWith('poshive-')) continue;

    const txId = op.trx_id;
    if (!txId) continue;

    // Deduplicate
    const exists = await SubscriptionPayment.findOne({ hiveTxId: txId });
    if (exists) continue;

    // Extract storeId from memo "poshive-<24hexchars>"
    const storeIdStr = tx.memo.replace('poshive-', '').trim();
    if (storeIdStr.length !== 24) continue;

    const sub = await Subscription.findOne({ storeId: storeIdStr }).catch(() => null);
    if (!sub) continue;

    const amount = parseFloat(tx.amount);
    const currency = tx.amount.includes('HBD') ? 'HBD' : 'HIVE';

    try {
      await recordPayment(sub, {
        amount, currency, method: 'hbd',
        hiveFrom: tx.from, hiveTxMemo: tx.memo, hiveTxId: txId,
        recordedBy: 'auto',
      });
      recorded++;
      console.log(`[billing] Auto-recorded HBD payment from @${tx.from} for store ${storeIdStr}`);
    } catch (err) {
      console.error(`[billing] Failed to record payment for ${storeIdStr}:`, err.message);
    }
  }

  return recorded;
}

// ── Overdue billing reminders ────────────────────────────────────────────────

async function sendBillingReminders() {
  if (!isConfigured()) return;

  // Find overdue subscriptions with a store owner who has an email
  const overdueSubs = await Subscription.find({ status: 'overdue' });
  if (!overdueSubs.length) return;

  const transporter = nodemailer.createTransport({
    host: process.env.EMAIL_HOST,
    port: parseInt(process.env.EMAIL_PORT || '587'),
    secure: process.env.EMAIL_SECURE === 'true',
    auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
  });

  const User = require('../models/User');

  let sent = 0;
  for (const sub of overdueSubs) {
    const store = await Store.findById(sub.storeId).catch(() => null);
    if (!store) continue;

    const owner = await User.findById(store.ownerId).catch(() => null);
    if (!owner?.email) continue;

    const billingAccount = process.env.BILLING_HIVE_ACCOUNT || '';
    const memo = `poshive-${sub.storeId.toString()}`;
    const billAmount = Math.max(sub.planPrice, sub.periodHighPrice || 0);
    const price = `${billAmount} ${sub.planCurrency}`;

    try {
      await transporter.sendMail({
        from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
        to: owner.email,
        subject: `POSHIVE — Subscription overdue for ${store.businessName}`,
        text: [
          `Hi ${owner.username},`,
          '',
          `Your POSHIVE subscription for "${store.businessName}" is overdue.`,
          `Plan: ${price}/month`,
          '',
          billingAccount
            ? `To pay with HBD: send ${price} to @${billingAccount} with memo: ${memo}`
            : 'Please contact support to renew your subscription.',
          '',
          'Your store will remain accessible while payment is pending.',
          '',
          'POSHIVE',
        ].join('\n'),
      });
      sent++;
      console.log(`[billing] Reminder sent to ${owner.email} for store ${store.businessName}`);
    } catch (err) {
      console.error(`[billing] Email failed for ${owner.email}:`, err.message);
    }
  }
  return sent;
}

// ── Main run ─────────────────────────────────────────────────────────────────

async function runBillingJob() {
  if (process.env.BILLING_ENABLED === 'false') return;
  await updateOverdueStatuses();
  await pollHivePayments();
  await sendBillingReminders();
}

function startBillingJob() {
  if (process.env.BILLING_ENABLED === 'false') {
    console.log('[billing] Billing disabled — skipping job');
    return;
  }
  if (process.env.NODE_ENV === 'test') return;

  // Check overdue every hour, poll Hive every 10 minutes
  const overdueSchedule = process.env.BILLING_OVERDUE_CRON || '0 * * * *';
  const pollSchedule    = process.env.BILLING_POLL_CRON    || '*/10 * * * *';

  if (cron.validate(overdueSchedule)) {
    cron.schedule(overdueSchedule, async () => {
      await updateOverdueStatuses();
      await sendBillingReminders();
    }, { timezone: process.env.TZ || 'UTC' });
    console.log(`[billing] Overdue cron: ${overdueSchedule}`);
  }

  if (cron.validate(pollSchedule)) {
    cron.schedule(pollSchedule, pollHivePayments, { timezone: process.env.TZ || 'UTC' });
    console.log(`[billing] Hive poll cron: ${pollSchedule}`);
  }
}

module.exports = { startBillingJob, runBillingJob, updateOverdueStatuses, pollHivePayments, sendBillingReminders };
