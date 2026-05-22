const router = require('express').Router();
const { requireRole } = require('../middleware/auth');
const { sendRemindersForStore, markOverdueMembers } = require('../services/reminderJob');
const { isConfigured } = require('../services/mailer');

// Manual trigger — store owner sends reminders right now
router.post('/send', requireRole('store_owner', 'superadmin'), async (req, res) => {
  if (!isConfigured()) {
    return res.status(503).json({ error: 'Email is not configured on this server. Add EMAIL_HOST, EMAIL_USER, and EMAIL_PASS to .env.' });
  }

  try {
    await markOverdueMembers();
    const result = await sendRemindersForStore(req.user.storeId);
    res.json({
      message: `Done. Sent: ${result.sent}, already reminded recently: ${result.skipped}, errors: ${result.errors}`,
      ...result,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
