// Vouge Street — Verify Razorpay Payment (browser confirmation only)
//
// IMPORTANT: This endpoint NO LONGER creates the Shopify order. Order creation is done in
// exactly one place — razorpay-webhook.js, on the `payment.captured` event — so the browser
// and the webhook can never both create an order (that was causing duplicate orders, because
// Shopify's tag search isn't instantly consistent and the dedup check missed the just-created
// order). Here we only verify the payment signature and return the amounts the confirmation
// screen shows. The order appears in Shopify a moment later, created by the webhook.

import crypto from 'crypto';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://voguestreet.in');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { razorpay_order_id, razorpay_payment_id, razorpay_signature, cart } = req.body || {};

  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
    return res.status(400).json({ error: 'Missing Razorpay payment details' });
  }

  // Verify the payment signature server-side.
  const expected = crypto
    .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
    .update(`${razorpay_order_id}|${razorpay_payment_id}`)
    .digest('hex');
  if (expected !== razorpay_signature) {
    console.error('SIGNATURE MISMATCH', { expected, received: razorpay_signature });
    return res.status(400).json({ error: 'Payment verification failed — invalid signature' });
  }

  const totalRs     = Math.round((cart && cart.total_price ? cart.total_price : 0) / 100);
  const balanceCOD  = totalRs - 99;

  console.log('VS PAYMENT VERIFIED (order will be created by webhook)', {
    payment_id: razorpay_payment_id, total: totalRs,
  });

  // order_name is intentionally omitted — the order is created by the webhook moments later.
  return res.status(200).json({
    success:     true,
    verified:    true,
    total:       totalRs,
    balance_cod: balanceCOD,
    payment_id:  razorpay_payment_id,
  });
}
