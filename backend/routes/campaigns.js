const router      = require('express').Router();
const jwt         = require('jsonwebtoken');
const { authenticate, roleOnly } = require('../middleware/auth');
const Member        = require('../models/Member');
const MembershipType= require('../models/MembershipType');
const EmailTemplate = require('../models/EmailTemplate');
const CampaignLog   = require('../models/CampaignLog');
const { sendCampaignEmail, isConfigured } = require('../services/mailer');

const SEND_DELAY_MS = parseInt(process.env.CAMPAIGN_SEND_DELAY_MS || '100');

router.use(authenticate);
router.use(roleOnly('store_owner', 'superadmin'));

router.use((req, res, next) => {
  if (!req.user.storeId) return res.status(400).json({ error: 'No store found.' });
  next();
});

// Build member query from filter params
function buildMemberFilter(storeId, filters = {}) {
  const q = { storeId, isPass: { $ne: true } };
  if (filters.status && filters.status !== 'all') q.status = filters.status;
  if (filters.membershipTypeId && filters.membershipTypeId !== 'all') {
    if (filters.membershipTypeId === 'passes') {
      delete q.isPass;
      q.isPass = true;
    } else {
      q.membershipTypeId = filters.membershipTypeId;
    }
  }
  return q;
}

// Interpolate {{tokens}} in a string for a specific member + store
function interpolate(template, member, store) {
  const dueDate = member.nextDueDate
    ? new Date(member.nextDueDate).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
    : '—';
  const membershipName = member.membershipTypeId?.name || '—';
  return template
    .replace(/\{\{name\}\}/gi,        member.name || '')
    .replace(/\{\{membership\}\}/gi,  membershipName)
    .replace(/\{\{dueDate\}\}/gi,     dueDate)
    .replace(/\{\{storeName\}\}/gi,   store.businessName || '');
}

function generateUnsubToken(memberId, storeId) {
  return jwt.sign(
    { memberId: String(memberId), storeId: String(storeId), purpose: 'unsub' },
    process.env.JWT_SECRET,
    { expiresIn: '10y' }
  );
}

// GET /api/campaigns — campaign history
router.get('/', async (req, res) => {
  try {
    const page  = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, parseInt(req.query.limit) || 20);
    const [logs, total] = await Promise.all([
      CampaignLog.find({ storeId: req.user.storeId })
        .sort({ sentAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
      CampaignLog.countDocuments({ storeId: req.user.storeId }),
    ]);
    res.json({ logs, total, page, pages: Math.ceil(total / limit) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/campaigns/preview-count — recipient count for given filters
router.post('/preview-count', async (req, res) => {
  try {
    const filter = buildMemberFilter(req.user.storeId, req.body.filters || {});
    const all = await Member.countDocuments(filter);
    const withEmail = await Member.countDocuments({ ...filter, email: { $exists: true, $ne: '' } });
    const optedOut = await Member.countDocuments({
      ...filter,
      email: { $exists: true, $ne: '' },
      emailOptOut: true,
    });
    res.json({
      total:          all,
      withEmail,
      skippedNoEmail: all - withEmail,
      skippedOptOut:  optedOut,
      willReceive:    withEmail - optedOut,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/campaigns/send
router.post('/send', async (req, res) => {
  const { subject, previewText, body, filters } = req.body;
  if (!subject?.trim()) return res.status(400).json({ error: 'Subject is required.' });
  if (!body?.trim())    return res.status(400).json({ error: 'Email body is required.' });

  if (!isConfigured()) {
    return res.status(503).json({ error: 'Email (SMTP) is not configured on this server.' });
  }

  try {
    const Store = require('../models/Store');
    const store = await Store.findById(req.user.storeId);
    if (!store) return res.status(404).json({ error: 'Store not found.' });

    const filter  = buildMemberFilter(req.user.storeId, filters || {});
    const members = await Member.find(filter)
      .populate('membershipTypeId', 'name');

    const appUrl = `${req.protocol}://${req.get('host')}`;

    let sentCount = 0, skippedNoEmail = 0, skippedOptOut = 0, errorCount = 0;

    for (const member of members) {
      if (!member.email) { skippedNoEmail++; continue; }
      if (member.emailOptOut) { skippedOptOut++; continue; }

      // Generate / reuse unsubscribe token
      if (!member.unsubscribeToken) {
        member.unsubscribeToken = generateUnsubToken(member._id, store._id);
        await member.save();
      }

      const unsubUrl = `${appUrl}/api/members/unsubscribe?token=${member.unsubscribeToken}`;

      const finalSubject = interpolate(subject, member, store);
      const finalBody    = interpolate(body, member, store);

      try {
        await sendCampaignEmail(member, store, finalSubject, finalBody, unsubUrl, previewText || '');
        sentCount++;
      } catch (err) {
        errorCount++;
        console.error(`[campaign] Failed for ${member.email}:`, err.message);
      }

      if (SEND_DELAY_MS > 0) await new Promise(r => setTimeout(r, SEND_DELAY_MS));
    }

    const log = await CampaignLog.create({
      storeId:        req.user.storeId,
      subject:        subject.trim(),
      previewText:    previewText?.trim() || '',
      body,
      filters:        filters || {},
      targetedCount:  members.length,
      skippedNoEmail,
      skippedOptOut,
      sentCount,
      errorCount,
      sentBy:         req.user.username || '',
    });

    res.json({ log });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Templates ───────────────────────────────────────────────────────────

router.get('/templates', async (req, res) => {
  try {
    const templates = await EmailTemplate.find({ storeId: req.user.storeId }).sort({ updatedAt: -1 });
    res.json(templates);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/templates', async (req, res) => {
  try {
    const { name, subject, previewText, body } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'Template name is required.' });
    const tpl = await EmailTemplate.create({
      storeId: req.user.storeId,
      name: name.trim(),
      subject: subject || '',
      previewText: previewText || '',
      body: body || '',
      createdBy: req.user.username || '',
    });
    res.status(201).json(tpl);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/templates/:id', async (req, res) => {
  try {
    const { name, subject, previewText, body } = req.body;
    const tpl = await EmailTemplate.findOneAndUpdate(
      { _id: req.params.id, storeId: req.user.storeId },
      { $set: { name, subject, previewText, body } },
      { new: true }
    );
    if (!tpl) return res.status(404).json({ error: 'Template not found.' });
    res.json(tpl);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/templates/:id', async (req, res) => {
  try {
    await EmailTemplate.findOneAndDelete({ _id: req.params.id, storeId: req.user.storeId });
    res.json({ message: 'Template deleted.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
