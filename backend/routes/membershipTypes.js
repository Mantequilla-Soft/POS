const router = require('express').Router();
const { authenticate, roleOnly } = require('../middleware/auth');
const MembershipType = require('../models/MembershipType');

router.use(authenticate);

router.use((req, res, next) => {
  if (!req.user.storeId) return res.status(400).json({ error: 'No store found. Please create and publish your store first.' });
  next();
});

// GET is open to cashiers — they need to see plans when registering members and recording payments
router.get('/', async (req, res) => {
  try {
    const types = await MembershipType.find({ storeId: req.user.storeId }).sort({ name: 1 });
    res.json(types);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Plan creation/edit/delete is admin-only
router.use(roleOnly('store_owner', 'superadmin'));

router.post('/', async (req, res) => {
  try {
    const type = await MembershipType.create({ ...req.body, storeId: req.user.storeId });
    res.status(201).json(type);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const type = await MembershipType.findOneAndUpdate(
      { _id: req.params.id, storeId: req.user.storeId },
      { $set: req.body },
      { new: true }
    );
    if (!type) return res.status(404).json({ error: 'Membership type not found' });
    res.json(type);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    await MembershipType.findOneAndDelete({ _id: req.params.id, storeId: req.user.storeId });
    res.json({ message: 'Membership type deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
