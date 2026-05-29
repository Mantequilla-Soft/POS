const cron = require('node-cron');
const Member = require('../models/Member');
const Store  = require('../models/Store');
const { sendBackupEmail, isConfigured } = require('./mailer');

function csvEscape(v) {
  const s = v == null ? '' : String(v);
  return s.includes(',') || s.includes('"') || s.includes('\n')
    ? '"' + s.replace(/"/g, '""') + '"'
    : s;
}

function fmtDate(d) {
  if (!d) return '';
  return new Date(d).toISOString().slice(0, 10);
}

async function buildMembersCsv(storeId) {
  const members = await Member.find({ storeId })
    .populate('membershipTypeId', 'name')
    .sort({ name: 1 });

  const headers = ['Name','Email','Phone','Hive Account','Membership Type','Is Pass','Status','Start Date','Next Due Date','Gender','Age Group','Notes','Created Date'];
  const rows = members.map(m => [
    m.name,
    m.email || '',
    m.phone || '',
    m.hiveAccount || '',
    m.membershipTypeId?.name || '',
    m.isPass ? 'Yes' : 'No',
    m.status,
    fmtDate(m.startDate),
    fmtDate(m.nextDueDate),
    m.gender || '',
    m.ageGroup || '',
    m.notes || '',
    fmtDate(m.createdAt),
  ].map(csvEscape).join(','));

  return [headers.map(csvEscape).join(','), ...rows].join('\r\n');
}

async function runBackupsForAllStores() {
  if (!isConfigured()) {
    console.warn('[backup] Email not configured — skipping monthly backup run');
    return;
  }

  const stores = await Store.find({ backupEmail: true, ownerEmail: { $ne: '' } });
  console.log(`[backup] Running monthly backup for ${stores.length} store(s)`);

  for (const store of stores) {
    try {
      const csv = await buildMembersCsv(store._id);
      await sendBackupEmail(store, store.ownerEmail, csv);
      console.log(`[backup] Sent to ${store.ownerEmail} (${store.businessName})`);
    } catch (err) {
      console.error(`[backup] Failed for ${store.businessName}:`, err.message);
    }
  }
}

function startBackupJob() {
  if (process.env.NODE_ENV === 'test') return;

  const schedule = process.env.BACKUP_CRON || '0 8 1 * *'; // 8am on the 1st of each month
  if (!cron.validate(schedule)) {
    console.error(`[backup] Invalid BACKUP_CRON expression: "${schedule}"`);
    return;
  }
  cron.schedule(schedule, runBackupsForAllStores, { timezone: process.env.TZ || 'UTC' });
  console.log(`[backup] Cron scheduled: ${schedule}`);
}

module.exports = { startBackupJob, runBackupsForAllStores, buildMembersCsv };
