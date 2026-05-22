const router = require('express').Router();
const { authenticate, roleOnly } = require('../middleware/auth');
const Member = require('../models/Member');
const MemberPayment = require('../models/MemberPayment');
const MembershipType = require('../models/MembershipType');

// Any authenticated user with a storeId (store_owner, superadmin, or cashier)
// can read members and record payments. Destructive operations are gated below.
router.use(authenticate);

router.use((req, res, next) => {
  if (!req.user.storeId) return res.status(400).json({ error: 'No store found. Please create and publish your store first.' });
  next();
});

// Mark members as overdue if nextDueDate has passed
async function syncOverdueStatus(storeId) {
  await Member.updateMany(
    { storeId, status: 'active', nextDueDate: { $lt: new Date(), $ne: null } },
    { $set: { status: 'overdue' } }
  );
}

router.get('/', async (req, res) => {
  try {
    await syncOverdueStatus(req.user.storeId);
    const filter = { storeId: req.user.storeId };
    if (req.query.status) filter.status = req.query.status;
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
        .populate('membershipTypeId', 'name price currency durationDays')
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
    const { name, phone, email, hiveAccount, membershipTypeId, notes } = req.body;
    const member = await Member.create({
      storeId: req.user.storeId,
      name, phone, email, hiveAccount, membershipTypeId, notes,
      status: 'pending',
      startDate: null,
      nextDueDate: null,
    });
    res.status(201).json(member);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const member = await Member.findOne({ _id: req.params.id, storeId: req.user.storeId })
      .populate('membershipTypeId', 'name price currency durationDays');
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
    ).populate('membershipTypeId', 'name price currency durationDays');
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
      recordedBy: req.body.recordedBy || '',
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
