const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const Subscription = require('../models/Subscription');
const SubscriptionPayment = require('../models/SubscriptionPayment');

router.use(authenticate);

const BILLING_HIVE_ACCOUNT = () => process.env.BILLING_HIVE_ACCOUNT || '';
const PLAN_PRICE = () => parseFloat(process.env.BILLING_PLAN_PRICE || '5');

// Advance the subscription period by 30 days and mark active
async function recordPayment(sub, { amount, currency, method, hiveFrom, hiveTxMemo, hiveTxId, stripePaymentIntentId, recordedBy }) {
  const now = new Date();
  const base = sub.currentPeriodEnd > now ? sub.currentPeriodEnd : now;
  const periodStart = new Date(base);
  const periodEnd = new Date(base.getTime() + 30 * 24 * 60 * 60 * 1000);
  await SubscriptionPayment.create({
    storeId: sub.storeId,
    subscriptionId: sub._id,
    amount, currency, method,
    hiveFrom:              hiveFrom              || '',
    hiveTxMemo:            hiveTxMemo            || '',
    hiveTxId:              hiveTxId              || '',
    stripePaymentIntentId: stripePaymentIntentId || '',
    periodStart, periodEnd,
    paidAt: now,
    recordedBy: recordedBy || 'auto',
  });
  sub.status = 'active';
  sub.currentPeriodEnd = periodEnd;
  await sub.save();
  return sub;
}

// GET /api/subscription — own subscription status
router.get('/', async (req, res) => {
  try {
    const sub = await Subscription.findOne({ storeId: req.user.storeId });
    if (!sub) return res.status(404).json({ error: 'No subscription found' });
    res.json({
      ...sub.toObject(),
      billingMemo: `poshive-${sub.storeId.toString()}`,
      billingHiveAccount: BILLING_HIVE_ACCOUNT(),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/subscription/payments — payment history
router.get('/payments', async (req, res) => {
  try {
    const payments = await SubscriptionPayment.find({ storeId: req.user.storeId }).sort({ paidAt: -1 }).limit(24);
    res.json(payments);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/subscription/pay/hbd — store owner submits a tx ID for immediate verification
router.post('/pay/hbd', async (req, res) => {
  try {
    const { txId } = req.body;
    if (!txId) return res.status(400).json({ error: 'txId is required' });
    const billingAccount = BILLING_HIVE_ACCOUNT();
    if (!billingAccount) return res.status(400).json({ error: 'HBD billing not configured' });

    // Check not already recorded
    const existing = await SubscriptionPayment.findOne({ hiveTxId: txId });
    if (existing) return res.status(409).json({ error: 'Transaction already recorded' });

    // Look up the tx on-chain
    const response = await fetch('https://api.hive.blog', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'condenser_api.get_transaction', params: [txId], id: 1 }),
    });
    const data = await response.json();
    const ops = data.result?.operations || [];
    const transfer = ops.find(op => op[0] === 'transfer' && op[1].to === billingAccount);
    if (!transfer) return res.status(400).json({ error: 'Transfer to billing account not found in transaction' });

    const op = transfer[1];
    const expectedMemo = `poshive-${req.user.storeId.toString()}`;
    if (!op.memo?.includes(expectedMemo)) {
      return res.status(400).json({ error: 'Memo does not match your store. Expected: ' + expectedMemo });
    }
    const amount = parseFloat(op.amount);
    const currency = op.amount.includes('HBD') ? 'HBD' : 'HIVE';

    const sub = await Subscription.findOne({ storeId: req.user.storeId });
    if (!sub) return res.status(404).json({ error: 'Subscription not found' });

    await recordPayment(sub, {
      amount, currency, method: 'hbd',
      hiveFrom: op.from, hiveTxMemo: op.memo, hiveTxId: txId,
      recordedBy: 'owner',
    });
    res.json({ ok: true, message: 'Payment recorded. Subscription is now active.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/subscription/pay/stripe/intent — create a Stripe PaymentIntent
router.post('/pay/stripe/intent', async (req, res) => {
  try {
    if (!process.env.STRIPE_SECRET_KEY) return res.status(400).json({ error: 'Stripe not configured' });
    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    const sub = await Subscription.findOne({ storeId: req.user.storeId });
    if (!sub) return res.status(404).json({ error: 'Subscription not found' });
    const intent = await stripe.paymentIntents.create({
      amount: Math.round(sub.planPrice * 100),
      currency: 'usd',
      metadata: { storeId: req.user.storeId.toString() },
    });
    res.json({ clientSecret: intent.client_secret, publishableKey: process.env.STRIPE_PUBLISHABLE_KEY });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/subscription/pay/stripe/confirm — verify succeeded PaymentIntent and record
router.post('/pay/stripe/confirm', async (req, res) => {
  try {
    const { paymentIntentId } = req.body;
    if (!paymentIntentId) return res.status(400).json({ error: 'paymentIntentId required' });
    if (!process.env.STRIPE_SECRET_KEY) return res.status(400).json({ error: 'Stripe not configured' });

    const existing = await SubscriptionPayment.findOne({ stripePaymentIntentId: paymentIntentId });
    if (existing) return res.json({ ok: true, message: 'Already recorded' });

    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    const intent = await stripe.paymentIntents.retrieve(paymentIntentId);
    if (intent.status !== 'succeeded') return res.status(400).json({ error: 'Payment not completed' });
    if (intent.metadata.storeId !== req.user.storeId.toString()) return res.status(403).json({ error: 'Forbidden' });

    const sub = await Subscription.findOne({ storeId: req.user.storeId });
    if (!sub) return res.status(404).json({ error: 'Subscription not found' });

    await recordPayment(sub, {
      amount: intent.amount / 100, currency: 'USD', method: 'stripe',
      stripePaymentIntentId: paymentIntentId, recordedBy: 'owner',
    });
    res.json({ ok: true, message: 'Payment recorded. Subscription is now active.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
module.exports.recordPayment = recordPayment;
