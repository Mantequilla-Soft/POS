const router = require('express').Router();
const { requireRole } = require('../middleware/auth');
const User = require('../models/User');
const Store = require('../models/Store');

// All routes require superadmin
router.use(requireRole('superadmin'));

router.get('/pending', async (req, res) => {
  try {
    const users = await User.find({ approved: false, role: 'store_owner' })
      .select('-password')
      .sort({ createdAt: 1 });
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/approve/:userId', async (req, res) => {
  try {
    const user = await User.findByIdAndUpdate(
      req.params.userId,
      { approved: true },
      { new: true }
    ).select('-password');
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ message: 'User approved', user });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/reject/:userId', async (req, res) => {
  try {
    await User.findByIdAndDelete(req.params.userId);
    res.json({ message: 'User rejected and removed' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/stores', async (req, res) => {
  try {
    const stores = await Store.find()
      .populate('ownerId', 'username hiveAccount')
      .select('businessName hiveAccount published features createdAt ownerId')
      .sort({ createdAt: -1 });
    res.json(stores);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
