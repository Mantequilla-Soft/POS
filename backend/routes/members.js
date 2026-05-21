const router = require('express').Router();
const { requireRole } = require('../middleware/auth');
const Member = require('../models/Member');
const MemberPayment = require('../models/MemberPayment');
const MembershipType = require('../models/MembershipType');

router.use(requireRole('store_owner', 'superadmin'));

// Mark members as overdue if nextDueDate has passed
async function syncOverdueStatus(storeId) {
  await Member.updateMany(
    { storeId, status: 'active', nextDueDate: { $lt: new Date() } },
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
    const members = await Member.find(filter)
      .populate('membershipTypeId', 'name price currency durationDays')
      .sort({ name: 1 });
    res.json(members);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const member = await Member.create({ ...req.body, storeId: req.user.storeId });
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

router.delete('/:id', async (req, res) => {
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
      .sort({ paidDate: -1 });
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
    const periodStart = paidDate;
    const periodEnd = new Date(paidDate);
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

    // Advance member due date and restore active status
    member.nextDueDate = periodEnd;
    member.status = 'active';
    await member.save();

    res.status(201).json({ payment, member });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
