const cron = require('node-cron');
const Member = require('../models/Member');
const Store  = require('../models/Store');
const { sendOverdueReminder, isConfigured } = require('./mailer');

// Minimum gap between reminders for the same member (default 7 days)
const REMINDER_INTERVAL_MS = parseInt(process.env.REMINDER_INTERVAL_DAYS || '7') * 86400000;

async function sendRemindersForStore(storeId) {
  const store = await Store.findById(storeId);
  if (!store) return { sent: 0, skipped: 0, errors: 0 };

  const cutoff = new Date(Date.now() - REMINDER_INTERVAL_MS);

  const members = await Member.find({
    storeId: store._id,
    status: 'overdue',
    isPass: { $ne: true },
    email: { $exists: true, $ne: '' },
    $or: [
      { lastReminderSent: null },
      { lastReminderSent: { $lt: cutoff } },
    ],
  });

  // Count members skipped due to the interval throttle
  const skipped = await Member.countDocuments({
    storeId: store._id,
    status: 'overdue',
    email: { $exists: true, $ne: '' },
    lastReminderSent: { $gte: cutoff },
  });

  let sent = 0, errors = 0;

  for (const member of members) {
    try {
      await sendOverdueReminder(member, store);
      member.lastReminderSent = new Date();
      await member.save();
      sent++;
      console.log(`[reminders] Sent to ${member.email} (${member.name})`);
    } catch (err) {
      errors++;
      console.error(`[reminders] Failed for ${member.email}:`, err.message);
    }
  }

  return { sent, skipped, errors };
}

// Mark active members overdue when their nextDueDate has passed
async function markOverdueMembers() {
  const now = new Date();
  // Regular members → overdue
  const overdue = await Member.updateMany(
    { status: 'active', isPass: { $ne: true }, nextDueDate: { $lt: now } },
    { $set: { status: 'overdue' } }
  );
  // Pass holders → expired (passes don't go overdue)
  const expired = await Member.updateMany(
    { status: 'active', isPass: true, nextDueDate: { $lt: now } },
    { $set: { status: 'expired' } }
  );
  const total = (overdue.modifiedCount || 0) + (expired.modifiedCount || 0);
  if (total > 0) {
    console.log(`[overdue] Marked ${overdue.modifiedCount} overdue, ${expired.modifiedCount} pass(es) expired`);
  }
  return total;
}

async function runAllStores() {
  await markOverdueMembers();

  if (!isConfigured()) {
    console.warn('[reminders] Email not configured — skipping reminder run');
    return;
  }

  const stores = await Store.find({ 'features.emailReminders': true });
  console.log(`[reminders] Running for ${stores.length} store(s)`);

  for (const store of stores) {
    const result = await sendRemindersForStore(store._id);
    console.log(`[reminders] ${store.businessName}: sent=${result.sent} errors=${result.errors}`);
  }
}

function startReminderJob() {
  if (process.env.NODE_ENV === 'test') return;

  const schedule = process.env.REMINDER_CRON || '0 9 * * *'; // 9am daily
  if (!cron.validate(schedule)) {
    console.error(`[reminders] Invalid REMINDER_CRON expression: "${schedule}"`);
    return;
  }
  cron.schedule(schedule, runAllStores, { timezone: process.env.TZ || 'UTC' });
  console.log(`[reminders] Cron scheduled: ${schedule}`);
}

module.exports = { startReminderJob, runAllStores, sendRemindersForStore, markOverdueMembers };
