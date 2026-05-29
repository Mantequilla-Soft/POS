const router = require('express').Router();
const jwt    = require('jsonwebtoken');
const { authenticate, roleOnly } = require('../middleware/auth');
const Member = require('../models/Member');
const MemberPayment = require('../models/MemberPayment');
const MembershipType = require('../models/MembershipType');
const PDFDocument = require('pdfkit');

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

async function queryMembers(storeId, query) {
  const filter = { storeId };
  if (query.status) filter.status = query.status;
  if (query.isPass === 'true')  filter.isPass = true;
  if (query.isPass === 'false') filter.isPass = { $ne: true };
  if (query.search) {
    filter.$or = [
      { name:        { $regex: query.search, $options: 'i' } },
      { phone:       { $regex: query.search, $options: 'i' } },
      { hiveAccount: { $regex: query.search, $options: 'i' } },
    ];
  }
  return Member.find(filter)
    .populate('membershipTypeId', 'name price currency durationDays isPass')
    .sort({ name: 1 });
}

// Public unsubscribe endpoint — must be before authenticate middleware
router.get('/unsubscribe', async (req, res) => {
  const { token } = req.query;
  if (!token) return res.status(400).send('<p>Invalid unsubscribe link.</p>');
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    if (payload.purpose !== 'unsub') throw new Error('wrong token type');
    await Member.findByIdAndUpdate(payload.memberId, { $set: { emailOptOut: true } });
    res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Unsubscribed</title>
      <style>body{font-family:sans-serif;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;background:#f5f5f4}
      .box{background:#fff;border-radius:8px;padding:2rem 2.5rem;text-align:center;box-shadow:0 1px 4px rgba(0,0,0,.1);max-width:380px}
      h2{margin:0 0 .5rem;color:#1c1917}p{color:#78716c;margin:0}</style></head>
      <body><div class="box"><h2>You've been unsubscribed.</h2><p>You won't receive campaign emails from this store anymore.</p></div></body></html>`);
  } catch {
    res.status(400).send('<p>This unsubscribe link is invalid or has expired.</p>');
  }
});

// Any authenticated user with a storeId (store_owner, superadmin, or cashier)
// can read members and record payments. Destructive operations are gated below.
router.use(authenticate);

router.use((req, res, next) => {
  if (!req.user.storeId) return res.status(400).json({ error: 'No store found. Please create and publish your store first.' });
  next();
});

// Mark members as overdue/expired if nextDueDate has passed
async function syncOverdueStatus(storeId) {
  const now = new Date();
  // Regular members → overdue
  await Member.updateMany(
    { storeId, status: 'active', isPass: { $ne: true }, nextDueDate: { $lt: now, $ne: null } },
    { $set: { status: 'overdue' } }
  );
  // Pass holders → expired (no overdue state for passes)
  await Member.updateMany(
    { storeId, status: 'active', isPass: true, nextDueDate: { $lt: now, $ne: null } },
    { $set: { status: 'expired' } }
  );
}

router.get('/', async (req, res) => {
  try {
    await syncOverdueStatus(req.user.storeId);
    const filter = { storeId: req.user.storeId };
    if (req.query.status) filter.status = req.query.status;
    if (req.query.isPass === 'true')  filter.isPass = true;
    if (req.query.isPass === 'false') filter.isPass = { $ne: true };
    if (req.query.search) {
      filter.$or = [
        { name: { $regex: req.query.search, $options: 'i' } },
        { phone: { $regex: req.query.search, $options: 'i' } },
        { hiveAccount: { $regex: req.query.search, $options: 'i' } },
      ];
    }

    const page  = Math.max(1, parseInt(req.query.page)  || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 50);

    const [members, total] = await Promise.all([
      Member.find(filter)
        .populate('membershipTypeId', 'name price currency durationDays isPass')
        .sort({ name: 1 })
        .skip((page - 1) * limit)
        .limit(limit),
      Member.countDocuments(filter),
    ]);

    res.json({ members, total, page, pages: Math.ceil(total / limit) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const { name, phone, email, hiveAccount, membershipTypeId, gender, ageGroup, notes } = req.body;
    const member = await Member.create({
      storeId: req.user.storeId,
      name, phone, email, hiveAccount, membershipTypeId, gender, ageGroup, notes,
      status: 'pending',
      startDate: null,
      nextDueDate: null,
      createdBy: req.user.username || '',
    });
    res.status(201).json(member);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/members/export?format=csv|pdf — store_owner / superadmin only
// Token accepted via ?token= query param so browser can download directly
router.get('/export', roleOnly('store_owner', 'superadmin'), async (req, res) => {
  try {
    const members = await queryMembers(req.user.storeId, req.query);
    const today = new Date().toISOString().slice(0, 10);

    if (req.query.format === 'pdf') {
      // ── PDF ────────────────────────────────────────────────────────────
      const Store = require('../models/Store');
      const store = await Store.findById(req.user.storeId);
      const storeName = store?.businessName || 'Store';

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="members-${today}.pdf"`);

      const doc = new PDFDocument({ margin: 40, size: 'LETTER' });
      doc.pipe(res);

      // Header
      doc.fontSize(18).font('Helvetica-Bold').text(storeName, { align: 'left' });
      doc.fontSize(11).font('Helvetica').fillColor('#666')
         .text(`Member Roster  ·  Generated ${today}`, { align: 'left' });

      // Status counts
      const counts = members.reduce((acc, m) => { acc[m.status] = (acc[m.status] || 0) + 1; return acc; }, {});
      const summary = Object.entries(counts).map(([k, v]) => `${v} ${k}`).join('  ·  ');
      doc.fontSize(9).fillColor('#888').text(summary || 'No members', { align: 'left' });
      doc.moveDown(0.5);

      // Divider
      doc.moveTo(40, doc.y).lineTo(570, doc.y).strokeColor('#ccc').stroke();
      doc.moveDown(0.5);

      // Column definitions
      const cols = [
        { label: 'Name',      x: 40,  w: 130 },
        { label: 'Email',     x: 175, w: 130 },
        { label: 'Phone',     x: 310, w: 90  },
        { label: 'Plan',      x: 405, w: 85  },
        { label: 'Status',    x: 493, w: 55  },
        { label: 'Next Due',  x: 490, w: 80  },
      ];
      // Adjust last two cols
      const colDefs = [
        { label: 'Name',     x: 40,  w: 125 },
        { label: 'Email',    x: 170, w: 125 },
        { label: 'Phone',    x: 300, w: 85  },
        { label: 'Plan',     x: 390, w: 90  },
        { label: 'Status',   x: 485, w: 55  },
        { label: 'Due',      x: 543, w: 70  },
      ];

      // Table header row
      const headerY = doc.y;
      doc.font('Helvetica-Bold').fontSize(8).fillColor('#333');
      colDefs.forEach(c => doc.text(c.label, c.x, headerY, { width: c.w }));
      doc.moveDown(0.3);

      doc.moveTo(40, doc.y).lineTo(610, doc.y).strokeColor('#999').stroke();
      doc.moveDown(0.2);

      // Rows
      doc.font('Helvetica').fontSize(8).fillColor('#222');
      for (const m of members) {
        if (doc.y > 720) { doc.addPage(); }
        const rowY = doc.y;
        const row = [
          m.name,
          m.email || '',
          m.phone || '',
          m.membershipTypeId?.name || '—',
          m.status,
          fmtDate(m.nextDueDate),
        ];
        colDefs.forEach((c, i) => {
          doc.text(row[i], c.x, rowY, { width: c.w, ellipsis: true });
        });
        doc.moveDown(0.35);
      }

      doc.end();

    } else {
      // ── CSV (default) ──────────────────────────────────────────────────
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

      const csv = [headers.map(csvEscape).join(','), ...rows].join('\r\n');
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="members-${today}.csv"`);
      res.send('﻿' + csv); // BOM for Excel UTF-8 compatibility
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create a pass holder + activate immediately — called from POS after sale completes
router.post('/pass-sale', async (req, res) => {
  try {
    const { membershipTypeId, name, email, phone, paymentMethod, paymentNotes, amount, hiveFrom, hiveTransactionMemo } = req.body;
    if (!name || !membershipTypeId) return res.status(400).json({ error: 'name and membershipTypeId are required' });

    const membershipType = await MembershipType.findOne({ _id: membershipTypeId, storeId: req.user.storeId, isPass: true });
    if (!membershipType) return res.status(404).json({ error: 'Pass type not found' });

    const paidDate = new Date();
    const periodEnd = new Date(paidDate);
    periodEnd.setDate(periodEnd.getDate() + membershipType.durationDays);

    const member = await Member.create({
      storeId: req.user.storeId,
      name: name.trim(),
      phone:  phone  || '',
      email:  email  || '',
      membershipTypeId,
      isPass: true,
      startDate:   paidDate,
      nextDueDate: periodEnd,
      status: 'active',
      createdBy: req.user.username || '',
    });

    await MemberPayment.create({
      memberId: member._id,
      storeId:  req.user.storeId,
      membershipTypeId,
      amount:   amount ?? membershipType.price,
      currency: membershipType.currency,
      method:   paymentMethod || 'cash',
      paymentNotes: paymentNotes || '',
      hiveFrom:           hiveFrom           || '',
      hiveTransactionMemo: hiveTransactionMemo || '',
      paidDate,
      periodStart: paidDate,
      periodEnd,
      recordedBy: req.user.username || '',
    });

    res.status(201).json(member);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const member = await Member.findOne({ _id: req.params.id, storeId: req.user.storeId })
      .populate('membershipTypeId', 'name price currency durationDays isPass');
    if (!member) return res.status(404).json({ error: 'Member not found' });
    res.json(member);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const member = await Member.findOneAndUpdate(
      { _id: req.params.id, storeId: req.user.storeId },
      { $set: req.body },
      { new: true }
    ).populate('membershipTypeId', 'name price currency durationDays isPass');
    if (!member) return res.status(404).json({ error: 'Member not found' });
    res.json(member);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', roleOnly('store_owner', 'superadmin'), async (req, res) => {
  try {
    await Member.findOneAndDelete({ _id: req.params.id, storeId: req.user.storeId });
    await MemberPayment.deleteMany({ memberId: req.params.id });
    res.json({ message: 'Member deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Payment history for a member
router.get('/:id/payments', async (req, res) => {
  try {
    const payments = await MemberPayment.find({ memberId: req.params.id, storeId: req.user.storeId })
      .sort({ periodStart: -1, createdAt: -1 });
    res.json(payments);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Record a payment — advances nextDueDate and updates member status
router.post('/:id/payments', async (req, res) => {
  try {
    const member = await Member.findOne({ _id: req.params.id, storeId: req.user.storeId });
    if (!member) return res.status(404).json({ error: 'Member not found' });

    const membershipType = await MembershipType.findById(member.membershipTypeId);
    if (!membershipType) return res.status(400).json({ error: 'Membership type not found' });

    const paidDate = new Date(req.body.paidDate || new Date());
    // Chain from nextDueDate only when the member is already paid into the future.
    // Pending members have no nextDueDate yet, so always start from paidDate.
    const periodStart = (member.nextDueDate && member.nextDueDate > paidDate)
      ? new Date(member.nextDueDate)
      : paidDate;
    const periodEnd = new Date(periodStart);
    periodEnd.setDate(periodEnd.getDate() + membershipType.durationDays);

    const payment = await MemberPayment.create({
      memberId: member._id,
      storeId: req.user.storeId,
      membershipTypeId: member.membershipTypeId,
      amount: req.body.amount ?? membershipType.price,
      currency: req.body.currency || membershipType.currency,
      method: req.body.method,
      hiveTransactionMemo: req.body.hiveTransactionMemo || '',
      hiveFrom: req.body.hiveFrom || '',
      paidDate,
      periodStart,
      periodEnd,
      notes: req.body.notes || '',
      recordedBy: req.user.username || '',
    });

    // First payment activates a pending member and sets their start date
    if (member.status === 'pending') member.startDate = paidDate;
    member.nextDueDate = periodEnd;
    member.status = 'active';
    await member.save();

    res.status(201).json({ payment, member });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
